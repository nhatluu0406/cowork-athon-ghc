# MS365 Teams Messaging (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI đọc tin nhắn Teams (recent, capped — model tự lọc) và post message tới chat/channel với @mentions an toàn (HTML-escape + placeholder), post qua PermissionGate.

**Architecture:** `TeamsService` cạnh các sibling, dùng `Ms365Connector.graph()`. 5 read tool thẳng; 1 write (`teams_post_message`) đúng khuôn write hiện có. Mention: model đưa plain text + `@{i}` placeholder + mentions array; service escape HTML rồi thay placeholder bằng `<at id="i">` — model không bao giờ viết HTML thô.

**Tech Stack:** TypeScript strict ESM, `node:test`, Graph v1.0 chats/teams/channels/chatMessage.

## Global Constraints

- TS strict; no `any`; no hiding-casts; ESM `.js`. Chỉ qua `Ms365Connector.graph()`; graph-client KHÔNG đổi.
- **Post qua PermissionGate** (khuôn `handleListsWrite`); mọi read thẳng sau `not_connected` guard.
- **HTML-escape TOÀN BỘ content + displayName trước khi chèn `<at>`** — chống HTML injection vào Teams. Placeholder `@{i}` không có mention[i] → throw (service) / invalid_input (tool).
- Target union chặt: ĐÚNG MỘT trong `{chatId}` | `{teamId, channelId}` (listMembers: `{chatId}` | `{teamId}`).
- Cap 50 list/messages (`$top` trên messages); message text bounded 4096 chars.
- id `encodeURIComponent` path; content/mentions chỉ vào body.
- Scope thêm: `"Chat.ReadWrite", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Read.All", "ChannelMessage.Send"`.
- Flag OFF mặc định. Test: `cd service && node --import tsx --test tests/<file>.test.ts`.

## File Structure

- **Create `service/src/ms365/teams-service.ts`** (+ helper thuần `buildTeamsBody` export riêng để test) + test `ms365-teams-service.test.ts`.
- **Modify `ms365-tools.ts`** — 6 names, `teams` dep, 5 read case + `handleTeamsWrite` (khuôn `handleListsWrite`, type-guard `isTeamsWrite`); test `ms365-teams-tool.test.ts` + stub `teams` vào deps factory 4 suite tool cũ + router test.
- **Modify `ms365-tool-router.ts`** (TOOL_NAMES += 6), **`index.ts`** (export), **`compose-service.ts`** (wire + 5 scope), **api-map** (mục Teams 🟡).

Task order: service → dispatch → wiring.

---

### Task 1: TeamsService + buildTeamsBody

**Files:** Create `service/src/ms365/teams-service.ts`; Test `service/tests/ms365-teams-service.test.ts`.

**Interfaces:**
- Consumes: `Ms365Connector`, `Ms365Error`.
- Produces (đúng spec — port shape trong spec §TeamsService): `TeamsChat`, `TeamsTeam`, `TeamsChannel`, `TeamsMember`, `TeamsMessage`, `MessageTarget`, `TeamsService`, `createTeamsService(deps: { connector; maxResults?; maxTextChars? })` (defaults 50 / 4096), VÀ helper thuần:

```ts
/** Pure: escape + placeholder substitution + Graph mentions shape. Exported for direct tests. */
export function buildTeamsBody(
  content: string,
  mentions: Array<{ userId: string; displayName: string }>,
): { body: { contentType: "html"; content: string }; mentions: Array<{ id: number; mentionText: string; mentioned: { user: { id: string; displayName: string } } }> };
```

- [ ] **Step 1: Failing tests** — helper `connectorReturning` copy từ `ms365-planner-service.test.ts`. 10 test:

```ts
test("buildTeamsBody escapes HTML and substitutes @{i} placeholders", () => {
  const out = buildTeamsBody("Hello @{0}, xem <b>report</b> & reply", [{ userId: "u1", displayName: "Alice <QA>" }]);
  assert.equal(
    out.body.content,
    'Hello <at id="0">Alice &lt;QA&gt;</at>, xem &lt;b&gt;report&lt;/b&gt; &amp; reply',
  );
  assert.deepEqual(out.mentions, [
    { id: 0, mentionText: "Alice <QA>", mentioned: { user: { id: "u1", displayName: "Alice <QA>" } } },
  ]);
});

test("buildTeamsBody throws when a placeholder has no mention", () => {
  assert.throws(() => buildTeamsBody("Hi @{1}", [{ userId: "u1", displayName: "A" }]), /placeholder/i);
});

test("buildTeamsBody with no mentions returns escaped html and empty mentions", () => {
  const out = buildTeamsBody("a < b", []);
  assert.equal(out.body.content, "a &lt; b");
  assert.deepEqual(out.mentions, []);
});

test("listChats maps /me/chats with topic default and member names", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [
    { id: "c1", topic: "Dự án X", members: [{ displayName: "A" }, { displayName: "B" }] },
    { id: "c2", topic: null, members: "bad" }, // topic null → "", members bad → []
    { topic: "no id" }, // dropped
  ]}));
  const svc = createTeamsService({ connector: conn });
  const chats = await svc.listChats();
  assert.deepEqual(chats, [
    { id: "c1", topic: "Dự án X", memberNames: ["A", "B"] },
    { id: "c2", topic: "", memberNames: [] },
  ]);
  assert.match(seen[0].path, /\/me\/chats/);
  assert.equal(seen[0].query?.["$expand"], "members");
});

test("listTeams + listChannels map and cap", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, (r) =>
    r.path.includes("joinedTeams")
      ? { value: [{ id: "t1", displayName: "Team A" }] }
      : { value: [{ id: "ch1", displayName: "General" }] });
  const svc = createTeamsService({ connector: conn });
  assert.deepEqual(await svc.listTeams(), [{ id: "t1", displayName: "Team A" }]);
  assert.deepEqual(await svc.listChannels("t1"), [{ id: "ch1", displayName: "General" }]);
  assert.match(seen[1].path, /\/teams\/t1\/channels/);
});

test("listMembers maps chat members (userId from userId field)", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [
    { userId: "u1", displayName: "Alice" },
    { displayName: "no userid" }, // dropped
  ]}));
  const members = await createTeamsService({ connector: conn }).listMembers({ chatId: "c1" });
  assert.deepEqual(members, [{ userId: "u1", displayName: "Alice" }]);
  assert.match(seen[0].path, /\/chats\/c1\/members/);
});

test("listMembers with teamId hits /teams/{id}/members", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  await createTeamsService({ connector: conn }).listMembers({ teamId: "t1" });
  assert.match(seen[0].path, /\/teams\/t1\/members/);
});

test("getMessages: chat target hits /chats/{id}/messages with $top; text bounded; from mapped", async () => {
  const seen: GraphClientRequest[] = [];
  const long = "x".repeat(5000);
  const conn = connectorReturning(seen, () => ({ value: [
    { id: "m1", from: { user: { displayName: "Bob" } }, createdDateTime: "2026-07-14T00:00:00Z", body: { content: long } },
    { id: "m2" }, // from/body thiếu → "" / ""
  ]}));
  const svc = createTeamsService({ connector: conn, maxTextChars: 4096 });
  const msgs = await svc.getMessages({ chatId: "c1" });
  assert.equal(msgs[0].text.length, 4096);
  assert.equal(msgs[0].from, "Bob");
  assert.deepEqual(msgs[1], { id: "m2", from: "", createdDateTime: "", text: "" });
  assert.match(seen[0].path, /\/chats\/c1\/messages/);
  assert.equal(seen[0].query?.["$top"], "50");
});

test("getMessages: channel target hits /teams/{tid}/channels/{cid}/messages", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  await createTeamsService({ connector: conn }).getMessages({ teamId: "t1", channelId: "ch1" });
  assert.match(seen[0].path, /\/teams\/t1\/channels\/ch1\/messages/);
});

test("postMessage POSTs html body + mentions to the right path and returns id", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ id: "msg9" }));
  const out = await createTeamsService({ connector: conn }).postMessage({
    target: { teamId: "t1", channelId: "ch1" },
    content: "Deadline @{0}!",
    mentions: [{ userId: "u1", displayName: "Alice" }],
  });
  assert.deepEqual(out, { id: "msg9" });
  assert.equal(seen[0].method, "POST");
  assert.match(seen[0].path, /\/teams\/t1\/channels\/ch1\/messages/);
  const body = seen[0].body as { body: { contentType: string; content: string }; mentions: unknown[] };
  assert.equal(body.body.contentType, "html");
  assert.match(body.body.content, /<at id="0">Alice<\/at>/);
  assert.equal(body.mentions.length, 1);
});
```

- [ ] **Step 2: RED** — module not found.
- [ ] **Step 3: Implement**

```ts
// service/src/ms365/teams-service.ts
/**
 * TeamsService: Teams chats/channels messaging over Graph. Reads are recent-N (Graph v1.0 has
 * NO $search on chat/channel messages — the model filters client-side; honest, not faked).
 * postMessage builds the html body itself: model text is FULLY HTML-escaped, then @{i}
 * placeholders become <at id="i"> tags — the model never writes raw HTML into Teams.
 */
import type { Ms365Connector } from "./ms365-connector.js";
import { Ms365Error } from "./ms365-errors.js";

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_TEXT_CHARS = 4096;

export interface TeamsChat { id: string; topic: string; memberNames: string[] }
export interface TeamsTeam { id: string; displayName: string }
export interface TeamsChannel { id: string; displayName: string }
export interface TeamsMember { userId: string; displayName: string }
export interface TeamsMessage { id: string; from: string; createdDateTime: string; text: string }
export type MessageTarget = { chatId: string } | { teamId: string; channelId: string };

export interface TeamsService { /* 6 method như spec */ }

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildTeamsBody(
  content: string,
  mentions: Array<{ userId: string; displayName: string }>,
) {
  const escaped = esc(content);
  const used = new Set<number>();
  const html = escaped.replace(/@\{(\d+)\}/g, (_m, idx: string) => {
    const i = Number(idx);
    const mention = mentions[i];
    if (mention === undefined) {
      throw new Ms365Error("graph_error", `Mention placeholder @{${idx}} has no matching mention.`,
        "Bổ sung mentions tương ứng với placeholder rồi thử lại.", false);
    }
    used.add(i);
    return `<at id="${i}">${esc(mention.displayName)}</at>`;
  });
  return {
    body: { contentType: "html" as const, content: html },
    mentions: mentions
      .map((m, i) => ({ id: i, mentionText: m.displayName, mentioned: { user: { id: m.userId, displayName: m.displayName } } }))
      .filter((m) => used.has(m.id)),
  };
}

// ... createTeamsService: mapping helpers (str/asArray như siblings), messagesPath(target),
// từng method theo test — listChats GET /me/chats?$expand=members&$top; listTeams /me/joinedTeams;
// listChannels /teams/{id}/channels; listMembers theo union; getMessages theo union + $top + bounded
// text (slice maxTextChars); postMessage: buildTeamsBody rồi POST {body, mentions} tới messagesPath,
// response thiếu id string → Ms365Error("graph_error", ...). Path ids đều encodeURIComponent.
```

> Phần `createTeamsService` viết đầy đủ theo đúng khuôn `planner-service.ts`/`lists-service.ts` (defensive `str`/`num`/`asArray`, drop entry thiếu id string). Mọi assertion trong 10 test trên là contract chính xác — implement để pass đúng chúng, không thêm bớt. Chú ý: mentions không được placeholder nào dùng thì **bị loại** khỏi mảng mentions gửi đi (test 1 chỉ giữ id 0; giữ hành vi filter theo `used`).

- [ ] **Step 4: GREEN** — 10/10. **Step 5: Commit** — `feat(ms365): TeamsService — recent messages + safe mention body builder`

---

### Task 2: Tool dispatch — 5 read + 1 gated write

**Files:** Modify `ms365-tools.ts`; Test `ms365-teams-tool.test.ts`; stub `teams` vào deps factory của planner/outlook/sites/lists tool tests + router test (không đổi assertions).

**Interfaces:**
- Union += `"teams_list_chats" | "teams_list_teams" | "teams_list_channels" | "teams_list_members" | "teams_get_messages" | "teams_post_message"`; `ToolDeps` += `teams: TeamsService`.
- Read cases (trong `handleRead`): `teams_list_chats`/`teams_list_teams` không args; `teams_list_channels` cần `teamId`; `teams_list_members` cần ĐÚNG MỘT trong `chatId`|`teamId`; `teams_get_messages` cần ĐÚNG MỘT trong `chatId` | (`teamId`+`channelId`) — helper `readTarget(args)` trả `MessageTarget | null` (null khi cả hai/không cái nào) → invalid.
- `handleTeamsWrite` (type-guard `isTeamsWrite`, khuôn `isListsWrite` — docblock GHI RÕ rationale type-guard, sửa luôn asymmetry Minor P3): `teams_post_message` cần target hợp lệ + `content` non-empty string + optional `mentions` (array của `{userId, displayName}` non-empty strings). Description: `Gửi tin nhắn Teams tới ${chatId ?? teamId/channelId}` + ` (mention ${n} người)` khi có. Data trả về: `{ id }` từ service.
- `handleRead` exhaustive default annotation += `"teams_post_message"`.

- [ ] **Step 1: Failing tests** — 8 test khuôn `ms365-lists-tool.test.ts` (teamsStub spy postMessage): 1. list_chats thẳng; 2. get_messages cả chatId lẫn teamId → invalid_input; 3. get_messages thiếu cả hai → invalid_input; 4. post chạy sau Allow (spy=1); 5. post denied → spy=0, kind denied; 6. post thiếu content → invalid_input; 7. post mentions sai shape (thiếu userId) → invalid_input; 8. not_connected.
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN** — 8/8 + 5 suite cũ + router pass. **Step 5: Commit** — `feat(ms365): teams tools — 5 read direct, post behind PermissionGate`

---

### Task 3: Router + index + composition + scope + api-map

- [ ] **Step 1:** TOOL_NAMES += 6 teams names.
- [ ] **Step 2:** `index.ts` export `createTeamsService, buildTeamsBody` + types.
- [ ] **Step 3:** `compose-service.ts`: `const teams = createTeamsService({ connector: ms365Connector });` trong MS365 IIFE; `teams,` vào `tools`; `MS365_SCOPES` += `"Chat.ReadWrite", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Read.All", "ChannelMessage.Send"` + cập nhật comment.
- [ ] **Step 4: Verify** — typecheck 0; full MS365 suite pass; api-map: mục 7 → bảng Teams 6 dòng 🟡 CODE+UNIT (ghi chú honest: không $search server-side) + bảng scope += 5 dòng; renumber các mục sau.
- [ ] **Step 5: Commit** — `feat(ms365): register teams tools + wire TeamsService; Teams scopes`

---

## Self-Review

**Spec coverage:** get recent + model lọc honest (T1 getMessages, không claim search) ✓; post chat + channel (target union, T1/T2) ✓; mentions an toàn (buildTeamsBody escape + placeholder + Graph shape, test HTML-injection case `<b>`/`<QA>`) ✓; resolve member (listMembers) ✓; post qua gate spy-verified (T2) ✓; scope 5 cái least-privilege (T3) ✓; api-map (T3) ✓; sửa docblock asymmetry P3 (T2 isTeamsWrite ghi rationale) ✓.

**Placeholder scan:** T1 `createTeamsService` phần thân được đặc tả bằng 10 test assertions chính xác + khuôn siblings — implementer transcribe theo contract test, không tự chế. Không TBD.

**Type consistency:** `TeamsService`/`MessageTarget` T1→T2→T3; 6 names union↔TOOL_NAMES; `buildTeamsBody` export cho test trực tiếp. ✓
