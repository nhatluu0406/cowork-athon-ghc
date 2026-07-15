# MS365 Orchestration (P5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho AI nối nhiều tool MS365 an toàn: prompt block orchestration (chỉ khi connected), batch tool `planner_create_tasks` với MỘT permission card, chế độ write `manual`/`auto` enforce ở service với pill toggle trong composer chat.

**Architecture:** Hybrid theo spec `docs/superpowers/specs/2026-07-14-ms365-orchestration-design.md` — prompt-level orchestration (khối `MS365_ORCHESTRATION_POLICY` prepend cùng chỗ `COWORK_RUNTIME_ACTION_POLICY` trong `app/ui/src/dispatch-plan.ts`) + batch ở tầng tool MS365 (file mới `ms365-batch-tools.ts`, PermissionGate core KHÔNG đổi: 1 request → 1 quyết định, batch = 1 tool call khai báo N mutation trong description). Write-mode là store file-backed theo khuôn `site-scope-store`, one source of truth service-side, route token-guarded, pill trong composer chỉ là client của route.

**Tech Stack:** TypeScript strict (service + UI), `node --import tsx --test`, không dependency mới.

## Global Constraints

- **Commit only, KHÔNG push** (quyết định PO đang hiệu lực cho toàn track D2).
- Feature flag `CGHC_MS365_ENABLED` OFF mặc định — flag off thì KHÔNG construct gì mới; baseline không đổi hành vi.
- **PermissionGate core không đổi**: strictly 1 request → 1 quyết định; write chạy qua `gate.submit` → `gate.proceed(requestId, perform)` sync → check `performed` → await result NGOÀI `proceed`; Deny = `perform` không bao giờ chạy.
- **Mặc định write-mode là `manual`**; scope của mode CHỈ batch tool — write đơn lẻ giữ nguyên 1 card/write.
- Cap batch **20 items**; description permission cắt danh sách title ở **~500 ký tự**, luôn ghi tổng số.
- Secrets không vào log/state/DOM/description. Không token trong file hay chat.
- TypeScript strict, không `any`, không cast che lỗi; exhaustive switch qua `never`.
- Copy hướng user bằng tiếng Việt; tên file/symbol/route tiếng Anh.
- Persistence write-mode: `.runtime/ms365-write-mode.json` (preference file, KHÔNG keyring).
- Route mới: `GET /v1/ms365/write-mode` + `POST /v1/ms365/write-mode` — token-guarded (KHÔNG `publicUnauthenticated`).
- Test service: `cd service && node --import tsx --test tests/<file>.test.ts`. Test UI: `cd app/ui && node --import tsx --test "tests/<file>.test.ts"`. Typecheck: `npm run typecheck` từ repo root (tsc -b).
- Sau khi hoàn thành: cập nhật `docs/integration/ms365-graph-api-map.md` + `docs/product/current-status.md` (Task 5). Mọi lượt live test bằng manual token PHẢI cập nhật api-map.

## File Structure

| File | Vai trò |
|---|---|
| `service/src/ms365/write-mode-store.ts` (mới) | `Ms365WriteMode`, `WriteModeStore` in-memory + persistence seam, default `manual` |
| `service/src/ms365/write-mode-file-persistence.ts` (mới) | File JSON `.runtime/ms365-write-mode.json`, corrupt/missing → null (→ manual) |
| `service/src/ms365/ms365-batch-tools.ts` (mới) | `handlePlannerCreateTasks` — validate, mode enforce, 1 gate request, N Graph call tuần tự, per-item honest |
| `service/src/ms365/ms365-tools.ts` (sửa) | Thêm tên tool + `writeMode` vào `ToolDeps` + route batch trong `handleToolCall` |
| `service/src/ms365/ms365-tool-router.ts` (sửa) | Route write-mode GET/POST, thêm tool name |
| `service/src/ms365/index.ts` (sửa) | Export store/persistence mới |
| `service/src/composition/compose-service.ts` (sửa) | Wire store trong IIFE MS365 |
| `app/ui/src/dispatch-plan.ts` (sửa) | `MS365_ORCHESTRATION_POLICY` + tham số `ms365Connected` |
| `app/ui/src/app-shell.ts` (sửa) | Truyền `ms365Connected` vào 2 call site; fetch msView khi client sẵn sàng; wire pill |
| `app/ui/src/service-client.ts` (sửa) | `fetchMs365WriteMode` / `setMs365WriteMode` |
| `app/ui/src/ui-shell/ms365-write-mode-control.ts` (mới) | Pill toggle Thủ công ⇄ Tự động |
| `app/ui/src/ui-shell/cowork-view.ts` + `create-app-frame.ts` (sửa) | Gắn pill vào `composerBar`, passthrough dom |

---

### Task 1: Write-mode store + file persistence + routes (service)

**Files:**
- Create: `service/src/ms365/write-mode-store.ts`
- Create: `service/src/ms365/write-mode-file-persistence.ts`
- Modify: `service/src/ms365/ms365-tool-router.ts` (thêm path consts, parse, deps, 2 routes)
- Modify: `service/src/ms365/index.ts` (exports)
- Modify: `service/src/composition/compose-service.ts` (wire trong IIFE MS365)
- Test: `service/tests/ms365-write-mode.test.ts`

**Interfaces:**
- Produces: `type Ms365WriteMode = "manual" | "auto"`; `WriteModeStore { mode(): Ms365WriteMode; setMode(mode: Ms365WriteMode): Promise<void> }`; `createWriteModeStore(deps: { persistence: WriteModePersistence }): Promise<WriteModeStore>`; `createWriteModeFilePersistence(filePath: string): WriteModePersistence`; router consts `MS365_WRITE_MODE_PATH = "/v1/ms365/write-mode"`; `Ms365RouterDeps` thêm `readonly writeMode: WriteModeStore`. Task 2 tiêu thụ `Ms365WriteMode` + `writeMode` qua `ToolDeps`; Task 4 tiêu thụ route.

- [ ] **Step 1: Viết test store + persistence (fail trước)**

Tạo `service/tests/ms365-write-mode.test.ts` (khuôn theo `service/tests/ms365-site-scope-store.test.ts`):

```ts
/**
 * Write-mode store: default manual, persist on change, corrupt file falls back to manual,
 * and the router's GET/POST /v1/ms365/write-mode routes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createWriteModeStore,
  type Ms365WriteMode,
  type WriteModePersistence,
} from "../src/ms365/write-mode-store.js";
import { createWriteModeFilePersistence } from "../src/ms365/write-mode-file-persistence.js";

function memoryPersistence(initial: Ms365WriteMode | null = null): WriteModePersistence & {
  saved: Ms365WriteMode[];
} {
  let value = initial;
  const saved: Ms365WriteMode[] = [];
  return {
    saved,
    load: () => Promise.resolve(value),
    save: (mode) => {
      value = mode;
      saved.push(mode);
      return Promise.resolve();
    },
  };
}

test("store defaults to manual when persistence is empty", async () => {
  const store = await createWriteModeStore({ persistence: memoryPersistence() });
  assert.equal(store.mode(), "manual");
});

test("store loads persisted auto mode", async () => {
  const store = await createWriteModeStore({ persistence: memoryPersistence("auto") });
  assert.equal(store.mode(), "auto");
});

test("setMode persists and updates mode()", async () => {
  const persistence = memoryPersistence();
  const store = await createWriteModeStore({ persistence });
  await store.setMode("auto");
  assert.equal(store.mode(), "auto");
  assert.deepEqual(persistence.saved, ["auto"]);
});

test("file persistence: missing file loads null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-write-mode-"));
  const p = createWriteModeFilePersistence(join(dir, "ms365-write-mode.json"));
  assert.equal(await p.load(), null);
});

test("file persistence: corrupt file loads null (never throws)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-write-mode-"));
  const filePath = join(dir, "ms365-write-mode.json");
  await writeFile(filePath, "{not json", "utf8");
  const p = createWriteModeFilePersistence(filePath);
  assert.equal(await p.load(), null);
});

test("file persistence: unknown mode value loads null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-write-mode-"));
  const filePath = join(dir, "ms365-write-mode.json");
  await writeFile(filePath, JSON.stringify({ mode: "yolo" }), "utf8");
  const p = createWriteModeFilePersistence(filePath);
  assert.equal(await p.load(), null);
});

test("file persistence: save round-trips through load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-write-mode-"));
  const filePath = join(dir, "nested", "ms365-write-mode.json");
  const p = createWriteModeFilePersistence(filePath);
  await p.save("auto");
  assert.equal(await p.load(), "auto");
  const raw = JSON.parse(await readFile(filePath, "utf8")) as { mode?: unknown };
  assert.equal(raw.mode, "auto");
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd service && node --import tsx --test tests/ms365-write-mode.test.ts`
Expected: FAIL — `Cannot find module '../src/ms365/write-mode-store.js'`.

- [ ] **Step 3: Implement store + persistence**

Tạo `service/src/ms365/write-mode-store.ts`:

```ts
/**
 * WriteModeStore: one source of truth for the MS365 batch-write confirmation mode.
 * `manual` (default) = the batch tool refuses and the model falls back to per-item writes
 * (one permission card each); `auto` = one Allow covers the declared batch. This is a
 * user preference (never a secret) so it persists as a plain file, NOT in the keyring.
 */
export type Ms365WriteMode = "manual" | "auto";

export interface WriteModePersistence {
  load(): Promise<Ms365WriteMode | null>;
  save(mode: Ms365WriteMode): Promise<void>;
}

export interface WriteModeStore {
  mode(): Ms365WriteMode;
  setMode(mode: Ms365WriteMode): Promise<void>;
}

export async function createWriteModeStore(deps: {
  persistence: WriteModePersistence;
}): Promise<WriteModeStore> {
  let current: Ms365WriteMode = (await deps.persistence.load()) ?? "manual";
  return {
    mode: () => current,
    async setMode(mode: Ms365WriteMode): Promise<void> {
      current = mode;
      await deps.persistence.save(mode);
    },
  };
}
```

Tạo `service/src/ms365/write-mode-file-persistence.ts` (khuôn `site-scope-file-persistence.ts`):

```ts
/**
 * File-backed WriteModePersistence. Stores the batch-write mode (NOT a secret) as JSON.
 * A missing/corrupt/unknown-value file loads as null (store falls back to "manual"),
 * never throws on read — a preference file must not break MS365 startup.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Ms365WriteMode, WriteModePersistence } from "./write-mode-store.js";

function isMode(value: unknown): value is Ms365WriteMode {
  return value === "manual" || value === "auto";
}

export function createWriteModeFilePersistence(filePath: string): WriteModePersistence {
  return {
    async load(): Promise<Ms365WriteMode | null> {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return null;
        const mode = (parsed as Record<string, unknown>).mode;
        return isMode(mode) ? mode : null;
      } catch {
        return null;
      }
    },
    async save(mode: Ms365WriteMode): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ mode }), "utf8");
    },
  };
}
```

Thêm export vào `service/src/ms365/index.ts` (cạnh các export site-scope):

```ts
export {
  createWriteModeStore,
  type Ms365WriteMode,
  type WriteModePersistence,
  type WriteModeStore,
} from "./write-mode-store.js";
export { createWriteModeFilePersistence } from "./write-mode-file-persistence.js";
```

- [ ] **Step 4: Chạy test store, xác nhận PASS**

Run: `cd service && node --import tsx --test tests/ms365-write-mode.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Viết test route (fail trước)**

Append vào `service/tests/ms365-write-mode.test.ts`. Fake deps router: copy đúng khuôn dựng fake `Ms365RouterDeps` từ `service/tests/ms365-sites-routes.test.ts` (file đó đã có fake connector/tools/siteScope đầy đủ — tái dùng helper của nó, thêm trường `writeMode`). Test:

```ts
// ... thêm import:
import { createMs365Router, MS365_WRITE_MODE_PATH, Ms365RouterRequestError } from "../src/ms365/ms365-tool-router.js";
// + import/copy fake-deps helper từ ms365-sites-routes.test.ts (đặt tên buildRouterDeps)

function findRoute(router: ReturnType<typeof createMs365Router>, method: string, path: string) {
  const route = router.routes.find((r) => r.method === method && r.path === path);
  assert.ok(route, `route ${method} ${path} must exist`);
  return route;
}

test("GET /v1/ms365/write-mode returns the current mode", async () => {
  const store = await createWriteModeStore({ persistence: memoryPersistence() });
  const router = createMs365Router({ ...buildRouterDeps(), writeMode: store });
  const route = findRoute(router, "GET", MS365_WRITE_MODE_PATH);
  const result = await route.handler({ body: undefined } as never as Parameters<typeof route.handler>[0]);
  assert.deepEqual(result.data, { mode: "manual" });
});

test("POST /v1/ms365/write-mode switches mode and persists", async () => {
  const persistence = memoryPersistence();
  const store = await createWriteModeStore({ persistence });
  const router = createMs365Router({ ...buildRouterDeps(), writeMode: store });
  const route = findRoute(router, "POST", MS365_WRITE_MODE_PATH);
  const result = await route.handler({ body: { mode: "auto" } } as never as Parameters<typeof route.handler>[0]);
  assert.deepEqual(result.data, { mode: "auto" });
  assert.equal(store.mode(), "auto");
  assert.deepEqual(persistence.saved, ["auto"]);
});

test("POST /v1/ms365/write-mode rejects an unknown mode with a 400-mapped error", async () => {
  const store = await createWriteModeStore({ persistence: memoryPersistence() });
  const router = createMs365Router({ ...buildRouterDeps(), writeMode: store });
  const route = findRoute(router, "POST", MS365_WRITE_MODE_PATH);
  await assert.rejects(
    async () => route.handler({ body: { mode: "yolo" } } as never as Parameters<typeof route.handler>[0]),
    Ms365RouterRequestError,
  );
  assert.equal(store.mode(), "manual");
});
```

Lưu ý: nếu chữ ký `RouteContext` cho phép dựng object literal hợp lệ (`{ body }` + các trường bắt buộc khác) thì dựng đầy đủ theo contract thay vì đoạn `as never as …` — xem cách `ms365-sites-routes.test.ts` dựng `RouteContext` và làm y hệt (KHÔNG cast nếu file mẫu không cast).

Run: `cd service && node --import tsx --test tests/ms365-write-mode.test.ts`
Expected: FAIL — `writeMode` không tồn tại trong `Ms365RouterDeps` / route không tồn tại.

- [ ] **Step 6: Implement routes**

Trong `service/src/ms365/ms365-tool-router.ts`:

Thêm import + const cạnh các path const hiện có:

```ts
import type { Ms365WriteMode, WriteModeStore } from "./write-mode-store.js";

export const MS365_WRITE_MODE_PATH = "/v1/ms365/write-mode";
```

Thêm parse helper (cạnh `parseToggleBody`):

```ts
function parseWriteModeBody(body: unknown): Ms365WriteMode {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const mode = (body as Record<string, unknown>).mode;
  if (mode !== "manual" && mode !== "auto") {
    throw new Ms365RouterRequestError('mode must be "manual" or "auto".');
  }
  return mode;
}
```

Mở rộng `Ms365RouterDeps`:

```ts
export interface Ms365RouterDeps {
  readonly tools: ToolDeps;
  readonly connector: Ms365Connector;
  readonly scopes: readonly string[];
  readonly siteScope: SiteScopeService;
  readonly writeMode: WriteModeStore;
}
```

Thêm 2 route vào mảng `routes` (sau cặp sites/toggle):

```ts
{
  method: "GET",
  path: MS365_WRITE_MODE_PATH,
  handler: (): RouteResult<{ mode: Ms365WriteMode }> => ({
    status: 200,
    data: { mode: deps.writeMode.mode() },
  }),
},
{
  method: "POST",
  path: MS365_WRITE_MODE_PATH,
  handler: async (ctx: RouteContext): Promise<RouteResult<{ mode: Ms365WriteMode }>> => {
    const mode = parseWriteModeBody(ctx.body);
    await deps.writeMode.setMode(mode);
    return { status: 200, data: { mode: deps.writeMode.mode() } };
  },
},
```

- [ ] **Step 7: Wire compose-service**

Trong `service/src/composition/compose-service.ts`:
- Thêm const cạnh `ms365SiteScopeFilePath`: `const ms365WriteModeFilePath = ".runtime/ms365-write-mode.json";`
- Thêm import `createWriteModeFilePersistence, createWriteModeStore` vào block import từ `../ms365/index.js`.
- Trong IIFE MS365, sau `siteScopeStore`:

```ts
const writeModeStore = await createWriteModeStore({
  persistence: createWriteModeFilePersistence(ms365WriteModeFilePath),
});
```

- Truyền vào router: thêm `writeMode: writeModeStore,` vào object `createMs365Router({ ... })` (cạnh `siteScope`).

LƯU Ý cross-task: `ToolDeps.writeMode` (function `() => Ms365WriteMode` trong `tools`) là việc của Task 2 — Task 1 KHÔNG sửa `ToolDeps`. Sau Task 1, mọi test router hiện có (`ms365-sites-routes.test.ts`, `ms365-device-routes.test.ts`, `ms365-tool-router.test.ts`, …) dựng `Ms365RouterDeps` sẽ báo thiếu `writeMode` khi typecheck — sửa các fake đó bằng cách thêm `writeMode: <store fake>` (dùng `createWriteModeStore` + memory persistence, hoặc object literal `{ mode: () => "manual" as const, setMode: async () => {} }` đúng interface).

- [ ] **Step 8: Chạy test + typecheck, xác nhận PASS**

Run: `cd service && node --import tsx --test tests/ms365-write-mode.test.ts tests/ms365-sites-routes.test.ts tests/ms365-tool-router.test.ts tests/ms365-device-routes.test.ts tests/ms365-flag-off.test.ts`
Expected: PASS toàn bộ.
Run: `npm run typecheck` (repo root). Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add service/src/ms365/write-mode-store.ts service/src/ms365/write-mode-file-persistence.ts service/src/ms365/ms365-tool-router.ts service/src/ms365/index.ts service/src/composition/compose-service.ts service/tests/
git commit -m "feat(ms365): batch write-mode store (manual default) + token-guarded write-mode routes"
```

---

### Task 2: Batch tool `planner_create_tasks` + mode enforcement (service)

**Files:**
- Create: `service/src/ms365/ms365-batch-tools.ts`
- Modify: `service/src/ms365/ms365-tools.ts` (union + `ToolDeps.writeMode` + dispatch)
- Modify: `service/src/ms365/ms365-tool-router.ts` (`TOOL_NAMES`)
- Modify: `service/src/composition/compose-service.ts` (`tools.writeMode`)
- Test: `service/tests/ms365-batch-tools.test.ts`

**Interfaces:**
- Consumes: `Ms365WriteMode` (Task 1); `PlannerService.createTask(input: { planId: string; title: string; dueDateTime?: string; assigneeUserIds?: string[] }): Promise<PlannerTask>`; `PermissionGate.submit`/`.proceed`; `createPermissionRequest`; `Ms365Error`.
- Produces: tool name `"planner_create_tasks"`; `ToolDeps` thêm `writeMode: () => Ms365WriteMode`; kết quả `{ created: PlannerTask[]; failed: Array<{ index: number; title: string; error: { kind: string; message: string } }> }`; error kind mới `"manual_mode"` (Task 3 nhắc trong prompt block); `buildBatchDescription` exported cho test.

- [ ] **Step 1: Viết test (fail trước)**

Tạo `service/tests/ms365-batch-tools.test.ts`. Fake `ToolDeps`: copy khuôn fake từ `service/tests/ms365-planner-tool.test.ts` (đã có fake gate + fake planner + connectionState) và thêm `writeMode`. Gate fake phải đếm `submit` và cho phép điều khiển Allow/Deny (khuôn có sẵn trong file mẫu — giữ nguyên cách nó dựng `PermissionGate` thật với quyết định seeded, hoặc spy như file mẫu làm).

```ts
/**
 * planner_create_tasks batch tool: cap/empty validation, manual-mode refusal (no permission
 * request), ONE gate request per batch, Deny blocks all Graph calls, per-item honest results,
 * and the bounded permission description.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { handleToolCall, type ToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";
import { buildBatchDescription } from "../src/ms365/ms365-batch-tools.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
// + copy các helper dựng fake deps/gate từ ms365-planner-tool.test.ts

function batchCall(args: Record<string, unknown>): ToolCall {
  return { name: "planner_create_tasks", args, sessionId: "s1", requestId: "r1" };
}

function tasksOf(n: number): Array<{ title: string }> {
  return Array.from({ length: n }, (_, i) => ({ title: `Task ${i + 1}` }));
}

test("empty tasks array → invalid_input", async () => {
  const deps = buildDeps({ writeMode: "auto" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: [] }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "invalid_input");
});

test("21 tasks → invalid_input asking to split", async () => {
  const deps = buildDeps({ writeMode: "auto" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(21) }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "invalid_input");
});

test("manual mode → manual_mode error, NO permission request submitted, no Graph call", async () => {
  const deps = buildDeps({ writeMode: "manual" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(3) }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "manual_mode");
  assert.equal(deps.spies.submitCount, 0);
  assert.equal(deps.spies.createTaskCalls.length, 0);
});

test("auto + Deny → zero Graph calls, denied result", async () => {
  const deps = buildDeps({ writeMode: "auto", decision: "deny" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(3) }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "denied");
  assert.equal(deps.spies.createTaskCalls.length, 0);
});

test("auto + Allow → ONE submit, N sequential creates, all in created[]", async () => {
  const deps = buildDeps({ writeMode: "auto", decision: "allow" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(3) }));
  assert.equal(result.ok, true);
  assert.equal(deps.spies.submitCount, 1);
  assert.equal(deps.spies.createTaskCalls.length, 3);
  const data = result.ok ? (result.data as { created: unknown[]; failed: unknown[] }) : { created: [], failed: [] };
  assert.equal(data.created.length, 3);
  assert.equal(data.failed.length, 0);
});

test("middle item failing does not break the batch; failed[] carries index/title/kind", async () => {
  const deps = buildDeps({
    writeMode: "auto",
    decision: "allow",
    failOn: { index: 1, error: new Ms365Error("graph_error", "boom", "Thử lại.", true) },
  });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(3) }));
  assert.equal(result.ok, true);
  const data = result.ok
    ? (result.data as { created: unknown[]; failed: Array<{ index: number; title: string; error: { kind: string } }> })
    : { created: [], failed: [] };
  assert.equal(data.created.length, 2);
  assert.deepEqual(
    data.failed.map((f) => ({ index: f.index, title: f.title, kind: f.error.kind })),
    [{ index: 1, title: "Task 2", kind: "graph_error" }],
  );
  assert.equal(deps.spies.createTaskCalls.length, 3);
});

test("description carries total count and bounded titles", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `Một tiêu đề task khá dài số ${i + 1} để vượt ngân sách mô tả` }));
  const desc = buildBatchDescription("plan-1", many);
  assert.ok(desc.includes("Tạo 20 task trong Planner"));
  assert.ok(desc.length < 700);
  assert.ok(desc.includes("…") || desc.includes("khác"));
  const short = buildBatchDescription("plan-1", [{ title: "A" }, { title: "B" }]);
  assert.ok(short.includes('"A"') && short.includes('"B"'));
  assert.ok(short.includes("Tạo 2 task"));
});
```

`buildDeps` trả `ToolDeps & { spies: { submitCount: number; createTaskCalls: unknown[] } }` — implement theo khuôn file mẫu: fake planner đếm `createTaskCalls` và `failOn` ném error tại index chỉ định; gate theo khuôn Allow/Deny của `ms365-planner-tool.test.ts`; `writeMode: () => opts.writeMode`.

Run: `cd service && node --import tsx --test tests/ms365-batch-tools.test.ts`
Expected: FAIL — module `ms365-batch-tools` chưa tồn tại / union chưa có `planner_create_tasks`.

- [ ] **Step 2: Implement `ms365-batch-tools.ts`**

```ts
/**
 * MS365 batch write tool: `planner_create_tasks` — ONE PermissionGate request that
 * transparently declares all N creates, then N sequential Graph calls under that single
 * recorded Allow. Per-item honest results: a failing item never breaks the batch; the model
 * relays exactly which items were created and which failed.
 *
 * Write-mode enforcement lives HERE at the execution boundary (not in the prompt): in
 * `manual` mode (default) the batch refuses with a structured `manual_mode` error BEFORE any
 * permission request, so the model falls back to per-item `planner_create_task` calls (one
 * permission card each). There is no path for a batch to bypass manual mode.
 *
 * Only `import type` from ms365-tools (no runtime cycle: ms365-tools imports this handler
 * as a value; this module imports only types back).
 */
import type { PermissionAction } from "@cowork-ghc/contracts";

import { Ms365Error } from "./ms365-errors.js";
import type { PlannerTask } from "./planner-service.js";
import type { ToolCall, ToolDeps, ToolResult } from "./ms365-tools.js";
import { createPermissionRequest } from "../permission/index.js";

const MAX_BATCH_SIZE = 20;
const DESCRIPTION_TITLES_MAX_CHARS = 500;

interface BatchTaskInput {
  title: string;
  dueDateTime?: string;
  assigneeUserIds?: string[];
}

interface CreateTasksBatchArgs {
  planId: string;
  tasks: BatchTaskInput[];
}

export interface BatchCreateFailure {
  index: number;
  title: string;
  error: { kind: string; message: string };
}

export interface BatchCreateResult {
  created: PlannerTask[];
  failed: BatchCreateFailure[];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => nonEmptyString(v));
}

function readBatchTask(value: unknown): BatchTaskInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!nonEmptyString(record.title)) return null;
  if (record.dueDateTime !== undefined && !nonEmptyString(record.dueDateTime)) return null;
  if (record.assigneeUserIds !== undefined && !isNonEmptyStringArray(record.assigneeUserIds)) return null;
  const out: BatchTaskInput = { title: record.title };
  if (nonEmptyString(record.dueDateTime)) out.dueDateTime = record.dueDateTime;
  if (isNonEmptyStringArray(record.assigneeUserIds)) out.assigneeUserIds = record.assigneeUserIds;
  return out;
}

/** Validates + narrows `planner_create_tasks` args; null when planId/tasks are missing or an
 * item is malformed. Size limits (empty, cap) are reported separately for clearer messages. */
function readCreateTasksBatchArgs(args: Record<string, unknown>): CreateTasksBatchArgs | null {
  if (!nonEmptyString(args.planId)) return null;
  if (!Array.isArray(args.tasks)) return null;
  const tasks: BatchTaskInput[] = [];
  for (const raw of args.tasks) {
    const task = readBatchTask(raw);
    if (task === null) return null;
    tasks.push(task);
  }
  return { planId: args.planId, tasks };
}

/** Permission description: ALWAYS states the total count; the title list is bounded to
 * ~500 chars so a huge batch cannot blow up the permission card. */
export function buildBatchDescription(planId: string, tasks: readonly BatchTaskInput[]): string {
  let titles = "";
  let included = 0;
  for (const task of tasks) {
    const next = titles.length === 0 ? `"${task.title}"` : `${titles}, "${task.title}"`;
    if (next.length > DESCRIPTION_TITLES_MAX_CHARS) break;
    titles = next;
    included += 1;
  }
  const rest = tasks.length - included;
  const suffix = rest > 0 ? `, … (+${rest} task khác)` : "";
  const assigned = tasks.some((t) => t.assigneeUserIds !== undefined && t.assigneeUserIds.length > 0)
    ? " (có gán người phụ trách)"
    : "";
  return `Tạo ${tasks.length} task trong Planner (plan ${planId})${assigned}: ${titles}${suffix}`;
}

function invalid(message: string): ToolResult {
  return {
    ok: false,
    error: {
      kind: "invalid_input",
      message,
      recovery: "Kiểm tra lại tham số của công cụ rồi thử lại.",
    },
  };
}

async function runBatch(deps: ToolDeps, input: CreateTasksBatchArgs): Promise<BatchCreateResult> {
  const created: PlannerTask[] = [];
  const failed: BatchCreateFailure[] = [];
  for (const [index, task] of input.tasks.entries()) {
    try {
      const createInput: Parameters<ToolDeps["planner"]["createTask"]>[0] = {
        planId: input.planId,
        title: task.title,
      };
      if (task.dueDateTime !== undefined) createInput.dueDateTime = task.dueDateTime;
      if (task.assigneeUserIds !== undefined) createInput.assigneeUserIds = task.assigneeUserIds;
      created.push(await deps.planner.createTask(createInput));
    } catch (err) {
      failed.push({
        index,
        title: task.title,
        error:
          err instanceof Ms365Error
            ? { kind: err.kind, message: err.message }
            : { kind: "unknown", message: "Lỗi không xác định khi tạo task." },
      });
    }
  }
  return { created, failed };
}

/**
 * The gated batch write. Mirrors `handleUpload`'s exact permission pattern: `gate.proceed`
 * runs `perform` SYNCHRONOUSLY; `perform` returns the batch promise and we await it OUTSIDE
 * `proceed`. Deny → `performed: false` → zero Graph calls.
 */
export async function handlePlannerCreateTasks(
  deps: ToolDeps,
  call: ToolCall & { name: "planner_create_tasks" },
): Promise<ToolResult> {
  const input = readCreateTasksBatchArgs(call.args);
  if (input === null) {
    return invalid(
      "planner_create_tasks cần planId là chuỗi không rỗng và tasks là mảng {title, dueDateTime?, assigneeUserIds?}.",
    );
  }
  if (input.tasks.length === 0) {
    return invalid("planner_create_tasks cần ít nhất 1 task.");
  }
  if (input.tasks.length > MAX_BATCH_SIZE) {
    return invalid(
      `planner_create_tasks tối đa ${MAX_BATCH_SIZE} task mỗi lần — hãy chia nhỏ thành nhiều batch.`,
    );
  }

  if (deps.writeMode() === "manual") {
    return {
      ok: false,
      error: {
        kind: "manual_mode",
        message: "Đang ở chế độ duyệt thủ công — tạo từng task riêng lẻ để user xác nhận từng cái.",
        recovery:
          "Dùng planner_create_task cho từng task (mỗi task một lần xác nhận), hoặc user bật chế độ Tự động ở thanh soạn tin Microsoft 365.",
      },
    };
  }

  const action: PermissionAction = {
    kind: "ms365_write",
    description: buildBatchDescription(input.planId, input.tasks),
  };
  deps.gate.submit(
    createPermissionRequest({
      requestId: call.requestId,
      sessionId: call.sessionId,
      action,
      requestedAt: deps.now(),
    }),
  );
  const outcome = deps.gate.proceed(call.requestId, () => runBatch(deps, input));
  if (!outcome.performed) {
    return {
      ok: false,
      error: {
        kind: "denied",
        message: "Yêu cầu tạo hàng loạt task Planner chưa được cho phép.",
        recovery: "Chấp thuận yêu cầu quyền rồi chạy lại công cụ.",
      },
    };
  }
  return { ok: true, data: await outcome.result };
}
```

- [ ] **Step 3: Nối vào `ms365-tools.ts`**

Trong `service/src/ms365/ms365-tools.ts`:
- Thêm `| "planner_create_tasks"` vào `Ms365ToolName` (cạnh `"planner_create_task"`).
- Thêm import: `import { handlePlannerCreateTasks } from "./ms365-batch-tools.js";` và `import type { Ms365WriteMode } from "./write-mode-store.js";`
- `ToolDeps` thêm trường:

```ts
  /** Batch-write confirmation mode (Task 1 store). `manual` (default) makes the batch tool
   * refuse with `manual_mode` BEFORE any permission request. Enforced at this execution
   * boundary, never in the prompt. */
  writeMode: () => Ms365WriteMode;
```

- Thêm type-guard (cạnh `isTeamsWrite`):

```ts
/** The Planner batch write, routed through `handlePlannerCreateTasks` (ms365-batch-tools.ts)
 * before any read dispatch. */
function isPlannerBatchWrite(call: ToolCall): call is ToolCall & { name: "planner_create_tasks" } {
  return call.name === "planner_create_tasks";
}
```

- Trong `handleToolCall`, thêm dòng route TRƯỚC `isPlannerWrite`:

```ts
    if (isPlannerBatchWrite(call)) return await handlePlannerCreateTasks(deps, call);
```

- Trong `handleRead`, default-case exhaustive union: thêm `| "planner_create_tasks"` vào danh sách write names.

- [ ] **Step 4: Router + compose-service**

- `ms365-tool-router.ts`: thêm `"planner_create_tasks"` vào `TOOL_NAMES` (sau `"planner_create_task"` hoặc cuối nhóm planner).
- `compose-service.ts`: trong object `tools` của `createMs365Router`, thêm `writeMode: () => writeModeStore.mode(),` (store đã dựng ở Task 1).

- [ ] **Step 5: Sửa các fake `ToolDeps` hiện có**

Typecheck sẽ báo thiếu `writeMode` ở mọi test dựng `ToolDeps` (`ms365-planner-tool.test.ts`, `ms365-lists-tool.test.ts`, `ms365-teams-tool.test.ts`, `ms365-outlook-tool.test.ts`, `ms365-sites-tool.test.ts`, `ms365-tool-router.test.ts`, `ms365-sharepoint*.test.ts` nếu có, …). Thêm `writeMode: () => "manual" as const,` (hoặc `"manual"` literal đúng kiểu) vào từng fake — mode không ảnh hưởng các tool cũ.

- [ ] **Step 6: Chạy test + typecheck**

Run: `cd service && node --import tsx --test tests/ms365-*.test.ts tests/permission-ms365-level.test.ts`
Expected: PASS toàn bộ (suite MS365 hiện 164 test + test mới).
Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add service/src/ms365/ service/src/composition/compose-service.ts service/tests/
git commit -m "feat(ms365): planner_create_tasks batch tool — one permission card, per-item honest, manual-mode enforced at the boundary"
```

---

### Task 3: `MS365_ORCHESTRATION_POLICY` prompt block (UI)

**Files:**
- Modify: `app/ui/src/dispatch-plan.ts`
- Modify: `app/ui/src/app-shell.ts` (2 call site `planDispatchPrompt` + fetch msView khi client sẵn sàng)
- Test: `app/ui/tests/dispatch-plan.test.ts` (append)

**Interfaces:**
- Consumes: `planDispatchPrompt(priorMessages, attachments, userPrompt, maxChars?, skills?)` hiện có; `state.msView.connectionState` trong app-shell.
- Produces: export `MS365_ORCHESTRATION_POLICY: string`; `planDispatchPrompt` nhận tham số thứ 6 `ms365Connected: boolean = false` (additive — mọi call site cũ không đổi hành vi).

- [ ] **Step 1: Viết test (fail trước)**

Append vào `app/ui/tests/dispatch-plan.test.ts` (dùng helper `baseMeta`/khuôn dựng input sẵn có trong file):

```ts
import { MS365_ORCHESTRATION_POLICY } from "../src/dispatch-plan.js";

test("MS365 policy block absent by default and when not connected", () => {
  const plan = planDispatchPrompt([], [], "xin chào");
  assert.equal(plan.ok, true);
  assert.ok(plan.ok && !plan.text.includes("MS365 ORCHESTRATION"));
  const explicit = planDispatchPrompt([], [], "xin chào", undefined, [], false);
  assert.ok(explicit.ok && !explicit.text.includes("MS365 ORCHESTRATION"));
});

test("MS365 policy block present right after the action policy when connected", () => {
  const plan = planDispatchPrompt([], [], "xin chào", undefined, [], true);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.ok(plan.text.includes(MS365_ORCHESTRATION_POLICY));
  const actionIdx = plan.text.indexOf(COWORK_RUNTIME_ACTION_POLICY);
  const ms365Idx = plan.text.indexOf(MS365_ORCHESTRATION_POLICY);
  assert.ok(actionIdx >= 0 && ms365Idx > actionIdx);
});

test("MS365 policy block contains the five orchestration rules", () => {
  for (const marker of [
    "hỏi lại user",          // rule 1: ask-if-ambiguous via chat
    "kế hoạch",              // rule 2: announce the step plan
    "etag",                  // rule 3: read-before-edit
    "planner_create_tasks",  // rule 4: batch tool
    "manual_mode",           // rule 4: fallback per-item on manual mode
    "thành công",            // rule 5: never fake success
  ]) {
    assert.ok(
      MS365_ORCHESTRATION_POLICY.toLowerCase().includes(marker.toLowerCase()),
      `policy must mention: ${marker}`,
    );
  }
});

test("MS365 policy block is budget-accounted (attachments path)", () => {
  // Với maxChars nhỏ, block bật lên phải tính vào fixedChars → fail-fast thay vì tràn budget.
  const tight = COWORK_RUNTIME_ACTION_POLICY.length + MS365_ORCHESTRATION_POLICY.length + 250;
  const plan = planDispatchPrompt([], [], "yêu cầu", tight, [], true);
  if (plan.ok) {
    assert.ok(plan.text.length <= tight);
  } else {
    assert.ok(plan.message.length > 0);
  }
});
```

Run: `cd app/ui && node --import tsx --test "tests/dispatch-plan.test.ts"`
Expected: FAIL — `MS365_ORCHESTRATION_POLICY` chưa export.

- [ ] **Step 2: Implement block + tham số**

Trong `app/ui/src/dispatch-plan.ts`, thêm sau `COWORK_RUNTIME_ACTION_POLICY`:

```ts
/**
 * MS365 orchestration rules, prepended ONLY when MS365 is connected (zero budget cost
 * otherwise). Mode enforcement is server-side; these rules shape model behavior on top.
 */
export const MS365_ORCHESTRATION_POLICY = `[MS365 ORCHESTRATION — BẮT BUỘC KHI DÙNG TOOL MICROSOFT 365]
1. Tìm-trước, hỏi-nếu-mơ-hồ: trước khi thao tác trên plan/list/chat/site có tên do user nêu, PHẢI gọi tool list/discovery tương ứng để xác nhận tồn tại. Nếu có nhiều kết quả khớp, hoặc không rõ user muốn tìm kiếm hay hành động, DỪNG LẠI và hỏi lại user trong hội thoại — không tự đoán.
2. Trước khi thực hiện chuỗi từ 2 tool call trở lên, công bố kế hoạch các bước sẽ làm (dùng todo list của runtime nếu có, tối thiểu là liệt kê bước bằng text trong chat), cập nhật trạng thái từng bước khi chạy.
3. Đọc-trước-khi-sửa: trước khi edit/delete một task Planner, đọc task đó để lấy etag mới nhất.
4. Tác vụ lặp cùng loại trên nhiều đối tượng (vd tạo task cho nhiều người) → dùng planner_create_tasks (batch, tối đa 20). Nếu tool trả lỗi manual_mode: chuyển sang tạo lẻ từng task bằng planner_create_task và nói rõ với user vì sao có nhiều lần xác nhận.
5. KHÔNG BAO GIỜ báo một hành động Microsoft 365 thành công khi tool trả lỗi hoặc bị từ chối — thuật lại đúng lỗi và cách khắc phục cho user.
[/MS365 ORCHESTRATION]`;
```

Sửa chữ ký `planDispatchPrompt`:

```ts
export function planDispatchPrompt(
  priorMessages: readonly ConversationMessage[],
  attachments: readonly AttachmentSnapshot[],
  userPrompt: string,
  maxChars: number = DISPATCH_MAX_CHARS,
  skills: readonly EnabledSkillSnapshot[] = [],
  ms365Connected: boolean = false,
): DispatchPlan {
```

Trong hàm, sửa `fixedChars` (thêm block khi connected):

```ts
  const ms365Block = ms365Connected ? MS365_ORCHESTRATION_POLICY : "";
  const fixedChars =
    COWORK_RUNTIME_ACTION_POLICY.length +
    2 +
    (ms365Block.length > 0 ? ms365Block.length + 2 : 0) +
    userBlock.length +
    (skillContext.text.length > 0 ? skillContext.text.length + 2 : 0);
```

Và ở CẢ HAI chỗ dựng `parts` (nhánh `attachments.length === 0` và nhánh chính), ngay sau `[COWORK_RUNTIME_ACTION_POLICY]`:

```ts
  const parts: string[] = [COWORK_RUNTIME_ACTION_POLICY];
  if (ms365Block.length > 0) parts.push(ms365Block);
```

Kiểm tra `app/ui/src/attachment-context.ts` có re-export `planDispatchPrompt` — chữ ký thêm tham số optional nên re-export không cần sửa.

- [ ] **Step 3: Truyền connected-state từ app-shell**

Trong `app/ui/src/app-shell.ts`:
- Cả 2 call site (`planDispatchPrompt(priorMessages, snapshots, prompt, undefined, enabledSkills)` ~dòng 1606 và `planDispatchPrompt(retry.contextMessages, snapshots, prompt, undefined, enabledSkills)` ~dòng 1665) thêm đối số thứ 6:

```ts
  const ms365Connected = state.msView.connectionState === "connected";
  const dispatchPlan = planDispatchPrompt(priorMessages, snapshots, prompt, undefined, enabledSkills, ms365Connected);
```

(retry path dùng cùng biến `ms365Connected` nếu cùng scope, hoặc tính lại tại chỗ.)
- `state.msView` hiện chỉ được fetch khi mở surface Microsoft (`renderMicrosoftSurfaceBound`, guard `state.msViewFetched`). Để prompt block đúng ngay cả khi user chưa mở tab Microsoft: tách logic fetch thành helper và gọi thêm khi client sẵn sàng. Thêm hàm (đặt gần `renderMicrosoftSurfaceBound`):

```ts
/** Fetch the MS365 view once per client so the cowork composer + dispatch prompt know the
 * real connection state even before the Microsoft surface is opened. */
function ensureMs365ViewFetched(dom: AppDom, state: AppState, handlers: Parameters<typeof renderState>[2]): void {
  if (state.client === null || state.msViewFetched) return;
  state.msViewFetched = true;
  void state.client
    .fetchMs365View()
    .then((view) => {
      state.msView = view;
      renderState(dom, state, handlers);
    })
    .catch(() => {
      // Keep the last known (disconnected) view.
    });
}
```

- Trong `renderMicrosoftSurfaceBound`, thay block fetch inline hiện tại bằng `ensureMs365ViewFetched(dom, state, handlers);` (giữ nguyên phần deps/render phía sau).
- Gọi `ensureMs365ViewFetched(dom, state, handlers);` tại nơi client được tạo — trong `createClient` callback của `createReadinessController` (~dòng 1871, ngay sau `state.client = createServiceClient(baseUrl, clientToken);`) hoặc trong `onState` khi service sẵn sàng nếu `dom`/`handlers` chưa vào scope tại `createClient`; chọn điểm mà cả `dom`, `state`, `handlers` cùng scope (đọc code xung quanh và đặt cho đúng — KHÔNG tạo mechanism fetch thứ hai, một guard `msViewFetched` duy nhất).

- [ ] **Step 4: Chạy test + typecheck**

Run: `cd app/ui && node --import tsx --test "tests/dispatch-plan.test.ts" "tests/skill-dispatch.test.ts"`
Expected: PASS (test cũ không đổi hành vi vì tham số default `false`).
Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/ui/src/dispatch-plan.ts app/ui/src/app-shell.ts app/ui/tests/dispatch-plan.test.ts
git commit -m "feat(ui): MS365 orchestration policy block — injected only when MS365 connected, budget-accounted"
```

---

### Task 4: Composer pill toggle + service-client write-mode methods (UI)

**Files:**
- Create: `app/ui/src/ui-shell/ms365-write-mode-control.ts`
- Modify: `app/ui/src/service-client.ts` (2 method + type)
- Modify: `app/ui/src/ui-shell/cowork-view.ts` (gắn pill vào `composerBar`, expose dom)
- Modify: `app/ui/src/ui-shell/create-app-frame.ts` (passthrough)
- Modify: `app/ui/src/app-shell.ts` (hiện/ẩn theo connected + click → POST route)
- Modify: `app/ui/src/commercial.css` (style pill — thêm cạnh `.composer__bar` ~dòng 573)
- Test: `app/ui/tests/ms365-write-mode-control.test.ts`

**Interfaces:**
- Consumes: route `GET/POST /v1/ms365/write-mode` (Task 1); `state.msView.connectionState`; khuôn control `permission-mode-control.ts`; helper `el` từ `ui-shell/dom-utils.js`.
- Produces: `service-client.ts` thêm `export type Ms365WriteMode = "manual" | "auto"` + `fetchMs365WriteMode(): Promise<{ mode: Ms365WriteMode }>` + `setMs365WriteMode(mode: Ms365WriteMode): Promise<{ mode: Ms365WriteMode }>` (thêm vào cả interface client lẫn implementation, khuôn các method MS365 hiện có ~dòng 956); control `Ms365WriteModeControl { root: HTMLElement; button: HTMLButtonElement; getMode(): Ms365WriteMode; setMode(mode): void; setVisible(visible: boolean): void }` phát CustomEvent `"ms365-write-mode-toggle"` trên `root` khi click.

- [ ] **Step 1: Viết test control (fail trước)**

Tạo `app/ui/tests/ms365-write-mode-control.test.ts` (khuôn setup happy-dom theo các test UI DOM hiện có — xem test nào trong `app/ui/tests/` đăng ký `@happy-dom/global-registrator` và làm giống):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const { createMs365WriteModeControl } = await import("../src/ui-shell/ms365-write-mode-control.js");

test("hidden by default, manual label, aria-pressed false", () => {
  const control = createMs365WriteModeControl();
  assert.equal(control.root.hidden, true);
  assert.ok(control.button.textContent?.includes("Thủ công"));
  assert.equal(control.button.getAttribute("aria-pressed"), "false");
  assert.equal(control.getMode(), "manual");
});

test("setVisible shows/hides the pill", () => {
  const control = createMs365WriteModeControl();
  control.setVisible(true);
  assert.equal(control.root.hidden, false);
  control.setVisible(false);
  assert.equal(control.root.hidden, true);
});

test("setMode('auto') updates label + aria-pressed without emitting", () => {
  const control = createMs365WriteModeControl();
  let events = 0;
  control.root.addEventListener("ms365-write-mode-toggle", () => { events += 1; });
  control.setMode("auto");
  assert.ok(control.button.textContent?.includes("Tự động"));
  assert.equal(control.button.getAttribute("aria-pressed"), "true");
  assert.equal(control.getMode(), "auto");
  assert.equal(events, 0);
});

test("click emits ms365-write-mode-toggle with the REQUESTED next mode, state unchanged until setMode", () => {
  const control = createMs365WriteModeControl();
  const requested: string[] = [];
  control.root.addEventListener("ms365-write-mode-toggle", (event) => {
    requested.push((event as CustomEvent<string>).detail);
  });
  control.button.click();
  assert.deepEqual(requested, ["auto"]);
  // Nguồn sự thật là service: control KHÔNG tự đổi mode khi click — app-shell gọi route rồi setMode.
  assert.equal(control.getMode(), "manual");
});
```

Run: `cd app/ui && node --import tsx --test "tests/ms365-write-mode-control.test.ts"`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 2: Implement control**

Tạo `app/ui/src/ui-shell/ms365-write-mode-control.ts`:

```ts
/**
 * MS365 batch write-mode pill for the chat composer. Visible only while MS365 is connected.
 * The pill is a pure CLIENT of the service's write-mode route: clicking emits
 * "ms365-write-mode-toggle" with the requested next mode; the shell calls the route and then
 * confirms via setMode — the control never flips state on its own (one source of truth).
 */
import { el } from "./dom-utils.js";
import type { Ms365WriteMode } from "../service-client.js";

const MODE_COPY: Readonly<Record<Ms365WriteMode, { label: string; description: string }>> = {
  manual: {
    label: "MS365: Thủ công",
    description: "Mỗi thao tác ghi hàng loạt lên Microsoft 365 sẽ được tách nhỏ và hỏi từng lần.",
  },
  auto: {
    label: "MS365: Tự động",
    description: "Một lần phê duyệt phủ cả loạt task đã khai báo; thao tác ghi lẻ vẫn hỏi từng lần.",
  },
};

export interface Ms365WriteModeControl {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  getMode(): Ms365WriteMode;
  setMode(mode: Ms365WriteMode): void;
  setVisible(visible: boolean): void;
}

export function createMs365WriteModeControl(): Ms365WriteModeControl {
  const root = el("div", "ms365-mode-control");
  root.hidden = true;
  const button = el("button", "ms365-mode-control__button") as HTMLButtonElement;
  button.type = "button";
  root.append(button);

  let mode: Ms365WriteMode = "manual";

  const update = (): void => {
    const copy = MODE_COPY[mode];
    button.textContent = copy.label;
    button.dataset["mode"] = mode;
    button.dataset["tooltip"] = `${copy.label} — ${copy.description}`;
    button.setAttribute("aria-pressed", mode === "auto" ? "true" : "false");
    button.setAttribute("aria-label", `Chế độ ghi hàng loạt Microsoft 365: ${copy.label}. ${copy.description}`);
  };

  button.addEventListener("click", () => {
    const next: Ms365WriteMode = mode === "manual" ? "auto" : "manual";
    root.dispatchEvent(new CustomEvent<Ms365WriteMode>("ms365-write-mode-toggle", { detail: next }));
  });

  update();
  return {
    root,
    button,
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
      update();
    },
    setVisible: (visible) => {
      root.hidden = !visible;
    },
  };
}
```

- [ ] **Step 3: service-client methods**

Trong `app/ui/src/service-client.ts`:
- Thêm type cạnh `Ms365ViewData` (~dòng 343):

```ts
export type Ms365WriteMode = "manual" | "auto";
```

- Interface client (cạnh `setMs365SiteEnabled`, ~dòng 558):

```ts
  /** Đọc chế độ ghi hàng loạt MS365 hiện tại. */
  fetchMs365WriteMode(): Promise<{ mode: Ms365WriteMode }>;
  /** Đổi chế độ ghi hàng loạt MS365 (nguồn sự thật ở service). */
  setMs365WriteMode(mode: Ms365WriteMode): Promise<{ mode: Ms365WriteMode }>;
```

- Implementation (cạnh `setMs365SiteEnabled`, ~dòng 982, đúng khuôn `call` hiện dùng):

```ts
    fetchMs365WriteMode: () => call<{ mode: Ms365WriteMode }>("/v1/ms365/write-mode"),
    setMs365WriteMode: (mode) =>
      call<{ mode: Ms365WriteMode }>("/v1/ms365/write-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),
```

(Đọc chữ ký `call` thực tế trong file — các method MS365 khác truyền options thế nào thì làm y hệt, ví dụ nếu chúng truyền object `{ method: "POST", body: {...} }` không stringify thì theo đúng khuôn đó.)

- [ ] **Step 4: Gắn vào composer + app-shell**

`app/ui/src/ui-shell/cowork-view.ts`:
- Import: `import { createMs365WriteModeControl, type Ms365WriteModeControl } from "./ms365-write-mode-control.js";`
- `CoworkViewDom` thêm: `readonly ms365WriteModeControl: Ms365WriteModeControl;`
- Trong `createCoworkView`, sau `const providerControl = ...`: `const ms365WriteModeControl = createMs365WriteModeControl();`
- Sửa dòng append composerBar:

```ts
  composerBar.append(attachButton, permissionModeControl.root, skillsButton, providerControl.root, ms365WriteModeControl.root, el("span", "composer__spacer"), cancelButton, sendButton);
```

- Thêm `ms365WriteModeControl,` vào object return.

`app/ui/src/ui-shell/create-app-frame.ts`: thêm `readonly ms365WriteModeControl: Ms365WriteModeControl;` (import type từ control module) vào interface dom (~dòng 53 khu composer) và `ms365WriteModeControl: cowork.ms365WriteModeControl,` vào chỗ passthrough (~dòng 173).

`app/ui/src/app-shell.ts`:
- Trong `ensureMs365ViewFetched` (Task 3) — sau khi `state.msView = view;`, thêm refresh pill:

```ts
      state.msView = view;
      void refreshMs365WriteModePill(dom, state);
      renderState(dom, state, handlers);
```

- Thêm helper (gần `ensureMs365ViewFetched`):

```ts
/** Shows the composer write-mode pill only while MS365 is connected, seeded from the service
 * (one source of truth). Errors hide the pill — never show a mode we could not read. */
async function refreshMs365WriteModePill(dom: AppDom, state: AppState): Promise<void> {
  const control = dom.ms365WriteModeControl;
  if (state.client === null || state.msView.connectionState !== "connected") {
    control.setVisible(false);
    return;
  }
  try {
    const { mode } = await state.client.fetchMs365WriteMode();
    control.setMode(mode);
    control.setVisible(true);
  } catch {
    control.setVisible(false);
  }
}
```

- Surface Microsoft đã có `onViewChange` cập nhật `state.msView` (~dòng 287): thêm `void refreshMs365WriteModePill(dom, state);` trong callback đó (connect/disconnect từ tab Microsoft phải hiện/ẩn pill ngay).
- Wire click (đặt cùng khu các listener composer, ~dòng 2119):

```ts
  dom.ms365WriteModeControl.root.addEventListener("ms365-write-mode-toggle", (event) => {
    const requested = (event as CustomEvent<import("./service-client.js").Ms365WriteMode>).detail;
    const client = state.client;
    if (client === null) return;
    void client
      .setMs365WriteMode(requested)
      .then(({ mode }) => dom.ms365WriteModeControl.setMode(mode))
      .catch(() => {
        // Giữ mode cũ — route lỗi thì không đổi nhãn (không render trạng thái giả).
      });
  });
```

- CSS: thêm vào `app/ui/src/commercial.css` (ngay sau block `.composer__bar` ~dòng 573):

```css
.ms365-mode-control__button {
  border: 1px solid var(--border, #d0d0d0);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.ms365-mode-control__button[data-mode="auto"] {
  border-color: var(--accent, #4b6bfb);
  color: var(--accent, #4b6bfb);
}
```

(Nếu `commercial.css` có sẵn token màu khác tên — ví dụ `--color-border`/`--color-accent` — dùng đúng token của file đó thay vì giá trị trên; xem các nút cạnh bên như `.skills-btn` dùng token nào.)

- [ ] **Step 5: Chạy test + typecheck**

Run: `cd app/ui && node --import tsx --test "tests/ms365-write-mode-control.test.ts" "tests/dispatch-plan.test.ts"`
Expected: PASS.
Run: `npm run typecheck`. Expected: exit 0.
Run: `cd service && node --import tsx --test tests/ms365-write-mode.test.ts` (route regression). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/ui/src/ app/ui/tests/
git commit -m "feat(ui): MS365 write-mode pill in the chat composer — visible when connected, service is the source of truth"
```

---

### Task 5: Docs + verify (api-map, current-status, live consumption procedure)

**Files:**
- Modify: `docs/integration/ms365-graph-api-map.md`
- Modify: `docs/product/current-status.md`
- Modify: `.superpowers/sdd/progress.md` (ledger — controller cập nhật, task này chỉ đề cập)

**Interfaces:** Consumes mọi deliverable Task 1–4. Không code mới.

- [ ] **Step 1: Cập nhật api-map**

Trong `docs/integration/ms365-graph-api-map.md`:
- Mục 5 (Planner) thêm dòng:

```markdown
| `/planner/tasks` (N lần, tuần tự) | POST | `planner_create_tasks` (batch, P5) | 🟡 **CODE + UNIT** | **MỘT permission card khai báo cả loạt (cap 20)**; per-item honest (`created[]`/`failed[]`); bị chặn bởi write-mode `manual` (mặc định) — trả `manual_mode` để model tạo lẻ từng task |
```

- Thêm ghi chú dưới bảng mục 5:

```markdown
> Write-mode `manual`/`auto` (P5): lưu `.runtime/ms365-write-mode.json`, đổi qua
> `GET/POST /v1/ms365/write-mode` (token-guarded) — pill toggle trong composer chat. CHỈ ảnh
> hưởng batch tool; mọi write lẻ vẫn một card một lần.
```

- Mục 10 thêm bước: xác nhận live consumption run (mục 3 hiện có) giờ là **acceptance của P5** — cập nhật câu chữ nếu cần.

- [ ] **Step 2: Cập nhật current-status**

Thêm block P5 vào `docs/product/current-status.md` theo đúng khuôn các block P0.5–P4 (tiếng Việt, có mục "Hạn chế trung thực"):
- Đã làm: prompt block (điều kiện connected, budget-accounted), batch tool + mode enforce service-side, pill composer, routes, persistence, số test mới.
- Hạn chế trung thực: (1) **live tool-consumption run CHƯA chạy** — cần user với token thật, app packaged, flag ON; kết quả (PASS/FAIL) phải ghi vào api-map + block này; (2) `get_file_summary` allowlist gap vẫn tracked; (3) toàn bộ endpoint Planner/Lists/Teams vẫn 🟡 chưa live-verify (thiếu scope consent).

- [ ] **Step 3: Quy trình live consumption run (ghi lại, không claim)**

Ghi vào block current-status P5 quy trình (để user chạy):

```text
1. set CGHC_MS365_ENABLED=1 (+ CGHC_MS365_TEST_TOKEN không cần — connect dán token trong UI)
2. Build + chạy app packaged, connect MS365 bằng manual token (không dán token vào file/chat)
3. Prompt: "Liệt kê các plan Planner của tôi" → quan sát tool call tới /v1/ms365/tool-call
   và kết quả quay về model (log service / UI tool-call row)
4. Ghi PASS/FAIL trung thực vào docs/integration/ms365-graph-api-map.md (mục 10, quy tắc
   chuẩn: MỌI lượt test manual token đều cập nhật api-map) + current-status
```

- [ ] **Step 4: Commit**

```bash
git add docs/integration/ms365-graph-api-map.md docs/product/current-status.md
git commit -m "docs(ms365): P5 status — batch tool + write-mode in api-map, honest live-run pending in current-status"
```

---

## Self-Review (đã chạy)

- **Spec coverage:** Mảnh 1 (prompt block) → Task 3; Mảnh 2 (batch + mode + pill + routes) → Task 1, 2, 4; Mảnh 3 (live consumption) → Task 5 (thủ tục + ghi nhận trung thực — cần user, không claim PASS). Acceptance 1→T3, 2→T1/T2/T4, 3→T2 (unit demo-contract), 4→T3, 5→T5, 6→mọi task (typecheck+tests, flag OFF, gate không đổi).
- **Type consistency:** `Ms365WriteMode` định nghĩa 1 lần ở service (`write-mode-store.ts`) + 1 lần ở UI (`service-client.ts` — UI không import từ service src, đúng biên client); `ToolDeps.writeMode: () => Ms365WriteMode`; route body `{ mode }`; control event `"ms365-write-mode-toggle"` detail = mode kế tiếp.
- **Known cross-task typecheck break:** Task 1 làm router-deps fakes cũ thiếu `writeMode` (fix trong Task 1 Step 7); Task 2 làm ToolDeps fakes cũ thiếu `writeMode` (fix trong Task 2 Step 5) — pattern pull-forward như các phase trước, ghi ledger.
