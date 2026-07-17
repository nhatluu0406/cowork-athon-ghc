# MS365 Live-Readiness Fixpack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng các lỗi chỉ lộ ra với Microsoft Graph THẬT trước ngày test tenant dev: `$expand` Lists, tách 403 thiếu-scope khỏi 401, header `Prefer` cho `$filter`, 412 etag, mở rộng verify script, và sửa UI connect (scope list sai + copy sai + token không mask).

**Architecture:** Các fix điểm huyệt, không đổi kiến trúc: mở rộng `Ms365ErrorKind` + `mapGraphStatus`; thêm seam header cho `GraphClientRequest` qua đúng một đường `send()`; verify script thêm section read-only; UI connect render `view.scopes` (service đã là nguồn sự thật — `ms365-view.ts:26-30`).

**Tech Stack:** TypeScript strict; `node --import tsx --test`; không dependency mới.

## Global Constraints

- **Commit only, KHÔNG push.** Feature flag `CGHC_MS365_ENABLED` OFF mặc định — hành vi baseline không đổi.
- Mọi Graph call vẫn qua MỘT đường `HttpGraphClient.send()` (SSRF-pinned); header mới đi qua request object, không thêm đường fetch nào.
- Error copy: message tiếng Anh kỹ thuật ngắn (khuôn hiện có), `recovery` tiếng Việt user-safe; KHÔNG secret/body Graph thô trong message.
- **Kind mới**: `insufficient_scope` (403) và `precondition_failed` (412) — thêm vào union `Ms365ErrorKind`; 401 GIỮ `auth_expired`. Không đổi hành vi connector với 401.
- Verify script: read-only tuyệt đối (KHÔNG write nào — không create/edit/delete/post/upload); token chỉ từ env `CGHC_MS365_TEST_TOKEN`; không in token; **sau mỗi lượt chạy live phải cập nhật `docs/integration/ms365-graph-api-map.md`** (quy tắc chuẩn).
- UI: không secret trong DOM/state/log; token textarea phải mask hiển thị + clear cả khi connect FAIL; copy tiếng Việt.
- TypeScript strict, không `any`, không cast che lỗi.
- Test: `cd service && node --import tsx --test tests/<file>.test.ts`; UI: `cd app/ui && node --import tsx --test "tests/<file>.test.ts"`; `npm run typecheck` (repo root) exit 0 trước mỗi commit.

## File Structure

| File | Vai trò |
|---|---|
| `service/src/ms365/ms365-errors.ts` (sửa) | 403 → `insufficient_scope`, 412 → `precondition_failed` |
| `service/src/ms365/graph-client.ts` (sửa) | `GraphClientRequest.prefer?: string` → header `prefer` |
| `service/src/ms365/lists-service.ts` (sửa) | `expand` → `$expand`; gửi `Prefer` khi có `$filter` |
| `tools/verify/ms365-live-manual-token.mts` (sửa) | Thêm section Planner/Lists/Teams read-only |
| `app/ui/src/ui-shell/microsoft/ms-connect-view.ts` (sửa) | Scope list từ `view.scopes`; copy storage đúng; token clear-on-fail |
| `app/ui/src/ui-shell/microsoft/microsoft.css` (sửa nhỏ) | Mask token textarea |

---

### Task 1: Tách 403/412 khỏi error mapping (service)

**Files:**
- Modify: `service/src/ms365/ms365-errors.ts`
- Test: `service/tests/ms365-errors.test.ts` (mở rộng)

**Interfaces:**
- Produces: `Ms365ErrorKind` thêm `"insufficient_scope" | "precondition_failed"`; `mapGraphStatus(403)` → kind `insufficient_scope`; `mapGraphStatus(412)` → kind `precondition_failed`. Task 3 (verify script) nhận diện `insufficient_scope` để báo "thiếu scope" thay vì "reconnect".

- [ ] **Step 1: Viết test (fail trước)** — thêm vào `service/tests/ms365-errors.test.ts` (đọc khuôn assert hiện có trong file và theo đúng):

```ts
test("403 maps to insufficient_scope (NOT auth_expired) with consent recovery", () => {
  const err = mapGraphStatus(403);
  assert.equal(err.kind, "insufficient_scope");
  assert.equal(err.retryable, false);
  assert.match(err.recovery, /quyền|scope/i);
  assert.ok(!/kết nối lại/i.test(err.recovery), "403 must not tell the user to reconnect");
});

test("401 still maps to auth_expired with reconnect recovery", () => {
  const err = mapGraphStatus(401);
  assert.equal(err.kind, "auth_expired");
  assert.match(err.recovery, /kết nối lại/i);
});

test("412 maps to precondition_failed with re-read-etag recovery", () => {
  const err = mapGraphStatus(412);
  assert.equal(err.kind, "precondition_failed");
  assert.equal(err.retryable, false);
  assert.match(err.recovery, /etag/i);
});
```

- [ ] **Step 2: RED** — `cd service && node --import tsx --test tests/ms365-errors.test.ts` → FAIL (403 hiện trả `auth_expired`).
- [ ] **Step 3: Implement** — trong `ms365-errors.ts`:

```ts
export type Ms365ErrorKind =
  | "not_connected"
  | "not_configured"
  | "auth_expired"
  | "insufficient_scope"
  | "precondition_failed"
  | "rate_limited"
  | "not_found"
  | "endpoint_blocked"
  | "graph_error";
```

và trong `mapGraphStatus` thay block 401/403 + thêm 412 (TRƯỚC nhánh default):

```ts
  if (status === 401) {
    return new Ms365Error("auth_expired", "Microsoft 365 authorization failed.", "Kết nối lại Microsoft 365.", false);
  }
  if (status === 403) {
    return new Ms365Error(
      "insufficient_scope",
      "The account lacks a required Microsoft Graph permission.",
      "Tài khoản thiếu quyền (scope) cho thao tác này — consent thêm quyền trong Graph Explorer hoặc nhờ admin, rồi lấy token mới.",
      false,
    );
  }
  if (status === 412) {
    return new Ms365Error(
      "precondition_failed",
      "The item changed since it was read (ETag mismatch).",
      "Đọc lại đối tượng (ví dụ planner_list_tasks) để lấy etag mới nhất rồi thử lại.",
      false,
    );
  }
```

- [ ] **Step 4: Kiểm tra không ai phụ thuộc 403→auth_expired** — grep `auth_expired` trong `service/src` + `service/tests`: connector/token-provider chỉ phản ứng với 401 verify-fail (đọc code xác nhận); test nào assert 403→auth_expired thì cập nhật theo mapping mới. Ghi kết quả grep vào report.
- [ ] **Step 5: GREEN** — `cd service && node --import tsx --test tests/ms365-errors.test.ts tests/ms365-graph-client.test.ts tests/ms365-connector.test.ts tests/ms365-manual-token.test.ts` PASS; `npm run typecheck` exit 0.
- [ ] **Step 6: Commit** — `git commit -m "fix(ms365): 403 -> insufficient_scope, 412 -> precondition_failed — honest recovery, no more reconnect loop on missing scopes"`

---

### Task 2: `$expand` fix + `Prefer` header seam (service)

**Files:**
- Modify: `service/src/ms365/graph-client.ts`
- Modify: `service/src/ms365/lists-service.ts`
- Test: `service/tests/ms365-graph-client.test.ts` + `service/tests/ms365-lists-service.test.ts` (mở rộng)

**Interfaces:**
- Consumes: `GraphClientRequest` hiện có (method/path/query/body/ifMatch).
- Produces: `GraphClientRequest.prefer?: string` → gửi header `prefer` (khuôn y hệt `ifMatch` → `if-match`, cùng chỗ build headers trong `send()`); Lists items GET dùng `$expand=fields` và `prefer: "HonorNonIndexedQueriesWarningMayFailRandomly"` khi có filter.

- [ ] **Step 1: Test graph-client (fail trước)** — thêm vào `service/tests/ms365-graph-client.test.ts` (dùng fake fetch/capture headers theo khuôn test `if-match` hiện có trong file):

```ts
test("prefer field is sent as the prefer header through the single send path", async () => {
  // dựng client với fetch giả capture RequestInit y hệt test if-match hiện có
  await client.json({ method: "GET", path: "/sites/s/lists/l/items", prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" });
  assert.equal(capturedHeaders["prefer"], "HonorNonIndexedQueriesWarningMayFailRandomly");
});

test("no prefer field -> no prefer header", async () => {
  await client.json({ method: "GET", path: "/me" });
  assert.equal(capturedHeaders["prefer"], undefined);
});
```

- [ ] **Step 2: Test lists-service (fail trước)** — thêm vào `service/tests/ms365-lists-service.test.ts` (fake graph client của file đó đã capture request):

```ts
test("getItems sends $expand=fields (with $ prefix) — real Graph ignores bare 'expand'", async () => {
  await lists.getItems("site-1", "list-1");
  assert.equal(capturedRequest.query?.["$expand"], "fields");
  assert.equal(capturedRequest.query?.["expand"], undefined);
});

test("getItems with a filter sends the non-indexed-query Prefer header; without filter it does not", async () => {
  await lists.getItems("site-1", "list-1", "fields/Title eq 'x'");
  assert.equal(capturedRequest.prefer, "HonorNonIndexedQueriesWarningMayFailRandomly");
  await lists.getItems("site-1", "list-1");
  assert.equal(capturedRequest.prefer, undefined);
});
```

- [ ] **Step 3: RED** — chạy 2 file test trên → FAIL.
- [ ] **Step 4: Implement** —
  - `graph-client.ts`: thêm `prefer?: string` vào `GraphClientRequest` (cạnh `ifMatch`) và trong chỗ build headers của `send()` (ngay sau dòng `if-match`): `if (req.prefer !== undefined) headers["prefer"] = req.prefer;` (đọc code thật để đặt đúng cấu trúc headers hiện có).
  - `lists-service.ts` `getItems`: sửa dòng 72 `{ expand: "fields", ... }` → `{ "$expand": "fields", $top: String(cap) }`; và khi `filter !== undefined` thêm `prefer` vào request object gửi graph:

```ts
      const query: Record<string, string> = { "$expand": "fields", $top: String(cap) };
      if (filter !== undefined) query.$filter = filter;
      const res = await graph().json<ListResponse<RawItem>>({
        method: "GET",
        path: `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items`,
        query,
        ...(filter !== undefined ? { prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" } : {}),
      });
```

  (đối chiếu shape thật của `getItems` trong file — giữ nguyên phần map kết quả.)
- [ ] **Step 5: GREEN** — `cd service && node --import tsx --test tests/ms365-graph-client.test.ts tests/ms365-lists-service.test.ts tests/ms365-lists-tool.test.ts` PASS; typecheck 0.
- [ ] **Step 6: Commit** — `git commit -m "fix(ms365): Lists \$expand=fields (bare 'expand' silently ignored by real Graph) + Prefer header seam for non-indexed \$filter"`

---

### Task 3: Mở rộng live verify script — Planner/Lists/Teams read-only

**Files:**
- Modify: `tools/verify/ms365-live-manual-token.mts`

**Interfaces:**
- Consumes: các factory service hiện có (`createPlannerService`, `createListsService`, `createTeamsService` từ `service/src/ms365/index.js` — xem cách script hiện dựng connector/sharepoint/outlook và làm y hệt); `Ms365Error.kind` mới `insufficient_scope` (Task 1).
- Produces: các section output mới `PLANNER`, `LISTS`, `TEAMS` với verdict per-endpoint `PASS` / `SKIP (thiếu scope: …)` / `FAIL (kind: message)`.

- [ ] **Step 1: Đọc script hiện tại** — nắm khuôn section (connect + /me + sites + outlook), helper in kết quả, cách bắt `Ms365Error`.
- [ ] **Step 2: Thêm 3 section read-only** (sau section Outlook, cùng khuôn try/catch; mỗi call bọc helper `probe(label, fn)` — nếu script chưa có helper thì thêm):

```ts
async function probe(label: string, fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`  ${label}: PASS — ${await fn()}`);
  } catch (err) {
    if (err instanceof Ms365Error && err.kind === "insufficient_scope") {
      console.log(`  ${label}: SKIP — thiếu scope (${err.recovery})`);
    } else if (err instanceof Ms365Error) {
      console.log(`  ${label}: FAIL — ${err.kind}: ${err.message}`);
    } else {
      console.log(`  ${label}: FAIL — unexpected error`);
    }
  }
}

console.log("PLANNER (read-only)");
const planner = createPlannerService({ connector });
let firstPlanId: string | null = null;
await probe("planner_list_plans", async () => {
  const plans = await planner.listPlans();
  firstPlanId = plans[0]?.id ?? null;
  return `${plans.length} plan`;
});
await probe("planner_list_tasks", async () => {
  if (firstPlanId === null) return "bỏ qua — không có plan nào";
  const tasks = await planner.listTasks(firstPlanId);
  const withEtag = tasks.filter((t) => t.etag.length > 0).length;
  return `${tasks.length} task, ${withEtag} có etag (etag round-trip khả dụng)`;
});

console.log("LISTS (read-only)");
const lists = createListsService({ connector, siteFilter: { isEnabled: () => true } });
// dùng siteId đầu tiên lấy được từ section sites phía trên (script đã list sites); nếu section
// sites SKIP vì thiếu scope thì cả section này SKIP với lý do đó.
await probe("lists_get_lists", async () => {
  if (firstSiteId === null) return "bỏ qua — không có site (xem section SITES)";
  const found = await lists.getLists(firstSiteId);
  firstListId = found[0]?.id ?? null;
  return `${found.length} list`;
});
await probe("lists_get_items ($expand=fields)", async () => {
  if (firstSiteId === null || firstListId === null) return "bỏ qua — không có list";
  const items = await lists.getItems(firstSiteId, firstListId);
  const withFields = items.filter((i) => Object.keys(i.fields).length > 0).length;
  // Đây là bằng chứng sống cho fix $expand: fields phải KHÔNG rỗng nếu list có cột dữ liệu.
  return `${items.length} item, ${withFields} item có fields`;
});

console.log("TEAMS (read-only)");
const teams = createTeamsService({ connector });
let firstChatId: string | null = null;
await probe("teams_list_chats", async () => {
  const chats = await teams.listChats();
  firstChatId = chats[0]?.id ?? null;
  return `${chats.length} chat`;
});
await probe("teams_list_teams", async () => `${(await teams.listTeams()).length} team`);
await probe("teams_get_messages", async () => {
  if (firstChatId === null) return "bỏ qua — không có chat";
  return `${(await teams.getMessages({ chatId: firstChatId })).length} tin gần nhất`;
});
```

  (Điều chỉnh tên biến/`firstSiteId` theo code thật của script — nếu section sites hiện không giữ id, thêm biến giữ. Đối chiếu chữ ký `createListsService`/`createTeamsService` trong `service/src/ms365/index.ts` — ví dụ `getItems(siteId, listId, filter?)` và `getMessages(target)` — sửa cho khớp. KHÔNG thêm bất kỳ call write nào.)
- [ ] **Step 3: Smoke không-token** — `node --import tsx tools/verify/ms365-live-manual-token.mts` (không set env) → script phải thoát sớm với thông báo thiếu `CGHC_MS365_TEST_TOKEN` như hiện tại (không crash vì code mới).
- [ ] **Step 4: Typecheck** — `npm run typecheck` exit 0 (script .mts nằm trong scope tsc? nếu không, chạy `node --import tsx --check`-tương-đương bằng cách import khô: đảm bảo script parse được — bước smoke ở trên đã chứng minh).
- [ ] **Step 5: Cập nhật header comment** của script: liệt kê các section mới + nhắc lại quy tắc "mỗi lượt chạy live PHẢI cập nhật docs/integration/ms365-graph-api-map.md".
- [ ] **Step 6: Commit** — `git commit -m "feat(verify): extend MS365 live verifier with read-only Planner/Lists/Teams probes (catches \$expand + scope gaps)"`

---

### Task 4: UI connect — scope list thật, copy đúng, token mask + clear-on-fail

**Files:**
- Modify: `app/ui/src/ui-shell/microsoft/ms-connect-view.ts`
- Modify: `app/ui/src/ui-shell/microsoft/microsoft.css`
- Test: `app/ui/tests/ms-connect-view.test.ts` (mở rộng — nếu file chưa tồn tại, tạo theo khuôn happy-dom của `tests/ms-assistant-view.test.ts`)

**Interfaces:**
- Consumes: `Ms365ViewData.scopes` — service đã trả danh sách ĐÚNG (khi chưa connect = `MS365_SCOPES` service sẽ xin; khi connected = scope thật decode từ token — `service/src/ms365/ms365-view.ts:26-30`).
- Produces: xóa export `MS365_REQUESTED_SCOPES`; scope list render từ `deps.view.scopes` + map chú thích `MS365_SCOPE_NOTES` nội bộ.

- [ ] **Step 1: Test (fail trước)** — trong `app/ui/tests/ms-connect-view.test.ts`:

```ts
test("sign-in card renders the scopes from view.scopes (service truth), not a hard-coded list", () => {
  const view = disconnectedView({ scopes: ["Files.ReadWrite.All", "Tasks.ReadWrite"] });
  renderMsConnect(container, { view, client: fakeClient(), onViewChange: () => {} });
  const codes = [...container.querySelectorAll(".ms-scope-list__scope")].map((n) => n.textContent);
  assert.deepEqual(codes, ["Files.ReadWrite.All", "Tasks.ReadWrite"]);
  assert.ok(!container.textContent?.includes("Mail.Send"), "stale hard-coded scopes must be gone");
});

test("storage copy says in-memory, not Windows Credential Manager", () => {
  renderMsConnect(container, { view: disconnectedView({}), client: fakeClient(), onViewChange: () => {} });
  const note = container.querySelector(".ms-connect__oauth-note")?.textContent ?? "";
  assert.ok(!/Credential Manager/i.test(note));
  assert.match(note, /bộ nhớ|in-memory/i);
});

test("manual token textarea is masked and cleared when connect FAILS", async () => {
  const client = fakeClient({ connectMs365Token: () => Promise.reject(new Error("bad")) });
  renderMsConnect(container, { view: disconnectedView({}), client, onViewChange: () => {} });
  const input = container.querySelector(".ms-connect__manual-input") as HTMLTextAreaElement;
  assert.ok(input.classList.contains("ms-connect__manual-input--masked"));
  input.value = "eyJhbGciOi...";
  (container.querySelector(".ms-connect__manual-submit") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(input.value, "", "token must not linger in the DOM after a failed connect");
});
```

  (`disconnectedView`/`fakeClient` helpers: nếu file test đã tồn tại thì tái dùng helpers của nó; chưa có thì viết helper dựng `Ms365ViewData` tối thiểu + client stub đủ 7 method.)
- [ ] **Step 2: RED** — `cd app/ui && node --import tsx --test "tests/ms-connect-view.test.ts"` → FAIL.
- [ ] **Step 3: Implement** — trong `ms-connect-view.ts`:
  - XÓA `MS365_REQUESTED_SCOPES` (kiểm tra không còn import nào — grep toàn `app/ui`); thêm map chú thích:

```ts
/** Chú thích tiếng Việt cho các scope đã biết; scope lạ hiển thị không chú thích. */
const MS365_SCOPE_NOTES: Readonly<Record<string, string>> = {
  "Files.ReadWrite.All": "Đọc và tải tệp lên OneDrive/SharePoint",
  "Sites.ReadWrite.All": "Site + SharePoint Lists (đọc/ghi)",
  "Mail.Read": "Đọc thư Outlook (không gửi)",
  "Tasks.ReadWrite": "Đọc và cập nhật task Planner",
  "Chat.ReadWrite": "Chat Teams của bạn (đọc/gửi)",
  "Team.ReadBasic.All": "Danh sách team đã tham gia",
  "Channel.ReadBasic.All": "Danh sách channel",
  "ChannelMessage.Read.All": "Đọc tin nhắn channel",
  "ChannelMessage.Send": "Đăng tin nhắn channel (cần phê duyệt)",
};
```

  - Trong `renderSignInCard`, vòng for đổi nguồn:

```ts
  for (const scope of deps.view.scopes) {
    const li = el("li", "ms-scope-list__item");
    li.append(el("code", "ms-scope-list__scope", scope), el("span", "ms-scope-list__note", MS365_SCOPE_NOTES[scope] ?? ""));
    scopeList.append(li);
  }
```

  - `oauthNote` đổi copy: `"Đăng nhập dùng OAuth loopback; token chỉ giữ trong bộ nhớ phiên làm việc (in-memory), không ghi ra đĩa và không nằm trong trạng thái UI."`
  - `renderManualFallback`: thêm class mask `input.classList.add("ms-connect__manual-input--masked");` và trong `.catch(...)` thêm `input.value = "";` (giữ nguyên error copy).
  - `microsoft.css` thêm:

```css
.ms-connect__manual-input--masked {
  -webkit-text-security: disc;
}
```

- [ ] **Step 4: GREEN** — test Step 1 PASS + `cd app/ui && node --import tsx --test "tests/ms-assistant-view.test.ts" "tests/microsoft-view.test.ts"` (hồi quy) PASS; `npm run typecheck` exit 0.
- [ ] **Step 5: Docs** — `docs/product/current-status.md`: gỡ/đánh dấu resolved mục "stale UI MS365_REQUESTED_SCOPES" trong các block hạn chế cũ (chỉ mục nhắc tới nó — thêm dòng "(đã sửa 2026-07-15, fixpack)" thay vì xóa lịch sử); `docs/integration/ms365-graph-api-map.md` mục 10: ghi chú 403 giờ báo `insufficient_scope` với recovery consent.
- [ ] **Step 6: Commit** — `git commit -m "fix(ui): MS365 connect — scopes rendered from service truth, honest in-memory copy, masked token field cleared on failure"`

---

## Self-Review (đã chạy)

- **Coverage vs review findings:** C3 `$expand` → Task 2; C2 403 → Task 1; I1 Prefer → Task 2; I3 412 → Task 1; I5 verify script → Task 3; I4 UI scopes/copy + security-review I-3 mask/clear → Task 4. Seam socket-120s và MCP: ngoài phạm vi (đã ghi ledger).
- **Placeholder scan:** các chỗ "đọc code thật để đặt đúng" là chỉ dẫn đối chiếu shape (file đã nêu đích danh + dòng), không phải TBD.
- **Type consistency:** `insufficient_scope` dùng ở Task 1 (union) và Task 3 (probe); `prefer?: string` Task 2 dùng đúng tên ở graph-client + lists-service; `MS365_SCOPE_NOTES`/`view.scopes` chỉ trong Task 4.
