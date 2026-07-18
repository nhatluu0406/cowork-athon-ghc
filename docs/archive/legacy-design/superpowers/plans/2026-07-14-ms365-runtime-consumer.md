# MS365 Runtime Consumer (P5.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenCode child thực sự gọi được 25 tool MS365: plugin file per-launch + gate-wait cho write (sửa deny-loop) + token scoped riêng cho route tool-call.

**Architecture:** Theo spec `docs/superpowers/specs/2026-07-14-ms365-runtime-consumer-design.md`. Plugin TS ghi vào `OPENCODE_CONFIG_DIR` (registry v1.17.11 quét `plugin/*.ts` ở đó, đăng ký `tool:{...}` đúng tên as-is); deps pre-seed vào `<configDir>/node_modules` để không cần mạng; write handler đợi quyết định gate bằng poll `isAllowed`/`pending()` — PermissionGate core không đổi; HttpService thêm path-scoped token.

**Tech Stack:** TypeScript strict; `node --import tsx --test`; dependency mới duy nhất: `@opencode-ai/plugin@1.17.11` (lockstep với binary pin, license MIT).

## Global Constraints

- **Commit only, KHÔNG push.**
- **PermissionGate core (`service/src/permission/permission-gate.ts`) KHÔNG đổi.** Deny/không-quyết-định = mutation không chạy. 1 request → 1 quyết định. Batch giữ `manual_mode` check TRƯỚC `gate.submit`.
- Flag `CGHC_MS365_ENABLED` OFF → không plugin file, không policy entry mới, không token mint thêm, không construct gì — baseline không đổi.
- **Secrets không bao giờ nằm trong bytes của plugin file / opencode.json** — endpoint+token chỉ đọc `process.env` lúc plugin chạy. Tái dùng guard refuse-if-secret-bytes hiện có.
- `CGHC_MS365_TOKEN` (env child) = token SCOPED chỉ pass được `/v1/ms365/tool-call`; bị 403 mọi route khác. Main clientToken không đưa vào child.
- Gate-wait: poll 250ms, hard cap 180_000ms; `denied` khi requestId rời `pending()` mà không `allowed` (phủ Deny tay + fail-closed timeout 120s).
- Header token child dùng: `x-cowork-token` (khớp `extractClientToken` — `service/src/server/http-service.ts:202-205`).
- Tên 25 tool trong plugin PHẢI khớp từng ký tự `TOOL_NAMES` (`service/src/ms365/ms365-tool-router.ts:32-58`, đã gồm `planner_create_tasks`).
- TypeScript strict, không `any`, không cast che lỗi. Copy user-facing tiếng Việt; mô tả tool trong plugin (machine-facing) tiếng Anh ngắn.
- Test service: `cd service && node --import tsx --test tests/<file>.test.ts`. Typecheck: `npm run typecheck` từ repo root.
- Pin OpenCode v1.17.11 không đổi (`runtime/src/pin.ts`).

## File Structure

| File | Vai trò |
|---|---|
| `service/src/ms365/ms365-gate-wait.ts` (mới) | `awaitGateDecision(gate, requestId, wait)` — poll allowed/pending |
| `service/src/ms365/ms365-tools.ts` (sửa) | 4 write handler await decision; `ToolDeps.wait?` |
| `service/src/ms365/ms365-batch-tools.ts` (sửa) | batch await decision (manual check giữ nguyên trước submit) |
| `service/src/server/http-service.ts` (sửa) | `pathScopedTokens` option + guard mở rộng |
| `service/src/composition/live-launch.ts` (sửa) | mint `ms365ToolToken`, env child = scoped token, trả token cho http options |
| `service/src/runtime/ms365-plugin-file.ts` (mới) | `MS365_PLUGIN_SOURCE` + `writeMs365Plugin` + `seedMs365PluginDeps` |
| `service/src/runtime/opencode-config.ts` (sửa) | policy allow 25 tool khi MS365 enabled |
| `service/src/runtime/supervisor.ts` (sửa) | ghi plugin + seed sau mkdir configDir khi flag ON |
| `runtime/package.json` (sửa) | dep `@opencode-ai/plugin@1.17.11` |

---

### Task 1: Gate-wait cho MS365 write (sửa deny-loop)

**Files:**
- Create: `service/src/ms365/ms365-gate-wait.ts`
- Modify: `service/src/ms365/ms365-tools.ts` (handleUpload, handlePlannerWrite ×3, handleListsWrite ×3, handleTeamsWrite; `ToolDeps`)
- Modify: `service/src/ms365/ms365-batch-tools.ts` (handlePlannerCreateTasks)
- Test: `service/tests/ms365-gate-wait.test.ts` (mới) + cập nhật khuôn các test write hiện có

**Interfaces:**
- Consumes: `PermissionGate.isAllowed(requestId): boolean`, `.pending(): PermissionRequest[]`, `.resolve(...)` (core không đổi).
- Produces: `awaitGateDecision(gate: Pick<PermissionGate, "isAllowed" | "pending">, requestId: string, wait: (ms: number) => Promise<void>): Promise<"allowed" | "denied">`; `ToolDeps` thêm `wait?: (ms: number) => Promise<void>`.

- [ ] **Step 1: Viết test helper (fail trước)** — `service/tests/ms365-gate-wait.test.ts`:

```ts
/**
 * awaitGateDecision: resolves "allowed" khi gate ghi Allow, "denied" khi request rời pending
 * (Deny tay hoặc fail-closed timeout), hard-cap không treo vô hạn.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitGateDecision } from "../src/ms365/ms365-gate-wait.js";

function fakeGate(initial: { allowed?: boolean; pending?: boolean }) {
  const state = { allowed: initial.allowed ?? false, pending: initial.pending ?? true };
  return {
    state,
    isAllowed: () => state.allowed,
    pending: () => (state.pending ? [{ requestId: "r1" } as never] : []),
  };
}
const instantWait = () => Promise.resolve();

test("already allowed → allowed without waiting", async () => {
  const gate = fakeGate({ allowed: true, pending: false });
  assert.equal(await awaitGateDecision(gate, "r1", instantWait), "allowed");
});

test("allow arriving after 3 polls → allowed", async () => {
  const gate = fakeGate({});
  let polls = 0;
  const wait = () => {
    polls += 1;
    if (polls === 3) { gate.state.allowed = true; gate.state.pending = false; }
    return Promise.resolve();
  };
  assert.equal(await awaitGateDecision(gate, "r1", wait), "allowed");
});

test("request leaving pending without allow (deny/timeout) → denied", async () => {
  const gate = fakeGate({});
  const wait = () => { gate.state.pending = false; return Promise.resolve(); };
  assert.equal(await awaitGateDecision(gate, "r1", wait), "denied");
});

test("unknown requestId (not pending, not allowed) → denied immediately", async () => {
  const gate = fakeGate({ pending: false });
  assert.equal(await awaitGateDecision(gate, "r1", instantWait), "denied");
});

test("hard cap: stuck-pending gate → denied (no infinite hang)", async () => {
  const gate = fakeGate({}); // pending forever
  assert.equal(await awaitGateDecision(gate, "r1", instantWait), "denied");
});
```

- [ ] **Step 2: RED** — `cd service && node --import tsx --test tests/ms365-gate-wait.test.ts` → FAIL (module chưa có).

- [ ] **Step 3: Implement `ms365-gate-wait.ts`:**

```ts
/**
 * Chờ quyết định thật của user cho một PermissionRequest đã submit. Sửa deny-loop: trước đây
 * proceed chạy cùng tick với submit nên state luôn "pending" → write không bao giờ hoàn tất.
 * Vòng poll đọc gate qua 2 API sẵn có (KHÔNG sửa PermissionGate core): `isAllowed` → allowed;
 * requestId rời `pending()` mà không allowed → denied (phủ cả Deny tay lẫn fail-closed timeout
 * của gate — timer tự deny làm pending biến mất). Hard cap chống treo nếu gate kẹt bất thường.
 */
import type { PermissionGate } from "../permission/index.js";

const POLL_INTERVAL_MS = 250;
const HARD_CAP_MS = 180_000;

export async function awaitGateDecision(
  gate: Pick<PermissionGate, "isAllowed" | "pending">,
  requestId: string,
  wait: (ms: number) => Promise<void>,
): Promise<"allowed" | "denied"> {
  const maxPolls = Math.ceil(HARD_CAP_MS / POLL_INTERVAL_MS);
  for (let i = 0; i <= maxPolls; i += 1) {
    if (gate.isAllowed(requestId)) return "allowed";
    if (!gate.pending().some((r) => r.requestId === requestId)) return "denied";
    if (i < maxPolls) await wait(POLL_INTERVAL_MS);
  }
  return "denied";
}
```

- [ ] **Step 4: GREEN** — chạy lại test Step 1 → PASS (5/5). Lưu ý test hard-cap chạy 720 vòng instantWait — nhanh.

- [ ] **Step 5: Nối vào handlers.** Trong `ms365-tools.ts`:
- `ToolDeps` thêm:

```ts
  /** Seam chờ giữa các lần poll gate (test tiêm instant). Default: setTimeout thật. */
  wait?: (ms: number) => Promise<void>;
```

- Thêm import + default:

```ts
import { awaitGateDecision } from "./ms365-gate-wait.js";

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- Khuôn đổi (áp dụng NGUYÊN VẸN cho cả 8 write: upload, planner create/edit/delete, lists add/edit/delete, teams post — ví dụ upload):

```ts
  deps.gate.submit(
    createPermissionRequest({ requestId: call.requestId, sessionId: call.sessionId, action, requestedAt: deps.now() }),
  );
  const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
  if (decision === "denied") {
    return { ok: false, error: { kind: "denied", message: "Yêu cầu upload lên SharePoint chưa được cho phép.", recovery: "Chấp thuận yêu cầu quyền rồi chạy lại công cụ." } };
  }
  const outcome = deps.gate.proceed(call.requestId, () => deps.sharepoint.upload(input));
  if (!outcome.performed) {
    return deniedResult("Yêu cầu upload lên SharePoint chưa được cho phép.");
  }
  return { ok: true, data: await outcome.result };
```

(Giữ nguyên message denied từng handler như hiện tại; check `performed` sau proceed GIỮ NGUYÊN — double-safety nếu allow bị consume giữa chừng.)
- `ms365-batch-tools.ts`: `handlePlannerCreateTasks` — sau `gate.submit`, thêm `awaitGateDecision` y hệt (import từ `./ms365-gate-wait.js`; dùng `deps.wait ?? defaultWait` — export `defaultWait` từ `ms365-tools.ts` hoặc lặp 3 dòng local, chọn export). `manual_mode` check GIỮ NGUYÊN vị trí trước submit.

- [ ] **Step 6: Cập nhật test write hiện có.** Các test trong `ms365-planner-tool.test.ts`, `ms365-lists-tool.test.ts`, `ms365-teams-tool.test.ts`, `ms365-tool-router.test.ts` (upload), `ms365-batch-tools.test.ts`, `permission-ms365-level.test.ts` hiện seed Allow TRƯỚC khi gọi handler → vẫn pass (isAllowed true ngay vòng đầu). Test Deny hiện dựa vào proceed-fail-ngay → giờ sẽ đợi: đổi khuôn thành resolve async:

```ts
const resultPromise = handleToolCall(deps, call);
await new Promise((r) => setTimeout(r, 0));           // cho submit chạy
await gate.resolve({ requestId: call.requestId, decision: "deny" });
const result = await resultPromise;
```

Fake gate nào không phải gate thật (spy tự chế) → bổ sung `isAllowed`/`pending` cho fake trả đúng trạng thái spy. Thêm vào mỗi fake ToolDeps: `wait: () => Promise.resolve()`.

- [ ] **Step 7: Verify** — `cd service && node --import tsx --test tests/ms365-*.test.ts tests/permission-ms365-level.test.ts` PASS hết; `npm run typecheck` exit 0.

- [ ] **Step 8: Commit** — `git commit -m "fix(ms365): writes await the real gate decision — deny-loop gone, one call = one card = final result"`

---

### Task 2: Scoped token cho `/v1/ms365/tool-call`

**Files:**
- Modify: `service/src/server/http-service.ts` (option + guard)
- Modify: `service/src/composition/live-launch.ts` (mint + env + đăng ký scoped token)
- Test: `service/tests/ms365-scoped-token.test.ts` (mới) + cập nhật `service/tests/ms365-child-env.test.ts`

**Interfaces:**
- Consumes: `checkClientToken(expected, presented)` (`service/src/server/token.ts` — constant-time), `extractClientToken`.
- Produces: `HttpServiceOptions` (hoặc constructor tương đương — đọc file để lấy đúng tên) thêm `pathScopedTokens?: readonly PathScopedToken[]` với `interface PathScopedToken { readonly token: string; readonly paths: readonly string[] }`; live-launch expose `ms365ToolToken` trong plan/kết quả để compose truyền vào http options.

- [ ] **Step 1: Test (fail trước)** — `service/tests/ms365-scoped-token.test.ts`: dựng HttpService theo khuôn test http hiện có (tìm file test hiện có dựng HttpService — vd test của boundary/server — copy cách khởi tạo + 1 route giả `/v1/ms365/tool-call` + 1 route giả khác):
  - scoped token + đúng path → 200;
  - scoped token + path khác (vd `/v1/ms365/write-mode`) → 403;
  - main token → 200 cả hai path;
  - không token → 401 (không đổi).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement guard** trong `http-service.ts` — thay block 201-215:

```ts
      if (route.publicUnauthenticated !== true) {
        const presented = extractClientToken({
          authorization: req.headers.authorization,
          xCoworkToken: singleHeader(req.headers["x-cowork-token"]),
        });
        const check = checkClientToken(this.clientToken, presented);
        if (check === "missing") {
          writeEnvelope(res, 401, errorEnvelope("unauthorized", "Client token required."));
          return;
        }
        if (check === "invalid" && !this.scopedTokenAllows(presented, url.pathname)) {
          writeEnvelope(res, 403, errorEnvelope("forbidden", "Invalid client token."));
          return;
        }
      }
```

và method (dùng `checkClientToken` cho từng scoped token — giữ constant-time, KHÔNG so sánh chuỗi trần):

```ts
  /** Token scoped chỉ hợp lệ cho đúng các path đăng ký (vd child chỉ được gọi MS365 tool-call). */
  private scopedTokenAllows(presented: string | undefined, pathname: string): boolean {
    if (presented === undefined) return false;
    for (const scoped of this.pathScopedTokens) {
      if (!scoped.paths.includes(pathname)) continue;
      if (checkClientToken(scoped.token, presented) === "ok") return true;
    }
    return false;
  }
```

(field `private readonly pathScopedTokens: readonly PathScopedToken[]` default `[]` từ options; đọc constructor thực tế và đặt đúng khuôn.)
- [ ] **Step 4: live-launch** — chỗ mint clientToken hiện tại (đọc file, vùng tạo servicePlan): mint thêm `ms365ToolToken` bằng CÙNG generator ngẫu nhiên của clientToken, CHỈ khi `isMs365Enabled`; `CGHC_MS365_TOKEN: ms365ToolToken` (thay clientToken ở dòng ~189); plan/return mang `ms365ToolToken` để composition đăng ký `pathScopedTokens: [{ token: ms365ToolToken, paths: [MS365_TOOL_CALL_PATH] }]` vào HttpService (tìm nơi HttpService được dựng với clientToken — nối đúng chỗ đó; import `MS365_TOOL_CALL_PATH` từ `../ms365/index.js` hoặc hằng router). Flag OFF → không mint, `pathScopedTokens` không có entry.
- [ ] **Step 5: Cập nhật `ms365-child-env.test.ts`** — assert `CGHC_MS365_TOKEN` KHÁC clientToken và là chuỗi không rỗng khi flag ON.
- [ ] **Step 6: GREEN + typecheck** — 2 file test trên + `tests/ms365-*.test.ts` PASS; typecheck 0.
- [ ] **Step 7: Commit** — `git commit -m "feat(security): path-scoped token for MS365 tool-call — child no longer holds the full client token"`

---

### Task 3: Plugin file + seed deps + policy allow

**Files:**
- Create: `service/src/runtime/ms365-plugin-file.ts`
- Modify: `service/src/runtime/opencode-config.ts` (policy khi MS365 enabled)
- Modify: `service/src/runtime/supervisor.ts` (ghi plugin + seed sau mkdir)
- Modify: `runtime/package.json` (dep `@opencode-ai/plugin@1.17.11`) + chạy install
- Test: `service/tests/ms365-plugin-file.test.ts` (mới) + cập nhật test opencode-config nếu có

**Interfaces:**
- Produces: `MS365_PLUGIN_SOURCE: string`; `writeMs365Plugin(configDir: string): void` (ghi `<configDir>/plugin/ms365.ts`, refuse nếu source chứa secret bytes — nhận `forbidden?: string` như `writeOpencodeConfig`); `seedMs365PluginDeps(configDir: string, nodeModulesRoot: string, log: (m: string) => void): void` (copy `@opencode-ai/plugin` + transitive deps từ package.json của nó — tối thiểu `zod` nếu khai báo — vào `<configDir>/node_modules/`; thiếu nguồn → log warning, không throw); `MS365_TOOL_NAMES_FOR_POLICY: readonly string[]` (import từ router hằng TOOL_NAMES — export nó nếu chưa export).
- Consumes: `spec.baseEnv["CGHC_MS365_ENABLED"]`, `spec.binPath` (suy `nodeModulesRoot = resolve(dirname(binPath), "..", "..")`).

- [ ] **Step 1: Thêm dep** — `runtime/package.json` dependencies: `"@opencode-ai/plugin": "1.17.11"`; chạy `npm install` ở repo root; xác nhận `node_modules/@opencode-ai/plugin/package.json` tồn tại và ghi lại deps của nó (để seed transitive).
- [ ] **Step 2: Test (fail trước)** — `service/tests/ms365-plugin-file.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MS365_PLUGIN_SOURCE, writeMs365Plugin } from "../src/runtime/ms365-plugin-file.js";
import { TOOL_NAMES } from "../src/ms365/ms365-tool-router.js";

test("plugin source declares all 25 tool names exactly", () => {
  for (const name of TOOL_NAMES) {
    assert.ok(MS365_PLUGIN_SOURCE.includes(`${name}:`), `missing tool ${name}`);
  }
});

test("plugin source reads endpoint+token ONLY from env — no literal secrets/URLs", () => {
  assert.ok(MS365_PLUGIN_SOURCE.includes('process.env["CGHC_MS365_TOOL_ENDPOINT"]'));
  assert.ok(MS365_PLUGIN_SOURCE.includes('process.env["CGHC_MS365_TOKEN"]'));
  assert.ok(!MS365_PLUGIN_SOURCE.includes("127.0.0.1"));
  assert.ok(!/Bearer\s+[A-Za-z0-9]/.test(MS365_PLUGIN_SOURCE));
});

test("writeMs365Plugin writes <configDir>/plugin/ms365.ts and refuses secret bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-plugin-"));
  writeMs365Plugin(dir);
  const written = await readFile(join(dir, "plugin", "ms365.ts"), "utf8");
  assert.equal(written, MS365_PLUGIN_SOURCE);
  assert.throws(() => writeMs365Plugin(dir, "sk-THISISASECRET"), /secret/i);
});
```

(test thứ 3 nhánh refuse: `writeMs365Plugin(configDir, forbidden?)` throw khi `forbidden !== undefined && source.includes(forbidden)` — mirror guard của `writeOpencodeConfig`; vì source tĩnh không chứa secret nên chỉ throw khi ai đó phá vỡ bất biến — pass forbidden là giá trị chắc chắn không có trong source để assert KHÔNG throw, và một test bịa source? Không — giữ đơn giản: assert KHÔNG throw với forbidden bất kỳ, vì source không được phép chứa nó. Đổi assert.throws thành assert.doesNotThrow và thêm comment bất biến.)
- Policy test: `buildOpencodeConfig`/`writeOpencodeConfig` với ms365Enabled=true → `permission` chứa `"sharepoint_search": "allow"` … đủ 25 entry; false → không entry nào (đọc test opencode-config hiện có và mở rộng đúng khuôn).
- [ ] **Step 3: RED.**
- [ ] **Step 4: Implement `ms365-plugin-file.ts`.** Source template (hằng string — đây là code TS chạy trong Bun của OpenCode; các arg Zod khớp validator router; mô tả tiếng Anh ngắn có đủ ngữ nghĩa etag/batch/manual_mode):

```ts
export const MS365_PLUGIN_SOURCE = `// AUTO-GENERATED by Cowork GHC — do not edit. Regenerated on every launch.
// Bridges OpenCode tool calls to the Cowork service MS365 boundary (loopback, scoped token).
import { tool } from "@opencode-ai/plugin";

const ENDPOINT = process.env["CGHC_MS365_TOOL_ENDPOINT"];
const TOKEN = process.env["CGHC_MS365_TOKEN"];

async function call(name, args, ctx) {
  if (!ENDPOINT || !TOKEN) {
    return JSON.stringify({ ok: false, error: { kind: "not_configured", message: "MS365 tool bridge is not configured in this session." } });
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cowork-token": TOKEN },
      body: JSON.stringify({ name, args, sessionId: ctx.sessionID, requestId: crypto.randomUUID() }),
    });
    const body = await res.json();
    // Boundary envelope: { ok: true, data: ToolResult } | { ok: false, error: {...} }
    if (body && body.ok === true) return JSON.stringify(body.data);
    return JSON.stringify({ ok: false, error: { kind: "boundary_error", message: "MS365 boundary returned HTTP " + res.status + "." } });
  } catch {
    return JSON.stringify({ ok: false, error: { kind: "network_error", message: "Could not reach the MS365 tool bridge." } });
  }
}

const S = tool.schema;

export const Ms365 = async () => ({
  tool: {
    sharepoint_search: tool({ description: "Search SharePoint files by name/content. Site allowlist enforced server-side.", args: { query: S.string() }, async execute(args, ctx) { return call("sharepoint_search", args, ctx); } }),
    sharepoint_list_site_files: tool({ description: "List files in a SharePoint site drive root.", args: { siteId: S.string() }, async execute(args, ctx) { return call("sharepoint_list_site_files", args, ctx); } }),
    sharepoint_get_file_summary: tool({ description: "Read bounded text content of a SharePoint file for summarizing.", args: { driveItemId: S.string() }, async execute(args, ctx) { return call("sharepoint_get_file_summary", args, ctx); } }),
    sharepoint_upload_file: tool({ description: "Upload a workspace-local file to a SharePoint site. Requires user permission approval.", args: { siteId: S.string(), relativeLocalPath: S.string(), targetName: S.string() }, async execute(args, ctx) { return call("sharepoint_upload_file", args, ctx); } }),
    ms365_list_joined_sites: tool({ description: "List SharePoint sites the connected account follows, with enabled/disabled search scope.", args: {}, async execute(args, ctx) { return call("ms365_list_joined_sites", args, ctx); } }),
    outlook_search_messages: tool({ description: "Search Outlook mail (KQL query). Read-only.", args: { query: S.string() }, async execute(args, ctx) { return call("outlook_search_messages", args, ctx); } }),
    outlook_get_message: tool({ description: "Get one Outlook message by id (bounded body).", args: { id: S.string() }, async execute(args, ctx) { return call("outlook_get_message", args, ctx); } }),
    outlook_summarize_message: tool({ description: "Get bounded plain text of one Outlook message for summarizing.", args: { id: S.string() }, async execute(args, ctx) { return call("outlook_summarize_message", args, ctx); } }),
    planner_list_plans: tool({ description: "List the user's Planner plans (find a plan by name before acting; ask the user if ambiguous).", args: {}, async execute(args, ctx) { return call("planner_list_plans", args, ctx); } }),
    planner_list_tasks: tool({ description: "List tasks of a Planner plan (includes dueDateTime, percentComplete, etag).", args: { planId: S.string() }, async execute(args, ctx) { return call("planner_list_tasks", args, ctx); } }),
    planner_create_task: tool({ description: "Create ONE Planner task. Requires user permission approval per call.", args: { planId: S.string(), title: S.string(), dueDateTime: S.string().optional(), assigneeUserIds: S.array(S.string()).optional() }, async execute(args, ctx) { return call("planner_create_task", args, ctx); } }),
    planner_edit_task: tool({ description: "Edit a Planner task. MUST pass the exact etag from a fresh planner_list_tasks read.", args: { taskId: S.string(), etag: S.string(), title: S.string().optional(), dueDateTime: S.string().optional(), percentComplete: S.number().optional() }, async execute(args, ctx) { return call("planner_edit_task", args, ctx); } }),
    planner_delete_task: tool({ description: "Delete a Planner task. MUST pass the exact etag from a fresh read.", args: { taskId: S.string(), etag: S.string() }, async execute(args, ctx) { return call("planner_delete_task", args, ctx); } }),
    planner_create_tasks: tool({ description: "Create up to 20 Planner tasks in ONE user approval. If it returns kind=manual_mode, fall back to planner_create_task per item and tell the user why.", args: { planId: S.string(), tasks: S.array(S.object({ title: S.string(), dueDateTime: S.string().optional(), assigneeUserIds: S.array(S.string()).optional() })) }, async execute(args, ctx) { return call("planner_create_tasks", args, ctx); } }),
    lists_get_lists: tool({ description: "List SharePoint Lists of a site (find a list by name; ask the user if ambiguous).", args: { siteId: S.string() }, async execute(args, ctx) { return call("lists_get_lists", args, ctx); } }),
    lists_get_items: tool({ description: "Read items of a SharePoint List. Optional OData $filter (value only).", args: { siteId: S.string(), listId: S.string(), filter: S.string().optional() }, async execute(args, ctx) { return call("lists_get_items", args, ctx); } }),
    lists_add_item: tool({ description: "Add one item to a SharePoint List. Requires user permission approval.", args: { siteId: S.string(), listId: S.string(), fields: S.record(S.string(), S.unknown()) }, async execute(args, ctx) { return call("lists_add_item", args, ctx); } }),
    lists_edit_item: tool({ description: "Edit fields of a SharePoint List item. Requires user permission approval.", args: { siteId: S.string(), listId: S.string(), itemId: S.string(), fields: S.record(S.string(), S.unknown()) }, async execute(args, ctx) { return call("lists_edit_item", args, ctx); } }),
    lists_delete_item: tool({ description: "Delete a SharePoint List item. Requires user permission approval.", args: { siteId: S.string(), listId: S.string(), itemId: S.string() }, async execute(args, ctx) { return call("lists_delete_item", args, ctx); } }),
    teams_list_chats: tool({ description: "List the user's Teams chats (topic + members).", args: {}, async execute(args, ctx) { return call("teams_list_chats", args, ctx); } }),
    teams_list_teams: tool({ description: "List joined Teams.", args: {}, async execute(args, ctx) { return call("teams_list_teams", args, ctx); } }),
    teams_list_channels: tool({ description: "List channels of a team.", args: { teamId: S.string() }, async execute(args, ctx) { return call("teams_list_channels", args, ctx); } }),
    teams_list_members: tool({ description: "List members of a chat OR a team (exactly one of chatId/teamId) — resolves userId for mentions/assignments.", args: { chatId: S.string().optional(), teamId: S.string().optional() }, async execute(args, ctx) { return call("teams_list_members", args, ctx); } }),
    teams_get_messages: tool({ description: "Get recent messages of a chat (chatId) or channel (teamId+channelId). No server-side search — filter client-side.", args: { chatId: S.string().optional(), teamId: S.string().optional(), channelId: S.string().optional() }, async execute(args, ctx) { return call("teams_get_messages", args, ctx); } }),
    teams_post_message: tool({ description: "Post a Teams message to a chat (chatId) or channel (teamId+channelId). Mentions: use @{i} placeholders in content with mentions[i]={userId,displayName}. Requires user permission approval.", args: { chatId: S.string().optional(), teamId: S.string().optional(), channelId: S.string().optional(), content: S.string(), mentions: S.array(S.object({ userId: S.string(), displayName: S.string() })).optional() }, async execute(args, ctx) { return call("teams_post_message", args, ctx); } }),
  },
});
`;
```

LƯU Ý implementer: (a) nếu `tool.schema` của `@opencode-ai/plugin@1.17.11` không phải Zod re-export tên `schema` — đọc `node_modules/@opencode-ai/plugin` (src/d.ts) và chỉnh template cho khớp API thật (vd `import { tool } from "@opencode-ai/plugin"; const S = tool.schema` là khuôn tài liệu chính thức; nếu package export `z` riêng thì dùng nó); (b) `S.record(S.string(), S.unknown())` — chỉnh theo signature record của zod version trong package (zod v3: `S.record(S.unknown())`).

`writeMs365Plugin` + `seedMs365PluginDeps`:

```ts
import { cpSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeMs365Plugin(configDir: string, forbidden?: string): void {
  if (forbidden !== undefined && forbidden.length > 0 && MS365_PLUGIN_SOURCE.includes(forbidden)) {
    throw new Error("ms365-plugin-file: refusing to write plugin containing a secret value");
  }
  const target = join(configDir, "plugin", "ms365.ts");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, MS365_PLUGIN_SOURCE, "utf8");
}

/** Copy @opencode-ai/plugin (+ deps khai báo trong package.json của nó) vào configDir/node_modules
 * để import resolve offline — không phụ thuộc background npm install của OpenCode. Nguồn thiếu →
 * warning (đã redact phía caller) và bỏ qua: OpenCode sẽ tự thử install (cần mạng). */
export function seedMs365PluginDeps(configDir: string, nodeModulesRoot: string, log: (m: string) => void): void {
  const targetRoot = join(configDir, "node_modules");
  const copied = new Set<string>();
  const copyPkg = (name: string): void => {
    if (copied.has(name)) return;
    copied.add(name);
    const src = join(nodeModulesRoot, ...name.split("/"));
    if (!existsSync(src)) { log(`ms365_plugin_seed_missing pkg=${name}`); return; }
    cpSync(src, join(targetRoot, ...name.split("/")), { recursive: true });
    try {
      const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      for (const dep of Object.keys(pkg.dependencies ?? {})) copyPkg(dep);
    } catch { log(`ms365_plugin_seed_pkgjson_unreadable pkg=${name}`); }
  };
  copyPkg("@opencode-ai/plugin");
}
```

- [ ] **Step 5: Policy trong `opencode-config.ts`** — export `TOOL_NAMES` từ router nếu chưa (nó đã là hằng module — thêm `export`), rồi:

```ts
import { TOOL_NAMES as MS365_TOOL_NAMES } from "../ms365/ms365-tool-router.js";

function permissionPolicy(ms365Enabled: boolean): Record<string, string> {
  if (!ms365Enabled) return LIVE_SESSION_PERMISSION_POLICY;
  const allowEntries = Object.fromEntries(MS365_TOOL_NAMES.map((n) => [n, "allow"]));
  return { ...LIVE_SESSION_PERMISSION_POLICY, ...allowEntries };
}
```

`buildOpencodeConfig`/`writeOpencodeConfig` nhận thêm tham số `ms365Enabled: boolean` (default false) và dùng `permissionPolicy(ms365Enabled)` ở CẢ HAI chỗ (top-level `permission` + `agent.build.permission`). Wildcard `"*": "ask"` giữ nguyên.
- [ ] **Step 6: Supervisor** — trong `start()` sau `mkdirSync(launch.configDir, ...)` (supervisor.ts:122) và cạnh `writeOpencodeConfig(...)` (:129):

```ts
      const ms365Enabled = spec.baseEnv?.["CGHC_MS365_ENABLED"] !== undefined;
      writeOpencodeConfig(spec.configDir, spec.providerConfig, forbidden, ms365Enabled);
      if (ms365Enabled) {
        writeMs365Plugin(spec.configDir, forbidden);
        seedMs365PluginDeps(spec.configDir, resolve(dirname(spec.binPath), "..", ".."), (m) => this.log(m));
      }
```

(đường dẫn nodeModulesRoot: `<appRoot>/node_modules/opencode-ai/bin/opencode.exe` → `../..` từ dirname = `<appRoot>/node_modules`. Nếu spec không mang binPath ở supervisor — đọc code, lấy từ `launch.command` hoặc thêm field vào spec theo cách ít xâm lấn nhất.)
- [ ] **Step 7: GREEN + typecheck** — test mới + test opencode-config/supervisor hiện có PASS; `npm run typecheck` 0. Chạy thêm `cd service && node --import tsx --test tests/ms365-flag-off.test.ts` xác nhận flag OFF không đổi.
- [ ] **Step 8: Commit** — `git commit -m "feat(ms365): OpenCode plugin bridge — 25 tools registered per-launch, deps pre-seeded offline, policy allow (gate stays the authority)"`

---

### Task 5: Session gating — chỉ tab MS365 dùng tool MS365 (PO decision 2026-07-14)

**Files:**
- Create: `service/src/ms365/ms365-session-scope.ts`
- Modify: `service/src/ms365/ms365-tools.ts` (check đầu `handleToolCall` + `ToolDeps.sessionAllowed`)
- Modify: `service/src/ms365/ms365-tool-router.ts` (route `POST /v1/ms365/session-scope` + deps)
- Modify: `service/src/composition/compose-service.ts` (wire trong IIFE)
- Modify: `app/ui/src/app-shell.ts` (chat chính: ngừng truyền `ms365Connected=true` vào planDispatchPrompt; pill: `refreshMs365WriteModePill` luôn `setVisible(false)` — kèm comment trỏ P5.6 di dời sang tab Microsoft)
- Test: `service/tests/ms365-session-scope.test.ts`

**Interfaces:**
- Produces: `Ms365SessionScope { allow(sessionId: string): void; revoke(sessionId: string): void; isAllowed(sessionId: string): boolean }` + `createMs365SessionScope()` (in-memory Set, không persist); `ToolDeps.sessionAllowed: (sessionId: string) => boolean`; `MS365_SESSION_SCOPE_PATH = "/v1/ms365/session-scope"` (POST body `{sessionId: string, enabled: boolean}` → `{allowed: boolean}`); `Ms365RouterDeps.sessionScope: Ms365SessionScope`.

- [ ] **Step 1: Test (fail trước)** — store allow/revoke/isAllowed (mặc định false — fail-closed); `handleToolCall` với sessionId chưa allow → `{kind:"session_not_allowed"}` TRƯỚC cả check connectionState (0 call xuống service nào); allow rồi → hành vi cũ; route POST parse/validate (thiếu sessionId → 400) + đăng ký/revoke thật; **token scoped của tool-call KHÔNG pass được route session-scope** (assert qua http nếu tiện — hoặc ghi chú đã được Task 2 bảo đảm theo path).
- [ ] **Step 2: RED → implement → GREEN.** Check đặt đầu `handleToolCall`: `if (!deps.sessionAllowed(call.sessionId)) return { ok:false, error:{ kind:"session_not_allowed", message:"Tool Microsoft 365 chỉ dùng được trong tab Microsoft 365.", recovery:"Mở tab Microsoft 365 và chat từ đó." } };` — mọi fake ToolDeps hiện có thêm `sessionAllowed: () => true` để giữ hành vi test cũ.
- [ ] **Step 3: UI detach interim** — app-shell: bỏ đối số `ms365Connected` (truyền `false`/bỏ param) ở 2 call site dispatch; `refreshMs365WriteModePill` return sớm `setVisible(false)` kèm `// P5.6: pill chuyển sang composer tab Microsoft — chat chính không dùng tool MS365 (session gating)`. Test dispatch-plan cũ (block presence khi connected=true) GIỮ NGUYÊN — hàm vẫn hỗ trợ; chỉ call site ngừng bật. Cập nhật/simplify test pill nếu assert hiển thị theo connected.
- [ ] **Step 4: Verify + commit** — `cd service && node --import tsx --test tests/ms365-*.test.ts` + UI tests liên quan + typecheck. Commit: `git commit -m "feat(ms365): session gating — only MS365-tab sessions may call MS365 tools (fail-closed); main chat detached"`

---

### Task 4: Verify tiêu thụ end-to-end + docs

**Files:**
- Create: `tools/verify/ms365-plugin-consumption.md` (runbook) — HOẶC script nếu khả thi
- Modify: `docs/integration/ms365-graph-api-map.md`, `docs/product/current-status.md`

**Không phải task viết code lớn — là task VERIFY + ghi nhận trung thực.**

- [ ] **Step 1: Verify offline registration** (không cần model): launch supervisor thật với flag ON (dev env: `CGHC_MS365_ENABLED=1` + provider bất kỳ đã cấu hình) → sau ready, kiểm tra: (a) `<configDir>/plugin/ms365.ts` + `<configDir>/node_modules/@opencode-ai/plugin` tồn tại; (b) log child không có lỗi import plugin; (c) nếu OpenCode v1.17.11 có endpoint liệt kê tool (thăm dò `GET /doc`, `/config`, hoặc experimental app info qua opencode-client) → xác nhận 25 tool xuất hiện; không có endpoint thì ghi nhận "không introspect được, chuyển bước 2".
- [ ] **Step 2: Verify roundtrip bằng phiên thật** — app dev/packaged, flag ON, MS365 CHƯA connect, prompt ở CHAT CHÍNH: "Hãy gọi tool ms365_list_joined_sites và cho tôi biết kết quả nguyên văn." Kỳ vọng sau Task 5: `{"ok":false,"error":{"kind":"session_not_allowed",...}}` — chứng minh chain plugin → scoped token → route → handler + gating đúng. Sau đó đăng ký session đó thủ công (`POST /v1/ms365/session-scope` với main token) → lặp lại → kỳ vọng `not_connected`. Ghi PASS/FAIL + evidence (đã redact).
- [ ] **Step 3: Docs** — api-map: mục 10 cập nhật trạng thái item "OpenCode child consume tool" theo kết quả thật; current-status: block P5.5 (đã làm / bằng chứng / hạn chế — trong đó ghi rõ: chưa test connected-live với tenant, chờ token user; gate-wait làm tool call block tối đa 120s+ trong khi card chờ — hành vi mới cần user biết).
- [ ] **Step 4: Commit** — `git commit -m "docs(ms365): P5.5 consumption verify results + status"`

---

## Self-Review (đã chạy)

- **Spec coverage:** Mảnh 1→Task 1; Mảnh 2→Task 2; Mảnh 3→Task 3; Mảnh 4→Task 4. Acceptance 1→T1(+T4.2), 2→T2, 3→T3 (flag-off test), 4→T3, 5→T4, 6→toàn bộ.
- **Type consistency:** `awaitGateDecision(gate, requestId, wait)` dùng ở T1 cả ms365-tools lẫn batch; `PathScopedToken {token, paths}` T2; `writeMs365Plugin(configDir, forbidden?)` + `seedMs365PluginDeps(configDir, nodeModulesRoot, log)` T3; `TOOL_NAMES` export từ router dùng ở cả plugin test lẫn policy.
- **Điểm mở có chủ đích (implementer đọc code thật để chốt):** tên option thật của HttpService constructor; nơi live-launch mint clientToken; API surface thật của `@opencode-ai/plugin@1.17.11` (chỉnh template `tool.schema`/record cho khớp — có test 25-tên + no-secret giữ bất biến); supervisor có sẵn binPath hay lấy qua launch.command.
