# MS365 Planner CRUD (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI thao tác Planner thay user: list plans/tasks (read, model tự tóm tắt task trễ) và create/edit/delete task (write qua PermissionGate, ETag `If-Match`).

**Architecture:** Mở rộng `HttpGraphClient` (PATCH/DELETE + `If-Match` + `noContent` cho 204) — additive, không đổi hành vi cũ. Thêm `PlannerService` cạnh Outlook/SharePoint, cùng `Ms365Connector.graph()`. 2 read tool chạy thẳng; 3 write tool đúng khuôn `sharepoint_upload_file`: submit PermissionGate → chỉ mutate khi Allow.

**Tech Stack:** TypeScript strict ESM (`.js` suffix), `node:test`, Graph v1.0 Planner, existing loopback router.

## Global Constraints

- TypeScript strict; no `any`; no casts to hide errors. ESM `.js` import suffix.
- Chỉ qua `Ms365Connector.graph()` — không chạm token/keyring/HTTP trực tiếp.
- **Mọi write (create/edit/delete) qua PermissionGate** — Allow mới chạy, Deny/không quyết định → `{ ok:false, kind:"denied" }`. Đúng khuôn `handleUpload` trong `ms365-tools.ts`.
- Model text (title, dueDateTime) chỉ vào JSON **body**; id/etag do Graph cấp, đi vào path (`encodeURIComponent`) / header `If-Match`. Model không chèn được path tùy ý.
- Bounded: plans/tasks cap mặc định 50.
- Scope: thêm `"Tasks.ReadWrite"` vào `MS365_SCOPES` (KHÔNG thêm `Group.Read.All`).
- Flag `CGHC_MS365_ENABLED` OFF mặc định; construction trong nhánh flag của `compose-service.ts`.
- GraphClient mở rộng phải **không đổi hành vi GET/POST/PUT hiện có** — suite `ms365-graph-client.test.ts` cũ phải pass nguyên vẹn.
- Test command (từ `service/`): `node --import tsx --test tests/<file>.test.ts`.

## File Structure

- **Modify `service/src/ms365/graph-client.ts`** — method union + `ifMatch` + `noContent`.
- **Create `service/src/ms365/planner-service.ts`** — `PlannerService` (5 method).
- **Modify `service/src/ms365/ms365-tools.ts`** — 5 tool names, `planner` dep, 2 read case + 3 gated write handler.
- **Modify `service/src/ms365/ms365-tool-router.ts`** — 5 names vào `TOOL_NAMES`.
- **Modify `service/src/ms365/index.ts`** — export planner.
- **Modify `service/src/composition/compose-service.ts`** — construct + wire + scope.
- **Tests** — extend `ms365-graph-client.test.ts`; create `ms365-planner-service.test.ts`, `ms365-planner-tool.test.ts`.

Task order: graph-client (nền) → PlannerService → tool dispatch → router+index+composition.

---

### Task 1: GraphClient — PATCH/DELETE + If-Match + noContent

**Files:**
- Modify: `service/src/ms365/graph-client.ts`
- Test: extend `service/tests/ms365-graph-client.test.ts`

**Interfaces:**
- Consumes: existing `HttpGraphClient`/`GraphClientRequest`.
- Produces: `GraphClientRequest.method` union thêm `"PATCH" | "DELETE"`; field mới `ifMatch?: string` → header `If-Match`; method mới trên `HttpGraphClient`/`GraphClient`: `noContent(req: GraphClientRequest): Promise<void>` (gửi request, chấp nhận 2xx không body).

- [ ] **Step 1: Write the failing tests** — đọc `service/tests/ms365-graph-client.test.ts` trước và TÁI DÙNG đúng fake ssrf/fetch helpers của file đó (không tạo kiểu mock mới). Thêm 3 test:

```ts
test("PATCH sends If-Match header from ifMatch", async () => {
  // dùng helper hiện có của file: fake fetch recorder + ssrf cho phép
  const { client, calls } = makeClientWithRecorder(/* 204 response, empty body */);
  await client.noContent({ method: "PATCH", path: "/planner/tasks/t1", ifMatch: 'W/"etag1"', body: { title: "x" } });
  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal((calls[0].init?.headers as Record<string, string>)["if-match"], 'W/"etag1"');
});

test("DELETE via noContent accepts a 204 empty body", async () => {
  const { client } = makeClientWithRecorder(/* status 204, no body */);
  await client.noContent({ method: "DELETE", path: "/planner/tasks/t1", ifMatch: 'W/"e"' }); // không throw
});

test("existing json() GET behaviour unchanged (no if-match header when ifMatch absent)", async () => {
  const { client, calls } = makeClientWithRecorder(/* 200 {} */);
  await client.json({ method: "GET", path: "/me" });
  assert.equal((calls[0].init?.headers as Record<string, string>)["if-match"], undefined);
});
```

> `makeClientWithRecorder` là TÊN GỢI Ý cho helper — nếu file test hiện có đã có helper tương đương (fake `fetchFn` ghi lại `(url, init)` + fake ssrf), dùng đúng helper đó và điều chỉnh 3 test này theo. Giữ nguyên assertions.

- [ ] **Step 2: Run to verify fail** — `cd service && node --import tsx --test tests/ms365-graph-client.test.ts` → FAIL (`noContent` not a function / PATCH not assignable).

- [ ] **Step 3: Implement** — trong `graph-client.ts`:

```ts
// 1. Union:
method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
// 2. Field mới trên GraphClientRequest:
/** Optional ETag for optimistic concurrency (Planner PATCH/DELETE). Sent as If-Match. */
ifMatch?: string;
// 3. Interface HttpGraphClient thêm:
/** Send request expecting a 2xx with no meaningful body (e.g. 204). */
noContent(req: GraphClientRequest): Promise<void>;
// 4. Trong send(), sau khi dựng headers authorization:
if (req.ifMatch !== undefined) {
  (init.headers as Record<string, string>)["if-match"] = req.ifMatch;
}
// 5. Trong object trả về:
async noContent(req: GraphClientRequest): Promise<void> {
  await send(req); // send() đã throw mapGraphStatus trên non-2xx; body bị bỏ qua
},
```

- [ ] **Step 4: Run to verify pass** — cùng lệnh → PASS (3 test mới + toàn bộ test cũ của file).

- [ ] **Step 5: Commit** — `git add service/src/ms365/graph-client.ts service/tests/ms365-graph-client.test.ts && git commit -m "feat(ms365): graph-client PATCH/DELETE + If-Match + noContent (additive)"`

---

### Task 2: PlannerService

**Files:**
- Create: `service/src/ms365/planner-service.ts`
- Test: `service/tests/ms365-planner-service.test.ts`

**Interfaces:**
- Consumes: `Ms365Connector` (`.graph()` → `json`/`noContent` từ Task 1).
- Produces:

```ts
export interface PlannerPlan { id: string; title: string }
export interface PlannerTask {
  id: string; title: string; planId: string;
  percentComplete: number; dueDateTime: string; etag: string;
}
export interface PlannerService {
  listPlans(): Promise<PlannerPlan[]>;
  listTasks(planId: string): Promise<PlannerTask[]>;
  createTask(input: { planId: string; title: string; dueDateTime?: string; assigneeUserIds?: string[] }): Promise<PlannerTask>;
  editTask(input: { taskId: string; etag: string; title?: string; dueDateTime?: string; percentComplete?: number }): Promise<void>;
  deleteTask(input: { taskId: string; etag: string }): Promise<void>;
}
export function createPlannerService(deps: { connector: Ms365Connector; maxResults?: number }): PlannerService; // default 50
```

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-planner-service.test.ts — tái dùng connectorReturning helper
// (copy đúng khuôn từ ms365-outlook-service.test.ts, thêm noContent vào fake GraphClient:
//   noContent: async (r) => { recorder.push(r); responder(r); } )
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlannerService } from "../src/ms365/planner-service.js";
// ... connectorReturning như outlook test, graph fake có json/bytes/noContent

test("listPlans maps /me/planner/plans and caps", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [
    { id: "p1", title: "Plan ABC" }, { id: 2, title: "bad" }, { id: "p3", title: "Plan X" },
  ]}));
  const svc = createPlannerService({ connector: conn, maxResults: 1 });
  const plans = await svc.listPlans();
  assert.deepEqual(plans, [{ id: "p1", title: "Plan ABC" }]);
  assert.match(seen[0].path, /\/me\/planner\/plans/);
});

test("listTasks maps tasks incl etag from @odata.etag, defaults missing fields", async () => {
  const conn = connectorReturning([], () => ({ value: [
    { id: "t1", title: "T1", planId: "p1", percentComplete: 50, dueDateTime: "2026-07-13T00:00:00Z", "@odata.etag": 'W/"e1"' },
    { id: "t2", title: "T2", planId: "p1" }, // thiếu due/percent/etag → defaults
    { title: "no id" }, // dropped
  ]}));
  const svc = createPlannerService({ connector: conn });
  const tasks = await svc.listTasks("p1");
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0], { id: "t1", title: "T1", planId: "p1", percentComplete: 50, dueDateTime: "2026-07-13T00:00:00Z", etag: 'W/"e1"' });
  assert.deepEqual(tasks[1], { id: "t2", title: "T2", planId: "p1", percentComplete: 0, dueDateTime: "", etag: "" });
});

test("createTask POSTs body with assignments when assigneeUserIds given", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ id: "t9", title: "New", planId: "p1", percentComplete: 0, "@odata.etag": 'W/"e9"' }));
  const svc = createPlannerService({ connector: conn });
  const t = await svc.createTask({ planId: "p1", title: "New", dueDateTime: "2026-07-13T00:00:00Z", assigneeUserIds: ["u1"] });
  assert.equal(t.id, "t9");
  const body = seen[0].body as Record<string, unknown>;
  assert.equal(body.planId, "p1");
  assert.equal(body.title, "New");
  assert.equal(body.dueDateTime, "2026-07-13T00:00:00Z");
  assert.deepEqual(body.assignments, { u1: { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" } });
});

test("editTask PATCHes with If-Match and only provided fields", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => undefined);
  const svc = createPlannerService({ connector: conn });
  await svc.editTask({ taskId: "t1", etag: 'W/"e1"', percentComplete: 100 });
  assert.equal(seen[0].method, "PATCH");
  assert.equal(seen[0].ifMatch, 'W/"e1"');
  assert.match(seen[0].path, /\/planner\/tasks\/t1/);
  assert.deepEqual(seen[0].body, { percentComplete: 100 }); // KHÔNG có title/dueDateTime undefined
});

test("deleteTask DELETEs with If-Match", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => undefined);
  const svc = createPlannerService({ connector: conn });
  await svc.deleteTask({ taskId: "t1", etag: 'W/"e1"' });
  assert.equal(seen[0].method, "DELETE");
  assert.equal(seen[0].ifMatch, 'W/"e1"');
});
```

- [ ] **Step 2: Run to verify fail** — module not found.

- [ ] **Step 3: Implement**

```ts
// service/src/ms365/planner-service.ts
/**
 * PlannerService: Planner CRUD over Microsoft Graph. Reads via /me/planner/plans (no group
 * enumeration → no Group.Read.All). Writes require the task's ETag (If-Match). Reuses
 * Ms365Connector.graph(); model text (title/due) only enters the JSON body, never the path.
 */
import type { Ms365Connector } from "./ms365-connector.js";

const DEFAULT_MAX_RESULTS = 50;

export interface PlannerPlan { id: string; title: string }
export interface PlannerTask {
  id: string; title: string; planId: string;
  percentComplete: number; dueDateTime: string; etag: string;
}
export interface PlannerService { /* như Interfaces ở trên */ }

interface RawPlan { id?: unknown; title?: unknown }
interface RawTask {
  id?: unknown; title?: unknown; planId?: unknown;
  percentComplete?: unknown; dueDateTime?: unknown; "@odata.etag"?: unknown;
}
interface ListResponse<T> { value?: T[] }

function asArray<T>(v: T[] | undefined): T[] { return Array.isArray(v) ? v : []; }
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function num(v: unknown): number { return typeof v === "number" && Number.isFinite(v) ? v : 0; }

function toTask(raw: RawTask): PlannerTask | null {
  if (typeof raw?.id !== "string" || typeof raw?.title !== "string") return null;
  return {
    id: raw.id, title: raw.title, planId: str(raw.planId),
    percentComplete: num(raw.percentComplete), dueDateTime: str(raw.dueDateTime),
    etag: str(raw["@odata.etag"]),
  };
}

export function createPlannerService(deps: { connector: Ms365Connector; maxResults?: number }): PlannerService {
  const cap = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const graph = () => deps.connector.graph();

  return {
    async listPlans() {
      const res = await graph().json<ListResponse<RawPlan>>({ method: "GET", path: "/me/planner/plans" });
      const out: PlannerPlan[] = [];
      for (const raw of asArray(res.value)) {
        if (typeof raw?.id !== "string" || typeof raw?.title !== "string") continue;
        out.push({ id: raw.id, title: raw.title });
        if (out.length >= cap) break;
      }
      return out;
    },
    async listTasks(planId: string) {
      const res = await graph().json<ListResponse<RawTask>>({
        method: "GET", path: `/planner/plans/${encodeURIComponent(planId)}/tasks`,
      });
      const out: PlannerTask[] = [];
      for (const raw of asArray(res.value)) {
        const t = toTask(raw);
        if (t !== null) out.push(t);
        if (out.length >= cap) break;
      }
      return out;
    },
    async createTask(input) {
      const body: Record<string, unknown> = { planId: input.planId, title: input.title };
      if (input.dueDateTime !== undefined) body.dueDateTime = input.dueDateTime;
      if (input.assigneeUserIds !== undefined && input.assigneeUserIds.length > 0) {
        const assignments: Record<string, unknown> = {};
        for (const uid of input.assigneeUserIds) {
          assignments[uid] = { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" };
        }
        body.assignments = assignments;
      }
      const raw = await graph().json<RawTask>({ method: "POST", path: "/planner/tasks", body });
      const t = toTask(raw);
      if (t === null) {
        throw new Ms365Error("graph_error", "Planner create response missing id/title.",
          "Thử lại; nếu tiếp diễn hãy kết nối lại Microsoft 365.", false);
      }
      return t;
    },
    async editTask(input) {
      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = input.title;
      if (input.dueDateTime !== undefined) body.dueDateTime = input.dueDateTime;
      if (input.percentComplete !== undefined) body.percentComplete = input.percentComplete;
      await graph().noContent({
        method: "PATCH", path: `/planner/tasks/${encodeURIComponent(input.taskId)}`,
        ifMatch: input.etag, body,
      });
    },
    async deleteTask(input) {
      await graph().noContent({
        method: "DELETE", path: `/planner/tasks/${encodeURIComponent(input.taskId)}`,
        ifMatch: input.etag,
      });
    },
  };
}
```

> Import `Ms365Error` từ `./ms365-errors.js` (khuôn Outlook `getMessage` sau fix `2040ecc`).

- [ ] **Step 4: Run to verify pass** — 5/5.
- [ ] **Step 5: Commit** — `git commit -m "feat(ms365): PlannerService CRUD (ETag If-Match, no Group.Read.All)"`

---

### Task 3: Tool dispatch — 2 read + 3 gated write

**Files:**
- Modify: `service/src/ms365/ms365-tools.ts`
- Test: `service/tests/ms365-planner-tool.test.ts`

**Interfaces:**
- Consumes: `PlannerService` (Task 2); khuôn `handleUpload` hiện có (gate.submit → gate.proceed → performed check).
- Produces: 5 names vào `Ms365ToolName`; `planner: PlannerService` vào `ToolDeps`; 2 read case trong `handleRead`; hàm `handlePlannerWrite` xử lý 3 write ĐÚNG khuôn `handleUpload` (async perform trả promise, await NGOÀI proceed). Route write trong `handleToolCall` TRƯỚC `handleRead` (cùng chỗ upload).

Args validate (dùng `nonEmptyString`): `planner_list_tasks` cần `planId`; `create` cần `planId`+`title` (optional `dueDateTime` string, `assigneeUserIds` string[]); `edit` cần `taskId`+`etag` và ÍT NHẤT một trong title/dueDateTime/percentComplete; `delete` cần `taskId`+`etag`. Sai → `invalid(...)`.

PermissionAction mô tả rõ: create → `Tạo task "${title}" trong Planner`; edit → `Sửa task ${taskId} trong Planner`; delete → `Xóa task ${taskId} trong Planner` (kind `"ms365_write"` như upload).

- [ ] **Step 1: Write the failing test** — khuôn `deps()` như `ms365-planner-tool` cần: copy từ `ms365-outlook-tool.test.ts`, thêm `planner` stub + gate fake CÓ THEO DÕI proceed. Test tối thiểu:

```ts
test("planner_list_plans read runs directly", async () => { /* ok:true, data từ stub */ });
test("planner_list_tasks requires planId → invalid_input", async () => {});
test("planner_create_task runs ONLY behind Allow (gate.proceed performed:true)", async () => {
  // gate fake: proceed => ({ performed: true, result: perform() }) — create chạy, ok:true
});
test("planner_create_task denied when no Allow (performed:false) → kind 'denied', createTask NEVER called", async () => {
  // gate fake: proceed => ({ performed: false }); spy đếm createTask calls === 0
});
test("planner_edit_task requires etag → invalid_input", async () => {});
test("planner_delete_task denied path blocks deleteTask", async () => {});
test("planner tools fail closed when not connected", async () => {});
```

Viết đầy đủ 7 test theo đúng helper style của `ms365-outlook-tool.test.ts` (deps factory + overrides); gate fake hai chế độ allow/deny:

```ts
function allowGate(): ToolDeps["gate"] {
  return { submit: () => {}, proceed: (_id: string, perform: () => unknown) => ({ performed: true, result: perform() }) } as unknown as ToolDeps["gate"];
}
function denyGate(): ToolDeps["gate"] {
  return { submit: () => {}, proceed: () => ({ performed: false }) } as unknown as ToolDeps["gate"];
}
```

> Đọc chữ ký thật của `PermissionGate.proceed` trong `service/src/permission/index.ts` trước khi viết fake — khớp shape thật (xem `handleUpload` dùng thế nào). Nếu shape khác snippet này, chỉnh fake theo shape thật, giữ nguyên ý nghĩa allow/deny.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** — trong `ms365-tools.ts`:

1. Union + deps:

```ts
import type { PlannerService } from "./planner-service.js";
// union thêm:
| "planner_list_plans" | "planner_list_tasks"
| "planner_create_task" | "planner_edit_task" | "planner_delete_task";
// ToolDeps thêm:
planner: PlannerService;
```

2. Read cases trong `handleRead`:

```ts
case "planner_list_plans":
  return { ok: true, data: await deps.planner.listPlans() };
case "planner_list_tasks": {
  if (!nonEmptyString(call.args.planId)) return invalid("planner_list_tasks cần planId là chuỗi.");
  return { ok: true, data: await deps.planner.listTasks(call.args.planId) };
}
```

3. `handlePlannerWrite(deps, call)` — MỘT hàm cho 3 write, đúng khuôn `handleUpload` (validate args → dựng `PermissionAction` mô tả đúng hành động → `gate.submit(createPermissionRequest(...))` → `proceed(call.requestId, () => <promise>)` → `!performed` → denied result; performed → `{ ok:true, data: await outcome.result }` (edit/delete resolve void → `data: { done: true }`)). Route trong `handleToolCall`:

```ts
const PLANNER_WRITES = new Set<Ms365ToolName>(["planner_create_task", "planner_edit_task", "planner_delete_task"]);
// trong try{}: 
if (call.name === "sharepoint_upload_file") return await handleUpload(deps, call);
if (PLANNER_WRITES.has(call.name)) return await handlePlannerWrite(deps, call);
return await handleRead(deps, call);
```

4. Exhaustive default của `handleRead`: sau khi upload + 3 planner write bị route trước đó, default nhận union 4 write names → đổi cast thành:

```ts
const exhaustive: "sharepoint_upload_file" | "planner_create_task" | "planner_edit_task" | "planner_delete_task" = call.name;
```

(vẫn không any/cast — chỉ mở rộng annotation đúng thực tế).

- [ ] **Step 4: Run to verify pass** — 7/7 + suite tool cũ (`ms365-sites-tool`, `ms365-outlook-tool`) không regress: `node --import tsx --test tests/ms365-planner-tool.test.ts tests/ms365-outlook-tool.test.ts tests/ms365-sites-tool.test.ts` (lưu ý: 2 suite cũ construct `ToolDeps` → thêm `planner` stub tối thiểu vào deps factory của chúng, KHÔNG đổi assertions).
- [ ] **Step 5: Commit** — `git commit -m "feat(ms365): planner tools — 2 read direct, 3 writes behind PermissionGate"`

---

### Task 4: Router + index + composition + scope

**Files:**
- Modify: `service/src/ms365/ms365-tool-router.ts`, `service/src/ms365/index.ts`, `service/src/composition/compose-service.ts`
- Test: typecheck + full MS365 suite (integration glue; router logic không đổi ngoài name list). Router test cũ cần `planner` stub trong deps → thêm tối thiểu.

- [ ] **Step 1:** `TOOL_NAMES` thêm 5 planner names.
- [ ] **Step 2:** `index.ts` export `createPlannerService, type PlannerService, type PlannerPlan, type PlannerTask` from `./planner-service.js`.
- [ ] **Step 3:** `compose-service.ts`: import `createPlannerService`; `MS365_SCOPES` thêm `"Tasks.ReadWrite"` (cập nhật doc comment scope cho khớp — đừng lặp lỗi stale comment của P1); trong MS365 IIFE: `const planner = createPlannerService({ connector: ms365Connector });` và thêm `planner,` vào `tools`.
- [ ] **Step 4: Verify** — `npm run typecheck` → exit 0; `cd service && node --import tsx --test tests/ms365-*.test.ts` → toàn bộ PASS incl `ms365-flag-off` + 2 suite planner mới. Cập nhật `docs/integration/ms365-graph-api-map.md`: 5 dòng Planner ⬜ PLANNED → 🟡 CODE + UNIT.
- [ ] **Step 5: Commit** — `git commit -m "feat(ms365): register planner tools + wire PlannerService; scope Tasks.ReadWrite"`

---

## Self-Review

**Spec coverage:** list_plans/list_tasks (đủ trường tóm tắt trễ) → T2/T3; create/edit/delete qua gate → T3 (khuôn handleUpload, test cả Allow lẫn Deny-blocks); ETag If-Match → T1 (client) + T2 (service gửi) + test; GraphClient additive không đổi hành vi cũ → T1 test "unchanged"; scope chỉ Tasks.ReadWrite → T4; assigneeUserIds optional → T2 createTask; flag OFF → T4 flag-off suite; API map update → T4 Step 4. ✓

**Placeholder scan:** không TBD; hai chỗ "đọc file thật trước" (helper test graph-client, shape `PermissionGate.proceed`) là hướng dẫn grep-first có chủ đích vì khuôn thật nằm trong repo — implementer phải khớp code thật thay vì tin snippet.

**Type consistency:** `PlannerService`/`PlannerPlan`/`PlannerTask` (T2) dùng nguyên ở T3 (`ToolDeps.planner`) + T4 (export/wiring); 5 tool names khớp union (T3) ↔ `TOOL_NAMES` (T4); `ifMatch`/`noContent` (T1) dùng ở T2. ✓
