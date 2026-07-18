# MS365 Outlook (read-only) P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI tìm kiếm + tóm tắt/giải thích mail của user (chỉ đọc, `/me/messages`) qua 3 read tool, tái dùng `Ms365Connector` sẵn có.

**Architecture:** Thêm `OutlookService` bên cạnh `SharePointService`/`SiteScopeService`, cùng gọi `Ms365Connector.graph()` — không sửa core. Ba read tool cắm vào `ms365-tool-router`, chạy trực tiếp sau guard `not_connected`, KHÔNG qua PermissionGate (read-only). Bounded: cap results + cap body bytes. Query do model dựng nhưng service kiểm soát để model không chèn path Graph tùy ý.

**Tech Stack:** TypeScript strict ESM (`.js` suffix), Node `node:test` + `node:assert/strict`, Microsoft Graph v1.0 `/me/messages`, existing loopback `BoundaryRouter`.

## Global Constraints

- TypeScript strict; no `any`; no casts to hide errors. ESM imports use `.js` suffix (matches every file under `service/src/ms365/`).
- Read only via `Ms365Connector.graph()` — never touch token/keyring/Graph HTTP directly (same discipline as `SharePointService`).
- All P1 tools are READ → run directly after the `not_connected` guard, NO PermissionGate.
- Bounded: search results cap default 25; body download cap 65536 bytes (64 KiB), reusing SharePoint's `DEFAULT_MAX_SUMMARY_BYTES` value.
- Query is model-supplied but service-controlled: pass it ONLY as the value of Graph `$search`/`$filter` query params — never interpolate model text into the URL path/segment.
- No token/secret in any returned object, log, or tool-call envelope. Mail content flows only through the tool result to the model; never persisted outside the turn.
- Feature flag `CGHC_MS365_ENABLED` OFF by default; construction stays inside the existing `isMs365Enabled(process.env)` block in `compose-service.ts`.
- Scope requested: `Mail.Read` (add to `MS365_SCOPES` only if that constant drives the requested-scope list; confirm before editing — do not silently change the connect scope set without checking how `MS365_SCOPES` is used).
- Test command (from `service/`): `node --import tsx --test tests/ms365-outlook-service.test.ts` (one file) — mirror `service/package.json`'s `test` script exactly; do not invent a runner.

## File Structure

- **Create `service/src/ms365/outlook-service.ts`** — `OutlookService`: `searchMessages`, `getMessage`, `getMessageSummaryText`. Depends on `Ms365Connector`. One responsibility: Outlook read over Graph.
- **Modify `service/src/ms365/ms365-tools.ts`** — add 3 tool names to `Ms365ToolName`; add `outlook: OutlookService` to `ToolDeps`; add 3 cases to `handleRead`.
- **Modify `service/src/ms365/ms365-tool-router.ts`** — add the 3 tool names to `TOOL_NAMES` (so the tool-call route accepts them). No new HTTP route needed (tools dispatch through the existing `MS365_TOOL_CALL_PATH`).
- **Modify `service/src/ms365/index.ts`** — export `createOutlookService` + types.
- **Modify `service/src/composition/compose-service.ts`** — construct `OutlookService` inside the MS365 block, wire into router `tools`.
- **Create tests** — `ms365-outlook-service.test.ts`, and extend the tool dispatch test with the not_connected + read-runs-directly path.

Task order: service (leaf on connector) → tool dispatch → router names → composition wiring.

---

### Task 1: OutlookService (search / get / summary over /me/messages)

**Files:**
- Create: `service/src/ms365/outlook-service.ts`
- Test: `service/tests/ms365-outlook-service.test.ts`

**Interfaces:**
- Consumes: `Ms365Connector` (`./ms365-connector.js`) via `.graph()` → `GraphClient.json<T>(req)` / `.bytes(req)`.
- Produces:
  - `interface OutlookMessageHit { id: string; subject: string; from: string; receivedDateTime: string; bodyPreview: string }`
  - `interface OutlookService { searchMessages(query: string, limit?: number): Promise<OutlookMessageHit[]>; getMessage(id: string): Promise<OutlookMessageHit & { body: string }>; getMessageSummaryText(id: string): Promise<string>; }`
  - `function createOutlookService(deps: { connector: Ms365Connector; maxResults?: number; maxSummaryBytes?: number }): OutlookService` (defaults 25 / 65536).
  - `searchMessages` issues `GET /me/messages` with query params `{ $search: '"' + query + '"', $top: String(cap) }` (Graph `$search` requires the value quoted). Defensive-map `value[]` → hits, dropping entries with a non-string `id` or `subject`; `from` reads `from.emailAddress.address` else `""`; missing `bodyPreview`/`receivedDateTime` → `""`.
  - `getMessage` issues `GET /me/messages/{id}` (id `encodeURIComponent`-ed in the PATH — this is an id we control the shape of, not free model text) and returns the hit plus `body` = `body.content` (string, else "").
  - `getMessageSummaryText` fetches the message and returns `body.content` truncated to `maxSummaryBytes` (decode-safe: slice the string, or fetch `.bytes` and TextDecode a truncated slice like SharePoint's `getFileSummaryText`).

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-outlook-service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutlookService } from "../src/ms365/outlook-service.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";
import type { GraphClient, GraphClientRequest } from "../src/ms365/graph-client.js";

function connectorReturning(
  recorder: GraphClientRequest[],
  responder: (r: GraphClientRequest) => unknown,
): Ms365Connector {
  const graph: GraphClient = {
    json: async (r) => {
      recorder.push(r);
      return responder(r) as never;
    },
    bytes: async (r) => {
      recorder.push(r);
      return responder(r) as Uint8Array;
    },
  };
  return {
    connectionState: () => "connected",
    connectWithToken: async () => {},
    disconnect: async () => {},
    graph: () => graph,
    source: () => "manual_token",
    lastError: () => null,
  };
}

test("searchMessages hits /me/messages with a quoted $search and caps results", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({
    value: [
      { id: "m1", subject: "Q report", from: { emailAddress: { address: "a@x.com" } }, receivedDateTime: "2026-07-01T00:00:00Z", bodyPreview: "hello" },
      { id: "m2", subject: "Q2", from: { emailAddress: { address: "b@x.com" } }, receivedDateTime: "2026-07-02T00:00:00Z", bodyPreview: "hi" },
    ],
  }));
  const svc = createOutlookService({ connector: conn, maxResults: 1 });
  const hits = await svc.searchMessages("quarterly");
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], {
    id: "m1", subject: "Q report", from: "a@x.com", receivedDateTime: "2026-07-01T00:00:00Z", bodyPreview: "hello",
  });
  assert.equal(seen[0].method, "GET");
  assert.match(seen[0].path, /\/me\/messages/);
  assert.equal(seen[0].query?.["$search"], '"quarterly"');
});

test("searchMessages drops malformed entries and defaults missing fields", async () => {
  const conn = connectorReturning([], () => ({
    value: [
      { id: "m1", subject: "ok" }, // missing from/date/preview → defaulted to ""
      { id: 5, subject: "bad id" }, // non-string id → dropped
      { subject: "no id" }, // missing id → dropped
    ],
  }));
  const svc = createOutlookService({ connector: conn });
  const hits = await svc.searchMessages("x");
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], { id: "m1", subject: "ok", from: "", receivedDateTime: "", bodyPreview: "" });
});

test("getMessage returns detail + body", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({
    id: "m1", subject: "S", from: { emailAddress: { address: "a@x.com" } },
    receivedDateTime: "2026-07-01T00:00:00Z", bodyPreview: "p", body: { content: "full body" },
  }));
  const svc = createOutlookService({ connector: conn });
  const msg = await svc.getMessage("m1");
  assert.equal(msg.body, "full body");
  assert.equal(msg.from, "a@x.com");
  assert.match(seen[0].path, /\/me\/messages\/m1/);
});

test("getMessageSummaryText truncates body at maxSummaryBytes", async () => {
  const conn = connectorReturning([], () => ({ id: "m1", subject: "S", body: { content: "abcdefghij".repeat(10) } }));
  const svc = createOutlookService({ connector: conn, maxSummaryBytes: 10 });
  const text = await svc.getMessageSummaryText("m1");
  assert.equal(text, "abcdefghij");
});

test("searchMessages returns [] on a malformed/empty response (no throw)", async () => {
  const conn = connectorReturning([], () => ({}));
  const svc = createOutlookService({ connector: conn });
  assert.deepEqual(await svc.searchMessages("x"), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd service && node --import tsx --test tests/ms365-outlook-service.test.ts`
Expected: FAIL — cannot find module `../src/ms365/outlook-service.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// service/src/ms365/outlook-service.ts
/**
 * OutlookService: read-only mail over Microsoft Graph /me/messages. Reuses
 * Ms365Connector.graph() exactly like SharePointService — no direct Graph/token/keyring
 * access. Model-supplied query goes ONLY into the $search value, never the URL path.
 */
import type { Ms365Connector } from "./ms365-connector.js";

const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_MAX_SUMMARY_BYTES = 65536; // 64 KiB, matching SharePoint summary.

export interface OutlookMessageHit {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  bodyPreview: string;
}

export interface OutlookService {
  searchMessages(query: string, limit?: number): Promise<OutlookMessageHit[]>;
  getMessage(id: string): Promise<OutlookMessageHit & { body: string }>;
  getMessageSummaryText(id: string): Promise<string>;
}

interface RawMessage {
  id?: unknown;
  subject?: unknown;
  from?: { emailAddress?: { address?: unknown } };
  receivedDateTime?: unknown;
  bodyPreview?: unknown;
  body?: { content?: unknown };
}
interface MessagesResponse {
  value?: RawMessage[];
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Maps a raw Graph message to a hit, or null when the required id/subject are missing. */
function toHit(raw: RawMessage): OutlookMessageHit | null {
  if (typeof raw?.id !== "string" || typeof raw?.subject !== "string") return null;
  return {
    id: raw.id,
    subject: raw.subject,
    from: str(raw.from?.emailAddress?.address),
    receivedDateTime: str(raw.receivedDateTime),
    bodyPreview: str(raw.bodyPreview),
  };
}

export function createOutlookService(deps: {
  connector: Ms365Connector;
  maxResults?: number;
  maxSummaryBytes?: number;
}): OutlookService {
  const maxResults = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxSummaryBytes = deps.maxSummaryBytes ?? DEFAULT_MAX_SUMMARY_BYTES;

  async function fetchMessage(id: string): Promise<RawMessage> {
    const graph = deps.connector.graph();
    return graph.json<RawMessage>({ method: "GET", path: `/me/messages/${encodeURIComponent(id)}` });
  }

  return {
    async searchMessages(query: string, limit?: number): Promise<OutlookMessageHit[]> {
      const cap = limit ?? maxResults;
      const graph = deps.connector.graph();
      const response = await graph.json<MessagesResponse>({
        method: "GET",
        path: "/me/messages",
        query: { $search: `"${query}"`, $top: String(cap) },
      });
      const hits: OutlookMessageHit[] = [];
      for (const raw of asArray(response.value)) {
        const hit = toHit(raw);
        if (hit !== null) hits.push(hit);
        if (hits.length >= cap) break;
      }
      return hits;
    },

    async getMessage(id: string): Promise<OutlookMessageHit & { body: string }> {
      const raw = await fetchMessage(id);
      const hit = toHit(raw);
      if (hit === null) {
        // Reuse the connector's typed-error convention rather than a bare throw.
        throw new Error("Microsoft Graph message response missing id/subject.");
      }
      return { ...hit, body: str(raw.body?.content) };
    },

    async getMessageSummaryText(id: string): Promise<string> {
      const raw = await fetchMessage(id);
      const content = str(raw.body?.content);
      return content.length > maxSummaryBytes ? content.slice(0, maxSummaryBytes) : content;
    },
  };
}
```

> Note on the `getMessage` throw: check how `SharePointService.upload` signals a bad Graph response (it throws a plain `Error`). Mirror whatever that file does — if it uses `Ms365Error`, use `Ms365Error` here too for consistency. Do not swallow.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd service && node --import tsx --test tests/ms365-outlook-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/outlook-service.ts service/tests/ms365-outlook-service.test.ts
git commit -m "feat(ms365): OutlookService read-only search/get/summary over /me/messages"
```

---

### Task 2: Wire 3 Outlook read tools into dispatch

**Files:**
- Modify: `service/src/ms365/ms365-tools.ts`
- Test: `service/tests/ms365-outlook-tool.test.ts`

**Interfaces:**
- Consumes: `OutlookService` (Task 1); existing `ToolDeps`, `handleToolCall`, `handleRead`.
- Produces: adds `"outlook_search_messages" | "outlook_get_message" | "outlook_summarize_message"` to `Ms365ToolName`; adds `outlook: OutlookService` to `ToolDeps`; 3 cases in `handleRead` returning `{ ok: true, data: ... }`. All read → no gate. Args validated with the existing `nonEmptyString` (query for search, id for the other two) → `invalid(...)` when missing.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-outlook-tool.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    sharepoint: {
      search: async () => [],
      listSiteFiles: async () => [],
      getFileSummaryText: async () => "",
      upload: async () => ({ id: "x", webUrl: "u" }),
    },
    siteScope: { listJoinedSites: async () => [] },
    outlook: {
      searchMessages: async () => [
        { id: "m1", subject: "S", from: "a@x.com", receivedDateTime: "2026-07-01T00:00:00Z", bodyPreview: "p" },
      ],
      getMessage: async () => ({ id: "m1", subject: "S", from: "a@x.com", receivedDateTime: "d", bodyPreview: "p", body: "full" }),
      getMessageSummaryText: async () => "summary text",
    },
    connectionState: () => "connected",
    gate: { submit: () => {}, proceed: () => ({ performed: false }) } as unknown as ToolDeps["gate"],
    now: () => "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

test("outlook_search_messages returns hits (read, no gate)", async () => {
  const r = await handleToolCall(deps(), { name: "outlook_search_messages", args: { query: "q" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && Array.isArray(r.data) && (r.data as unknown[]).length, 1);
});

test("outlook_search_messages without query → invalid_input", async () => {
  const r = await handleToolCall(deps(), { name: "outlook_search_messages", args: {}, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
});

test("outlook_get_message returns detail", async () => {
  const r = await handleToolCall(deps(), { name: "outlook_get_message", args: { id: "m1" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
});

test("outlook_summarize_message returns text", async () => {
  const r = await handleToolCall(deps(), { name: "outlook_summarize_message", args: { id: "m1" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.data, "summary text");
});

test("outlook tools fail closed when not connected", async () => {
  const r = await handleToolCall(deps({ connectionState: () => "disconnected" }), { name: "outlook_search_messages", args: { query: "q" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "not_connected");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd service && node --import tsx --test tests/ms365-outlook-tool.test.ts`
Expected: FAIL — `outlook` not on `ToolDeps` / tool names not handled.

- [ ] **Step 3: Modify the implementation**

In `service/src/ms365/ms365-tools.ts`:

1. Import + extend the union + deps:

```ts
import type { OutlookService } from "./outlook-service.js";

export type Ms365ToolName =
  | "sharepoint_search"
  | "sharepoint_list_site_files"
  | "sharepoint_get_file_summary"
  | "sharepoint_upload_file"
  | "ms365_list_joined_sites"
  | "outlook_search_messages"
  | "outlook_get_message"
  | "outlook_summarize_message";

export interface ToolDeps {
  sharepoint: SharePointService;
  siteScope: Pick<SiteScopeService, "listJoinedSites">;
  outlook: OutlookService;
  connectionState: () => Ms365ConnectionState;
  gate: PermissionGate;
  now: () => string;
}
```

2. Add three cases to `handleRead`'s switch (before the `default`):

```ts
case "outlook_search_messages": {
  if (!nonEmptyString(call.args.query)) return invalid("outlook_search_messages cần query là chuỗi không rỗng.");
  return { ok: true, data: await deps.outlook.searchMessages(call.args.query) };
}
case "outlook_get_message": {
  if (!nonEmptyString(call.args.id)) return invalid("outlook_get_message cần id là chuỗi.");
  return { ok: true, data: await deps.outlook.getMessage(call.args.id) };
}
case "outlook_summarize_message": {
  if (!nonEmptyString(call.args.id)) return invalid("outlook_summarize_message cần id là chuỗi.");
  return { ok: true, data: await deps.outlook.getMessageSummaryText(call.args.id) };
}
```

> The exhaustive `default` cast `const exhaustive: "sharepoint_upload_file" = call.name;` stays valid because upload is still routed in `handleToolCall` before `handleRead`, and all other read names now have a case. If TS complains that the union isn't exhausted, add the missing read case rather than casting.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd service && node --import tsx --test tests/ms365-outlook-tool.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-tools.ts service/tests/ms365-outlook-tool.test.ts
git commit -m "feat(ms365): dispatch 3 Outlook read tools (no gate, not_connected guard)"
```

---

### Task 3: Router tool names + index export + composition wiring

**Files:**
- Modify: `service/src/ms365/ms365-tool-router.ts` (add 3 names to `TOOL_NAMES`)
- Modify: `service/src/ms365/index.ts` (export `createOutlookService` + types)
- Modify: `service/src/composition/compose-service.ts` (construct + wire)
- Test: rely on `npm run typecheck` + the existing `ms365-tool-router.test.ts` (the tool-call route must accept the new names) + full MS365 suite. Add a router test only if the router logic itself changed beyond the name list (it does not).

**Interfaces:**
- Consumes: `createOutlookService` (Task 1); existing router `TOOL_NAMES`, `Ms365RouterDeps.tools`.
- Produces: the 3 new names accepted by `MS365_TOOL_CALL_PATH`; `OutlookService` constructed in composition and passed as `tools.outlook`.

- [ ] **Step 1: Add tool names to the router allowlist**

In `service/src/ms365/ms365-tool-router.ts`, extend `TOOL_NAMES`:

```ts
const TOOL_NAMES: readonly Ms365ToolName[] = [
  "sharepoint_search",
  "sharepoint_list_site_files",
  "sharepoint_get_file_summary",
  "sharepoint_upload_file",
  "ms365_list_joined_sites",
  "outlook_search_messages",
  "outlook_get_message",
  "outlook_summarize_message",
];
```

- [ ] **Step 2: Export from index.ts**

In `service/src/ms365/index.ts`:

```ts
export {
  createOutlookService,
  type OutlookService,
  type OutlookMessageHit,
} from "./outlook-service.js";
```

- [ ] **Step 3: Wire into composition**

In `service/src/composition/compose-service.ts`, inside the MS365 IIFE (after `ms365Connector` is built, alongside `sharepoint`/`siteScope`):

```ts
const outlook = createOutlookService({ connector: ms365Connector });
```

Add `outlook` to the router `tools` object:

```ts
tools: {
  sharepoint,
  siteScope: { listJoinedSites: () => siteScope.listJoinedSites() },
  outlook,
  connectionState: () => ms365Connector.connectionState(),
  gate: permissionGate,
  now,
},
```

Add `createOutlookService` to the existing `from "../ms365/index.js"` import group.

> Scope check: if `MS365_SCOPES` (the requested-scope constant) is where least-privilege scopes are declared, add `"Mail.Read"` there. Grep `MS365_SCOPES` first to confirm it is the requested-scope list and not something else; if adding a scope changes the connect consent prompt, that is intended for P1. If unsure, report before editing.

- [ ] **Step 4: Typecheck + full MS365 suite**

Run: `npm run typecheck` → expect exit 0.
Run: `cd service && node --import tsx --test tests/ms365-*.test.ts` → all MS365 suites PASS, including `ms365-flag-off.test.ts` (flag OFF constructs nothing new) and the two new Outlook suites.

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-tool-router.ts service/src/ms365/index.ts service/src/composition/compose-service.ts
git commit -m "feat(ms365): register Outlook tools in router + wire OutlookService in composition"
```

---

## Self-Review

**Spec coverage (P1 spec):**
- `outlook_search_messages` (metadata+snippet, model query, capped) → Task 1 (`searchMessages`), Task 2 (dispatch), Task 3 (router accept). ✓
- `outlook_get_message` + `outlook_summarize_message` (bounded body) → Task 1, 2, 3. ✓
- Read-only, no PermissionGate, `not_connected` fail closed → Task 2 (cases in `handleRead`, tested incl. not_connected). ✓
- No secret in output; service only via `Ms365Connector` → Task 1 (no token handling; connector.graph only). ✓
- Query controlled — model text only in `$search` value, id `encodeURIComponent` in path → Task 1 (`searchMessages` query param; `fetchMessage` path encode). ✓
- Scope `Mail.Read` → Task 3 Step 3 note (grep-gated edit of `MS365_SCOPES`). ✓
- Flag OFF default → Task 3 (construction inside existing flag block); verified by `ms365-flag-off.test.ts`. ✓

**Placeholder scan:** No TBD/TODO; full code in every code step; commands have expected output. The two guarded edits (`getMessage` throw style, `MS365_SCOPES`) carry explicit "grep/confirm first" instructions rather than a guessed value — guidance, not placeholder.

**Type consistency:** `OutlookMessageHit`/`OutlookService` (Task 1) consumed unchanged by Task 2 (`ToolDeps.outlook`) and Task 3 (`tools.outlook`, index export); tool names identical across `Ms365ToolName` (Task 2) and `TOOL_NAMES` (Task 3). Names align.
