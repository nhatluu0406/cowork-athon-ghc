# MS365 Custom Power Automate Flow Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép người dùng add/xóa/bật-tắt/đặt-timeout các Power Automate flow tùy chỉnh trong tab Microsoft 365, và khi trigger thì chờ + trả về feedback (response body) của flow.

**Architecture:** Mở rộng `PowerAutomateStore` (thêm `enabled` + `timeoutMs`, backward-compat), thêm 5 route quản lý vào MS365 boundary router (mirror pattern `sites`/`write-mode`), nâng `PowerAutomateService.triggerFlow` để chờ body + timeout qua AbortController, cho `power_automate_trigger_flow` gọi theo `name` (resolve server-side, từ chối flow tắt), và thêm section quản lý trong `renderConnectedSummary` của UI. URL flow là bearer secret → chỉ ở server, không bao giờ gửi renderer.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `node:test` + `tsx` (`npm test`), `tsc -b` (`npm run typecheck`), DOM-only renderer (no framework).

## Global Constraints

- **URL flow = bearer secret** — không trả về renderer, không vào Permission card, không vào log. GET/route trả list chỉ gồm `{ name, enabled, timeoutMs }`.
- **Backward-compat**: file `.runtime/ms365-power-automate.json` cũ (entry chỉ có `name`+`url`) phải nạp được, tự điền `enabled=true`, `timeoutMs=120000`.
- `DEFAULT_FLOW_TIMEOUT_MS = 120_000`; `MIN_FLOW_TIMEOUT_MS = 1_000`; `MAX_FLOW_TIMEOUT_MS = 600_000`; `MAX_FLOW_BODY_CHARS = 65_536`.
- Import specifiers dùng đuôi `.js` (ESM/NodeNext). Test chạy bằng `node --import tsx --test`.
- TDD: test trước, chạy để thấy FAIL, code tối thiểu, chạy để PASS, commit. Không đụng `package-lock.json`.
- Section UI chỉ hiển thị khi `connectionState === "connected"`.
- Không thêm nút trigger tại UI; trigger vẫn do agent gọi tool qua Permission gate (giữ nguyên gate `not_connected` + `sessionAllowed`).

---

### Task 1: Store schema + backward-compat + thao tác granular

**Files:**
- Modify: `service/src/ms365/power-automate-store.ts`
- Test: `service/tests/ms365-power-automate-store.test.ts` (create)

**Interfaces:**
- Produces:
  - `interface PowerAutomateFlow { readonly name: string; readonly url: string; readonly enabled: boolean; readonly timeoutMs: number }`
  - `const DEFAULT_FLOW_TIMEOUT_MS = 120_000`, `MIN_FLOW_TIMEOUT_MS = 1_000`, `MAX_FLOW_TIMEOUT_MS = 600_000`
  - `PowerAutomateStore`: `list(): readonly PowerAutomateFlow[]`, `resolve(name: string): PowerAutomateFlow | null`, `add(flow: { name: string; url: string; timeoutMs: number }): Promise<void>` (throws `Error` nếu trùng tên), `remove(name: string): Promise<void>`, `setEnabled(name: string, enabled: boolean): Promise<void>`, `setTimeout(name: string, timeoutMs: number): Promise<void>`, `setFlows(flows: readonly PowerAutomateFlow[]): Promise<void>`
  - `clampTimeout(value: unknown): number`

- [ ] **Step 1: Write the failing test**

Create `service/tests/ms365-power-automate-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPowerAutomateStore,
  DEFAULT_FLOW_TIMEOUT_MS,
  MAX_FLOW_TIMEOUT_MS,
  MIN_FLOW_TIMEOUT_MS,
  type PowerAutomateFlow,
  type PowerAutomatePersistence,
} from "../src/ms365/power-automate-store.js";

function memPersistence(initial: readonly PowerAutomateFlow[] | null): {
  persistence: PowerAutomatePersistence;
  saved: () => readonly PowerAutomateFlow[] | null;
} {
  let current = initial;
  return {
    persistence: {
      load: async () => current,
      save: async (flows) => {
        current = flows;
      },
    },
    saved: () => current,
  };
}

test("normalizes legacy entries missing enabled/timeoutMs", async () => {
  // Legacy file: only name+url (cast through PowerAutomateFlow shape).
  const legacy = [{ name: "old", url: "https://x/y?sig=a" }] as unknown as PowerAutomateFlow[];
  const { persistence } = memPersistence(legacy);
  const store = await createPowerAutomateStore({ persistence });
  const [flow] = store.list();
  assert.equal(flow.enabled, true);
  assert.equal(flow.timeoutMs, DEFAULT_FLOW_TIMEOUT_MS);
});

test("add appends enabled flow and rejects duplicate name", async () => {
  const { persistence, saved } = memPersistence([]);
  const store = await createPowerAutomateStore({ persistence });
  await store.add({ name: "f1", url: "https://x/1?sig=a", timeoutMs: 5000 });
  assert.deepEqual(store.list(), [{ name: "f1", url: "https://x/1?sig=a", enabled: true, timeoutMs: 5000 }]);
  assert.equal((saved() ?? []).length, 1);
  await assert.rejects(() => store.add({ name: "f1", url: "https://x/2?sig=b", timeoutMs: 5000 }));
});

test("remove, setEnabled, setTimeout persist", async () => {
  const { persistence } = memPersistence([]);
  const store = await createPowerAutomateStore({ persistence });
  await store.add({ name: "f1", url: "https://x/1?sig=a", timeoutMs: 5000 });
  await store.setEnabled("f1", false);
  assert.equal(store.resolve("f1")?.enabled, false);
  await store.setTimeout("f1", 9000);
  assert.equal(store.resolve("f1")?.timeoutMs, 9000);
  await store.remove("f1");
  assert.equal(store.resolve("f1"), null);
  assert.deepEqual(store.list(), []);
});

test("clamps timeout out of range", async () => {
  const { persistence } = memPersistence([]);
  const store = await createPowerAutomateStore({ persistence });
  await store.add({ name: "lo", url: "https://x/1?sig=a", timeoutMs: 10 });
  await store.add({ name: "hi", url: "https://x/2?sig=b", timeoutMs: 10_000_000 });
  assert.equal(store.resolve("lo")?.timeoutMs, MIN_FLOW_TIMEOUT_MS);
  assert.equal(store.resolve("hi")?.timeoutMs, MAX_FLOW_TIMEOUT_MS);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="normalizes legacy|add appends|remove, setEnabled|clamps timeout"`
Expected: FAIL (exports `DEFAULT_FLOW_TIMEOUT_MS`, `store.add`, etc. not defined).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `service/src/ms365/power-automate-store.ts` with:

```ts
/**
 * PowerAutomateStore: named list of configured flow trigger URLs (Settings-managed, not a
 * secret vault — a flow's HTTP-trigger URL is itself an unguessable bearer of authorization,
 * same trust class as a webhook URL, stored as plain JSON via the file persistence, never in
 * the vault). Each flow carries an enable toggle and a per-flow trigger timeout. Empty by
 * default; `trigger_flow` still works by direct URL with no configured entries.
 */
export interface PowerAutomateFlow {
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly timeoutMs: number;
}

export const DEFAULT_FLOW_TIMEOUT_MS = 120_000;
export const MIN_FLOW_TIMEOUT_MS = 1_000;
export const MAX_FLOW_TIMEOUT_MS = 600_000;

export interface PowerAutomatePersistence {
  load(): Promise<readonly PowerAutomateFlow[] | null>;
  save(flows: readonly PowerAutomateFlow[]): Promise<void>;
}

export interface PowerAutomateStore {
  list(): readonly PowerAutomateFlow[];
  resolve(name: string): PowerAutomateFlow | null;
  add(flow: { name: string; url: string; timeoutMs: number }): Promise<void>;
  remove(name: string): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setTimeout(name: string, timeoutMs: number): Promise<void>;
  setFlows(flows: readonly PowerAutomateFlow[]): Promise<void>;
}

export function clampTimeout(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_FLOW_TIMEOUT_MS;
  if (n < MIN_FLOW_TIMEOUT_MS) return MIN_FLOW_TIMEOUT_MS;
  if (n > MAX_FLOW_TIMEOUT_MS) return MAX_FLOW_TIMEOUT_MS;
  return n;
}

function isFlow(value: unknown): value is { name: string; url: string; enabled?: unknown; timeoutMs?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.url === "string";
}

/** Fill defaults for legacy entries (missing enabled/timeoutMs) and clamp timeout. */
function normalize(raw: readonly PowerAutomateFlow[]): PowerAutomateFlow[] {
  return raw.filter(isFlow).map((f) => ({
    name: f.name,
    url: f.url,
    enabled: typeof (f as { enabled?: unknown }).enabled === "boolean" ? (f as { enabled: boolean }).enabled : true,
    timeoutMs: clampTimeout((f as { timeoutMs?: unknown }).timeoutMs),
  }));
}

export async function createPowerAutomateStore(deps: {
  persistence: PowerAutomatePersistence;
}): Promise<PowerAutomateStore> {
  let current: PowerAutomateFlow[] = normalize((await deps.persistence.load()) ?? []);

  async function commit(next: PowerAutomateFlow[]): Promise<void> {
    current = next;
    await deps.persistence.save(current);
  }

  return {
    list: () => current,
    resolve: (name) => current.find((f) => f.name === name) ?? null,
    async add(flow) {
      if (current.some((f) => f.name === flow.name)) {
        throw new Error(`A flow named "${flow.name}" already exists.`);
      }
      await commit([...current, { name: flow.name, url: flow.url, enabled: true, timeoutMs: clampTimeout(flow.timeoutMs) }]);
    },
    async remove(name) {
      await commit(current.filter((f) => f.name !== name));
    },
    async setEnabled(name, enabled) {
      await commit(current.map((f) => (f.name === name ? { ...f, enabled } : f)));
    },
    async setTimeout(name, timeoutMs) {
      await commit(current.map((f) => (f.name === name ? { ...f, timeoutMs: clampTimeout(timeoutMs) } : f)));
    },
    async setFlows(flows) {
      await commit(normalize(flows));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="normalizes legacy|add appends|remove, setEnabled|clamps timeout"`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add service/src/ms365/power-automate-store.ts service/tests/ms365-power-automate-store.test.ts
git commit -m "feat(ms365): power-automate store gains enabled + timeout + granular ops"
```

Note: `service/src/ms365/power-automate-file-persistence.ts` needs no change — its `isFlow` still checks `name`+`url` only, and the store normalizes on load.

---

### Task 2: Service — trigger feedback + timeout + resolve/list-enabled

**Files:**
- Modify: `service/src/ms365/ms365-errors.ts` (add `"timeout"` kind)
- Modify: `service/src/ms365/power-automate-service.ts`
- Test: `service/tests/ms365-power-automate-service.test.ts` (create)

**Interfaces:**
- Consumes: `PowerAutomateStore` (Task 1), `SsrfPolicy`, `Ms365Error`.
- Produces (`PowerAutomateService`):
  - `listFlows(): { readonly name: string }[]` — **enabled only**
  - `resolveFlow(name: string): { url: string; timeoutMs: number; enabled: boolean } | null`
  - `triggerFlow(input: { url: string; payload?: unknown; timeoutMs: number }): Promise<{ status: number; body: string }>`
  - `const MAX_FLOW_BODY_CHARS = 65_536`

- [ ] **Step 1: Write the failing test**

Create `service/tests/ms365-power-automate-service.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPowerAutomateService } from "../src/ms365/power-automate-service.js";
import { createPowerAutomateStore, type PowerAutomateFlow } from "../src/ms365/power-automate-store.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
import type { SsrfPolicy } from "../src/provider/index.js";

const allowAll: SsrfPolicy = { assertAllowed: async () => {} } as unknown as SsrfPolicy;

async function storeWith(flows: readonly PowerAutomateFlow[]) {
  return createPowerAutomateStore({ persistence: { load: async () => flows, save: async () => {} } });
}

test("listFlows returns only enabled flows", async () => {
  const store = await storeWith([
    { name: "on", url: "https://x/1?sig=a", enabled: true, timeoutMs: 5000 },
    { name: "off", url: "https://x/2?sig=b", enabled: false, timeoutMs: 5000 },
  ]);
  const svc = createPowerAutomateService({ store, ssrf: allowAll });
  assert.deepEqual(svc.listFlows(), [{ name: "on" }]);
});

test("resolveFlow returns url/timeout/enabled or null", async () => {
  const store = await storeWith([{ name: "on", url: "https://x/1?sig=a", enabled: false, timeoutMs: 7000 }]);
  const svc = createPowerAutomateService({ store, ssrf: allowAll });
  assert.deepEqual(svc.resolveFlow("on"), { url: "https://x/1?sig=a", timeoutMs: 7000, enabled: false });
  assert.equal(svc.resolveFlow("missing"), null);
});

test("triggerFlow returns status + bounded body", async () => {
  const store = await storeWith([]);
  const fetchImpl = (async () => new Response("ok-body", { status: 200 })) as unknown as typeof fetch;
  const svc = createPowerAutomateService({ store, ssrf: allowAll, fetchImpl });
  const out = await svc.triggerFlow({ url: "https://x/1?sig=a", payload: { a: 1 }, timeoutMs: 5000 });
  assert.deepEqual(out, { status: 200, body: "ok-body" });
});

test("triggerFlow throws Ms365Error timeout on abort", async () => {
  const store = await storeWith([]);
  const fetchImpl = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch;
  const svc = createPowerAutomateService({ store, ssrf: allowAll, fetchImpl });
  await assert.rejects(
    () => svc.triggerFlow({ url: "https://x/1?sig=a", timeoutMs: 20 }),
    (err) => err instanceof Ms365Error && err.kind === "timeout",
  );
});

test("triggerFlow throws graph_error on non-ok", async () => {
  const store = await storeWith([]);
  const fetchImpl = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
  const svc = createPowerAutomateService({ store, ssrf: allowAll, fetchImpl });
  await assert.rejects(
    () => svc.triggerFlow({ url: "https://x/1?sig=a", timeoutMs: 5000 }),
    (err) => err instanceof Ms365Error && err.kind === "graph_error",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="listFlows returns only|resolveFlow returns|triggerFlow returns status|triggerFlow throws"`
Expected: FAIL (`resolveFlow` not a function; `triggerFlow` returns `{status}` only; kind `"timeout"` not assignable).

- [ ] **Step 3a: Add the `timeout` error kind**

In `service/src/ms365/ms365-errors.ts`, extend the union (add one line):

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
  | "timeout"
  | "graph_error";
```

- [ ] **Step 3b: Rewrite the service**

Replace the body of `service/src/ms365/power-automate-service.ts` with:

```ts
/**
 * PowerAutomateService: trigger a Power Automate flow via its HTTP-request URL. NOT on
 * Microsoft Graph — a flow is invoked like a webhook, so the target URL runs through the same
 * SsrfPolicy the provider HTTP connector uses before it is ever fetched. The trigger awaits the
 * flow's response (bounded body) so the caller sees the flow's feedback, and aborts after the
 * per-flow timeout so a slow/hung flow never holds the request open. Name→flow resolution is
 * enabled-only; disabled/unknown flows resolve to a non-triggerable result the tool layer maps
 * to a typed error.
 */
import type { SsrfPolicy } from "../provider/index.js";
import { Ms365Error } from "./ms365-errors.js";
import type { PowerAutomateStore } from "./power-automate-store.js";

export const MAX_FLOW_BODY_CHARS = 65_536;

export interface PowerAutomateService {
  listFlows(): { readonly name: string }[];
  resolveFlow(name: string): { url: string; timeoutMs: number; enabled: boolean } | null;
  triggerFlow(input: { url: string; payload?: unknown; timeoutMs: number }): Promise<{ status: number; body: string }>;
}

export function createPowerAutomateService(deps: {
  store: PowerAutomateStore;
  ssrf: SsrfPolicy;
  fetchImpl?: typeof fetch;
}): PowerAutomateService {
  const fetchFn = deps.fetchImpl ?? fetch;

  return {
    listFlows() {
      return deps.store.list().filter((f) => f.enabled).map((f) => ({ name: f.name }));
    },

    resolveFlow(name) {
      const flow = deps.store.resolve(name);
      if (flow === null) return null;
      return { url: flow.url, timeoutMs: flow.timeoutMs, enabled: flow.enabled };
    },

    async triggerFlow(input) {
      await deps.ssrf.assertAllowed(input.url);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      let response: Response;
      try {
        response = await fetchFn(input.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.payload ?? {}),
          redirect: "error",
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Ms365Error(
            "timeout",
            `Flow không phản hồi trong ${Math.round(input.timeoutMs / 1000)}s.`,
            "Tăng timeout của flow hoặc để flow trả action Response sớm hơn, rồi thử lại.",
            true,
          );
        }
        throw new Ms365Error("graph_error", "Không gọi được flow.", "Kiểm tra lại URL/flow rồi thử lại.", false);
      } finally {
        clearTimeout(timer);
      }

      const raw = await response.text();
      const body = raw.length > MAX_FLOW_BODY_CHARS ? raw.slice(0, MAX_FLOW_BODY_CHARS) : raw;
      if (!response.ok) {
        throw new Ms365Error(
          "graph_error",
          `Flow trả lỗi HTTP ${response.status}.`,
          "Kiểm tra lại flow/URL rồi thử lại.",
          false,
        );
      }
      return { status: response.status, body };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="listFlows returns only|resolveFlow returns|triggerFlow returns status|triggerFlow throws"`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add service/src/ms365/ms365-errors.ts service/src/ms365/power-automate-service.ts service/tests/ms365-power-automate-service.test.ts
git commit -m "feat(ms365): power-automate trigger awaits bounded feedback with per-flow timeout"
```

---

### Task 3: Tool — trigger by name, refuse disabled, return feedback

**Files:**
- Modify: `service/src/ms365/ms365-tools.ts` (`readTriggerFlowArgs`, `handlePowerAutomateWrite`)
- Modify: `service/src/runtime/ms365-plugin-file.ts:144` (tool arg schema: add optional `name`)
- Test: `service/tests/ms365-power-automate-tool.test.ts` (create)

**Interfaces:**
- Consumes: `PowerAutomateService.resolveFlow`/`triggerFlow` (Task 2), `DEFAULT_FLOW_TIMEOUT_MS` (Task 1), existing `ToolDeps`, `PermissionGate`.
- Produces: `power_automate_trigger_flow` accepts `{ name?: string; url?: string; payload?: unknown }` (needs at least one of name/url); `ToolResult.data = { status, body }`.

- [ ] **Step 1: Write the failing test**

Create `service/tests/ms365-power-automate-tool.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";

function baseDeps(overrides: Partial<ToolDeps>): ToolDeps {
  return {
    // Only the fields these tests touch are real; the rest are never reached because the tool
    // is power_automate_trigger_flow. Cast the whole object to ToolDeps at the end.
    connectionState: () => "connected",
    sessionAllowed: () => true,
    gate: {
      submit: () => {},
      proceed: (_id: string, fn: () => unknown) => ({ performed: true, result: fn() }),
    } as unknown as ToolDeps["gate"],
    wait: async () => "allowed",
    now: () => "2026-07-17T00:00:00.000Z",
    ...overrides,
  } as unknown as ToolDeps;
}

const call = (args: Record<string, unknown>) => ({
  name: "power_automate_trigger_flow" as const,
  args,
  sessionId: "s1",
  requestId: "r1",
});

test("trigger by name resolves + returns flow feedback", async () => {
  let triggered: { url: string; timeoutMs: number } | null = null;
  const deps = baseDeps({
    powerAutomate: {
      listFlows: () => [],
      resolveFlow: (n: string) => (n === "f1" ? { url: "https://x/1?sig=a", timeoutMs: 7000, enabled: true } : null),
      triggerFlow: async (i: { url: string; timeoutMs: number }) => {
        triggered = { url: i.url, timeoutMs: i.timeoutMs };
        return { status: 200, body: "done" };
      },
    } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({ name: "f1", payload: { a: 1 } }));
  assert.deepEqual(res, { ok: true, data: { status: 200, body: "done" } });
  assert.deepEqual(triggered, { url: "https://x/1?sig=a", timeoutMs: 7000 });
});

test("trigger by name refuses a disabled flow (endpoint_blocked), never triggers", async () => {
  let called = false;
  const deps = baseDeps({
    powerAutomate: {
      listFlows: () => [],
      resolveFlow: () => ({ url: "https://x/1?sig=a", timeoutMs: 7000, enabled: false }),
      triggerFlow: async () => {
        called = true;
        return { status: 200, body: "" };
      },
    } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({ name: "f1" }));
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.error.kind, "endpoint_blocked");
  assert.equal(called, false);
});

test("trigger by unknown name → not_found", async () => {
  const deps = baseDeps({
    powerAutomate: {
      listFlows: () => [],
      resolveFlow: () => null,
      triggerFlow: async () => ({ status: 200, body: "" }),
    } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({ name: "nope" }));
  assert.equal(res.ok === false && res.error.kind, "not_found");
});

test("legacy url path still triggers with default timeout", async () => {
  let triggered: { url: string; timeoutMs: number } | null = null;
  const deps = baseDeps({
    powerAutomate: {
      listFlows: () => [],
      resolveFlow: () => null,
      triggerFlow: async (i: { url: string; timeoutMs: number }) => {
        triggered = { url: i.url, timeoutMs: i.timeoutMs };
        return { status: 202, body: "" };
      },
    } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({ url: "https://x/direct?sig=z" }));
  assert.deepEqual(res, { ok: true, data: { status: 202, body: "" } });
  assert.equal(triggered?.timeoutMs, 120_000);
});

test("missing both name and url → invalid", async () => {
  const deps = baseDeps({
    powerAutomate: { listFlows: () => [], resolveFlow: () => null, triggerFlow: async () => ({ status: 200, body: "" }) } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({}));
  assert.equal(res.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="trigger by name resolves|refuses a disabled|unknown name|legacy url path|missing both name"`
Expected: FAIL (current `readTriggerFlowArgs` requires `url`; no name resolution; data shape mismatch).

- [ ] **Step 3a: Update the arg parser**

In `service/src/ms365/ms365-tools.ts`, add the store default import at the top (near other ms365 imports):

```ts
import { DEFAULT_FLOW_TIMEOUT_MS } from "./power-automate-store.js";
```

Replace `TriggerFlowArgs` + `readTriggerFlowArgs` (currently around lines 322-334):

```ts
interface TriggerFlowArgs {
  name?: string;
  url?: string;
  payload?: unknown;
}

/** Validates `power_automate_trigger_flow` args; null when neither `name` nor `url` is a
 * non-empty string. `payload` passes through unchanged (any JSON value is valid). */
function readTriggerFlowArgs(args: Record<string, unknown>): TriggerFlowArgs | null {
  const out: TriggerFlowArgs = {};
  if (nonEmptyString(args.name)) out.name = args.name;
  if (nonEmptyString(args.url)) out.url = args.url;
  if (out.name === undefined && out.url === undefined) return null;
  if (args.payload !== undefined) out.payload = args.payload;
  return out;
}
```

- [ ] **Step 3b: Update the write handler**

Replace `handlePowerAutomateWrite` (currently around lines 648-674) with:

```ts
async function handlePowerAutomateWrite(
  deps: ToolDeps,
  call: ToolCall & { name: "power_automate_trigger_flow" },
): Promise<ToolResult> {
  const input = readTriggerFlowArgs(call.args);
  if (input === null) {
    return invalid("power_automate_trigger_flow cần 'name' hoặc 'url'.");
  }

  let url: string;
  let timeoutMs: number;
  let label: string;
  if (input.name !== undefined) {
    const flow = deps.powerAutomate.resolveFlow(input.name);
    if (flow === null) {
      return {
        ok: false,
        error: {
          kind: "not_found",
          message: `Không tìm thấy flow "${input.name}".`,
          recovery: "Kiểm tra tên hoặc thêm flow trong tab Microsoft 365.",
        },
      };
    }
    if (!flow.enabled) {
      return {
        ok: false,
        error: {
          kind: "endpoint_blocked",
          message: `Flow "${input.name}" đang tắt.`,
          recovery: "Bật flow trong tab Microsoft 365 rồi thử lại.",
        },
      };
    }
    url = flow.url;
    timeoutMs = flow.timeoutMs;
    label = `"${input.name}"`;
  } else {
    url = input.url as string;
    timeoutMs = DEFAULT_FLOW_TIMEOUT_MS;
    label = "(URL trực tiếp)";
  }

  const action: PermissionAction = {
    kind: "ms365_write",
    description: `Kích hoạt Power Automate flow ${label}`,
  };
  deps.gate.submit(
    createPermissionRequest({ requestId: call.requestId, action, now: deps.now() }),
  );
  const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
  if (decision === "denied") {
    return deniedResult("Yêu cầu kích hoạt flow chưa được cho phép.");
  }
  const payloadArg = input.payload !== undefined ? { url, payload: input.payload, timeoutMs } : { url, timeoutMs };
  const outcome = deps.gate.proceed(call.requestId, () => deps.powerAutomate.triggerFlow(payloadArg));
  if (!outcome.performed) {
    return deniedResult("Yêu cầu kích hoạt flow chưa được cho phép.");
  }
  return { ok: true, data: await outcome.result };
}
```

- [ ] **Step 3c: Update the plugin tool schema**

In `service/src/runtime/ms365-plugin-file.ts:144`, replace the `power_automate_trigger_flow` line's `args`:

```ts
    power_automate_trigger_flow: tool({ description: "Trigger a configured Power Automate flow by its `name` (preferred — resolves the URL server-side, refuses disabled flows) or by raw `url`, with an optional JSON payload. Returns the flow's HTTP status and response body. Requires user permission approval.", args: { name: S.string().optional(), url: S.string().optional(), payload: S.unknown().optional() }, async execute(args, ctx) { return call("power_automate_trigger_flow", args, ctx); } }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="trigger by name resolves|refuses a disabled|unknown name|legacy url path|missing both name"`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add service/src/ms365/ms365-tools.ts service/src/runtime/ms365-plugin-file.ts service/tests/ms365-power-automate-tool.test.ts
git commit -m "feat(ms365): trigger power-automate flow by name; refuse disabled; return feedback"
```

---

### Task 4: Router — 5 management routes + wiring

**Files:**
- Modify: `service/src/ms365/ms365-tool-router.ts` (paths, parse helpers, deps, routes)
- Modify: `service/src/composition/compose-service.ts:644-666` (pass `powerAutomateStore` to router deps)
- Test: `service/tests/ms365-power-automate-router.test.ts` (create)

**Interfaces:**
- Consumes: `PowerAutomateStore` (Task 1).
- Produces route path constants: `MS365_FLOWS_PATH = "/v1/ms365/flows"`, `MS365_FLOWS_DELETE_PATH = "/v1/ms365/flows/delete"`, `MS365_FLOWS_TOGGLE_PATH = "/v1/ms365/flows/toggle"`, `MS365_FLOWS_TIMEOUT_PATH = "/v1/ms365/flows/timeout"`. All list responses shaped `{ flows: { name: string; enabled: boolean; timeoutMs: number }[] }` (no `url`). `Ms365RouterDeps` gains `readonly powerAutomateStore: PowerAutomateStore`.

- [ ] **Step 1: Write the failing test**

Create `service/tests/ms365-power-automate-router.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMs365Router,
  MS365_FLOWS_PATH,
  MS365_FLOWS_DELETE_PATH,
  MS365_FLOWS_TOGGLE_PATH,
  MS365_FLOWS_TIMEOUT_PATH,
} from "../src/ms365/ms365-tool-router.js";
import { createPowerAutomateStore } from "../src/ms365/power-automate-store.js";

async function routerWithStore() {
  const store = await createPowerAutomateStore({ persistence: { load: async () => [], save: async () => {} } });
  const router = createMs365Router({
    powerAutomateStore: store,
    // Unused-by-these-tests deps; cast the whole deps object.
  } as unknown as Parameters<typeof createMs365Router>[0]);
  const find = (method: string, path: string) => {
    const r = router.routes.find((x) => x.method === method && x.path === path);
    assert.ok(r, `route ${method} ${path} missing`);
    return r!;
  };
  return { store, find };
}

test("GET /flows returns list without url", async () => {
  const { store, find } = await routerWithStore();
  await store.add({ name: "f1", url: "https://x/1?sig=secret", timeoutMs: 5000 });
  const res = await find("GET", MS365_FLOWS_PATH).handler({ body: undefined } as never);
  assert.deepEqual(res.data, { flows: [{ name: "f1", enabled: true, timeoutMs: 5000 }] });
  assert.equal(JSON.stringify(res.data).includes("sig=secret"), false);
});

test("POST /flows adds; duplicate name → 400", async () => {
  const { find } = await routerWithStore();
  const add = find("POST", MS365_FLOWS_PATH).handler;
  const res = await add({ body: { name: "f1", url: "https://x/1?sig=a", timeoutMs: 3000 } } as never);
  assert.deepEqual(res.data, { flows: [{ name: "f1", enabled: true, timeoutMs: 3000 }] });
  await assert.rejects(() => add({ body: { name: "f1", url: "https://x/2?sig=b" } } as never));
});

test("toggle + timeout + delete", async () => {
  const { store, find } = await routerWithStore();
  await store.add({ name: "f1", url: "https://x/1?sig=a", timeoutMs: 3000 });
  await find("POST", MS365_FLOWS_TOGGLE_PATH).handler({ body: { name: "f1", enabled: false } } as never);
  assert.equal(store.resolve("f1")?.enabled, false);
  await find("POST", MS365_FLOWS_TIMEOUT_PATH).handler({ body: { name: "f1", timeoutMs: 8000 } } as never);
  assert.equal(store.resolve("f1")?.timeoutMs, 8000);
  const res = await find("POST", MS365_FLOWS_DELETE_PATH).handler({ body: { name: "f1" } } as never);
  assert.deepEqual(res.data, { flows: [] });
});

test("bad body → 400", async () => {
  const { find } = await routerWithStore();
  await assert.rejects(() => find("POST", MS365_FLOWS_PATH).handler({ body: { name: "f1" } } as never));
  await assert.rejects(() => find("POST", MS365_FLOWS_TOGGLE_PATH).handler({ body: { name: "f1" } } as never));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="GET /flows returns|POST /flows adds|toggle \\+ timeout|bad body"`
Expected: FAIL (path exports + `powerAutomateStore` dep + routes not defined).

- [ ] **Step 3a: Add imports, path constants, and deps field**

In `service/src/ms365/ms365-tool-router.ts`:

Add to imports:

```ts
import type { PowerAutomateStore } from "./power-automate-store.js";
```

Add path constants after `MS365_SESSION_SCOPE_PATH` (line 34):

```ts
export const MS365_FLOWS_PATH = "/v1/ms365/flows";
export const MS365_FLOWS_DELETE_PATH = "/v1/ms365/flows/delete";
export const MS365_FLOWS_TOGGLE_PATH = "/v1/ms365/flows/toggle";
export const MS365_FLOWS_TIMEOUT_PATH = "/v1/ms365/flows/timeout";
```

Add to `Ms365RouterDeps` (after `sessionScope`, line 174):

```ts
  readonly powerAutomateStore: PowerAutomateStore;
```

- [ ] **Step 3b: Add parse helpers + public mapper**

Add near the other `parse*` helpers (after `parseWriteModeBody`, ~line 166):

```ts
interface PublicFlow {
  name: string;
  enabled: boolean;
  timeoutMs: number;
}

function publicFlows(store: PowerAutomateStore): PublicFlow[] {
  return store.list().map((f) => ({ name: f.name, enabled: f.enabled, timeoutMs: f.timeoutMs }));
}

function parseAddFlowBody(body: unknown): { name: string; url: string; timeoutMs?: number } {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.name)) throw new Ms365RouterRequestError("name is required.");
  if (!nonEmptyString(record.url)) throw new Ms365RouterRequestError("url is required.");
  const out: { name: string; url: string; timeoutMs?: number } = { name: record.name, url: record.url };
  if (typeof record.timeoutMs === "number") out.timeoutMs = record.timeoutMs;
  return out;
}

function parseFlowNameBody(body: unknown): { name: string } {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.name)) throw new Ms365RouterRequestError("name is required.");
  return { name: record.name };
}

function parseFlowToggleBody(body: unknown): { name: string; enabled: boolean } {
  const { name } = parseFlowNameBody(body);
  const enabled = (body as Record<string, unknown>).enabled;
  if (typeof enabled !== "boolean") throw new Ms365RouterRequestError("enabled must be a boolean.");
  return { name, enabled };
}

function parseFlowTimeoutBody(body: unknown): { name: string; timeoutMs: number } {
  const { name } = parseFlowNameBody(body);
  const timeoutMs = (body as Record<string, unknown>).timeoutMs;
  if (typeof timeoutMs !== "number") throw new Ms365RouterRequestError("timeoutMs must be a number.");
  return { name, timeoutMs };
}
```

- [ ] **Step 3c: Add the 5 routes**

In the `routes` array (after the `MS365_WRITE_MODE_PATH` POST route, ~line 279), add:

```ts
      {
        method: "GET",
        path: MS365_FLOWS_PATH,
        handler: (): RouteResult<{ flows: PublicFlow[] }> => ({
          status: 200,
          data: { flows: publicFlows(deps.powerAutomateStore) },
        }),
      },
      {
        method: "POST",
        path: MS365_FLOWS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name, url, timeoutMs } = parseAddFlowBody(ctx.body);
          if (deps.powerAutomateStore.resolve(name) !== null) {
            throw new Ms365RouterRequestError("A flow with this name already exists.");
          }
          await deps.powerAutomateStore.add({ name, url, timeoutMs: timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS });
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
      {
        method: "POST",
        path: MS365_FLOWS_DELETE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name } = parseFlowNameBody(ctx.body);
          await deps.powerAutomateStore.remove(name);
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
      {
        method: "POST",
        path: MS365_FLOWS_TOGGLE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name, enabled } = parseFlowToggleBody(ctx.body);
          await deps.powerAutomateStore.setEnabled(name, enabled);
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
      {
        method: "POST",
        path: MS365_FLOWS_TIMEOUT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name, timeoutMs } = parseFlowTimeoutBody(ctx.body);
          await deps.powerAutomateStore.setTimeout(name, timeoutMs);
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
```

Add the `DEFAULT_FLOW_TIMEOUT_MS` import to the top of the router file:

```ts
import { DEFAULT_FLOW_TIMEOUT_MS, type PowerAutomateStore } from "./power-automate-store.js";
```

(Replace the `import type { PowerAutomateStore }` line added in Step 3a with this combined import.)

- [ ] **Step 3d: Wire the store into router deps**

In `service/src/composition/compose-service.ts`, in the `createMs365Router({ ... })` call (line 644), add `powerAutomateStore` alongside `sessionScope`:

```ts
    return createMs365Router({
      connector: ms365Connector,
      scopes: MS365_SCOPES,
      siteScope,
      writeMode: writeModeStore,
      sessionScope,
      powerAutomateStore,
      tools: {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="GET /flows returns|POST /flows adds|toggle \\+ timeout|bad body"`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add service/src/ms365/ms365-tool-router.ts service/src/composition/compose-service.ts service/tests/ms365-power-automate-router.test.ts
git commit -m "feat(ms365): add flow-management routes (list/add/delete/toggle/timeout)"
```

---

### Task 5: Service-client — flow management methods

**Files:**
- Modify: `app/ui/src/service-client.ts` (type + interface + impl)
- Test: `app/ui/tests/ms365-flows-service-client.test.ts` (create)

**Interfaces:**
- Produces on `ServiceClient`:
  - `interface Ms365FlowView { readonly name: string; readonly enabled: boolean; readonly timeoutMs: number }`
  - `listMs365Flows(): Promise<readonly Ms365FlowView[]>`
  - `addMs365Flow(name: string, url: string, timeoutMs?: number): Promise<readonly Ms365FlowView[]>`
  - `deleteMs365Flow(name: string): Promise<readonly Ms365FlowView[]>`
  - `setMs365FlowEnabled(name: string, enabled: boolean): Promise<readonly Ms365FlowView[]>`
  - `setMs365FlowTimeout(name: string, timeoutMs: number): Promise<readonly Ms365FlowView[]>`

- [ ] **Step 1: Write the failing test**

Create `app/ui/tests/ms365-flows-service-client.test.ts` (mirror the fetch-stub pattern already used in `app/ui/tests/ms365-service-client.test.ts` — open that file first to copy its exact `createServiceClient` + global `fetch` stub setup):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServiceClient } from "../src/service-client.js";

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; json: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const { status, json } = handler(url, init);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return calls;
}

test("addMs365Flow POSTs name/url/timeout and returns flows", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [{ name: "f1", enabled: true, timeoutMs: 3000 }] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  const flows = await client.addMs365Flow("f1", "https://x/1?sig=a", 3000);
  assert.deepEqual(flows, [{ name: "f1", enabled: true, timeoutMs: 3000 }]);
  const last = calls.at(-1)!;
  assert.ok(last.url.endsWith("/v1/ms365/flows"));
  assert.equal(last.init?.method, "POST");
  assert.deepEqual(JSON.parse(last.init!.body as string), { name: "f1", url: "https://x/1?sig=a", timeoutMs: 3000 });
});

test("listMs365Flows GETs and unwraps .flows", async () => {
  stubFetch(() => ({ status: 200, json: { flows: [{ name: "f1", enabled: false, timeoutMs: 5000 }] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  const flows = await client.listMs365Flows();
  assert.deepEqual(flows, [{ name: "f1", enabled: false, timeoutMs: 5000 }]);
});

test("toggle/timeout/delete hit the right paths", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  await client.setMs365FlowEnabled("f1", false);
  await client.setMs365FlowTimeout("f1", 9000);
  await client.deleteMs365Flow("f1");
  assert.ok(calls[0]!.url.endsWith("/v1/ms365/flows/toggle"));
  assert.ok(calls[1]!.url.endsWith("/v1/ms365/flows/timeout"));
  assert.ok(calls[2]!.url.endsWith("/v1/ms365/flows/delete"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="addMs365Flow POSTs|listMs365Flows GETs|toggle/timeout/delete hit"`
Expected: FAIL (methods not defined on client).

- [ ] **Step 3a: Add the type + interface members**

In `app/ui/src/service-client.ts`, add the type next to `Ms365SiteView` (~line 445):

```ts
/** A configured Power Automate flow, without its secret trigger URL. */
export interface Ms365FlowView {
  readonly name: string;
  readonly enabled: boolean;
  readonly timeoutMs: number;
}
```

Add to the `ServiceClient` interface (next to `setMs365SiteEnabled`, ~line 743):

```ts
  /** List configured Power Automate flows (no URL — that is a server-side secret). */
  listMs365Flows(): Promise<readonly Ms365FlowView[]>;
  /** Add a custom flow (name + HTTP-trigger URL + optional timeout ms); returns refreshed list. */
  addMs365Flow(name: string, url: string, timeoutMs?: number): Promise<readonly Ms365FlowView[]>;
  /** Delete a flow by name; returns refreshed list. */
  deleteMs365Flow(name: string): Promise<readonly Ms365FlowView[]>;
  /** Enable/disable a flow; returns refreshed list. */
  setMs365FlowEnabled(name: string, enabled: boolean): Promise<readonly Ms365FlowView[]>;
  /** Set a flow's per-trigger timeout (ms); returns refreshed list. */
  setMs365FlowTimeout(name: string, timeoutMs: number): Promise<readonly Ms365FlowView[]>;
```

- [ ] **Step 3b: Add the implementations**

In the returned client object (next to `setMs365SiteEnabled`, ~line 1289):

```ts
    listMs365Flows: async () =>
      (await call<{ flows: readonly Ms365FlowView[] }>("/v1/ms365/flows")).flows,

    addMs365Flow: async (name, url, timeoutMs) =>
      (
        await call<{ flows: readonly Ms365FlowView[] }>("/v1/ms365/flows", {
          method: "POST",
          body: JSON.stringify(timeoutMs !== undefined ? { name, url, timeoutMs } : { name, url }),
        })
      ).flows,

    deleteMs365Flow: async (name) =>
      (
        await call<{ flows: readonly Ms365FlowView[] }>("/v1/ms365/flows/delete", {
          method: "POST",
          body: JSON.stringify({ name }),
        })
      ).flows,

    setMs365FlowEnabled: async (name, enabled) =>
      (
        await call<{ flows: readonly Ms365FlowView[] }>("/v1/ms365/flows/toggle", {
          method: "POST",
          body: JSON.stringify({ name, enabled }),
        })
      ).flows,

    setMs365FlowTimeout: async (name, timeoutMs) =>
      (
        await call<{ flows: readonly Ms365FlowView[] }>("/v1/ms365/flows/timeout", {
          method: "POST",
          body: JSON.stringify({ name, timeoutMs }),
        })
      ).flows,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="addMs365Flow POSTs|listMs365Flows GETs|toggle/timeout/delete hit"`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add app/ui/src/service-client.ts app/ui/tests/ms365-flows-service-client.test.ts
git commit -m "feat(ms365): service-client methods for flow management"
```

---

### Task 6: UI — Power Automate management section

**Files:**
- Modify: `app/ui/src/ui-shell/microsoft/ms-connect-view.ts` (`Ms365ConnectClient` interface + `renderConnectedSummary` + new `renderPowerAutomateSection`)
- Modify: `app/ui/src/styles/*` — reuse existing `ms-sites`/`ms-section-label` classes; no new CSS required (verify by reading the site-scope styles; add minimal rules only if the list looks unstyled).
- Test: `app/ui/tests/ms-power-automate-section.test.ts` (create)

**Interfaces:**
- Consumes: `Ms365FlowView` + 5 client methods (Task 5).
- Produces: `renderPowerAutomateSection(deps): HTMLElement`, appended inside `renderConnectedSummary`. `Ms365ConnectClient` gains the 5 flow methods.

- [ ] **Step 1: Write the failing test**

Create `app/ui/tests/ms-power-automate-section.test.ts` (mirror `app/ui/tests/ms-connect-view.test.ts` — open it first for the exact JSDOM/`renderMsConnect` harness, connected `Ms365ViewData` fixture, and how it stubs `Ms365ConnectClient`):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
// NOTE: copy the JSDOM setup + connectedView fixture + baseClient stub from
// app/ui/tests/ms-connect-view.test.ts; extend baseClient with the 5 flow methods.
import { renderMsConnect } from "../src/ui-shell/microsoft/ms-connect-view.js";

// ... (JSDOM `document`, `connectedView`, and `baseClient` per ms-connect-view.test.ts) ...

test("renders configured flows with toggle + delete", async () => {
  const container = document.createElement("div");
  const client = {
    ...baseClient,
    listMs365Flows: async () => [{ name: "f1", enabled: true, timeoutMs: 5000 }],
  };
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0)); // let listMs365Flows resolve
  assert.match(container.textContent ?? "", /Power Automate/);
  assert.match(container.textContent ?? "", /f1/);
});

test("add form calls addMs365Flow with name/url/timeout seconds→ms", async () => {
  const container = document.createElement("div");
  const added: unknown[] = [];
  const client = {
    ...baseClient,
    listMs365Flows: async () => [],
    addMs365Flow: async (name: string, url: string, timeoutMs?: number) => {
      added.push({ name, url, timeoutMs });
      return [{ name, url: "", enabled: true, timeoutMs: timeoutMs ?? 0 }] as never;
    },
  };
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  (container.querySelector(".ms-flows__name-input") as HTMLInputElement).value = "f2";
  (container.querySelector(".ms-flows__url-input") as HTMLInputElement).value = "https://x/2?sig=b";
  (container.querySelector(".ms-flows__timeout-input") as HTMLInputElement).value = "30";
  (container.querySelector(".ms-flows__add") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(added, [{ name: "f2", url: "https://x/2?sig=b", timeoutMs: 30_000 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="renders configured flows|add form calls addMs365Flow"`
Expected: FAIL (`listMs365Flows` not on client interface / section not rendered).

- [ ] **Step 3a: Extend the client interface**

In `app/ui/src/ui-shell/microsoft/ms-connect-view.ts`, import the flow type and extend `Ms365ConnectClient` (lines 1-23):

```ts
import type {
  Ms365ViewData,
  Ms365DeviceBeginResult,
  Ms365DevicePollResult,
  Ms365SiteView,
  Ms365FlowView,
} from "../../service-client.js";
```

Add to `Ms365ConnectClient` (after `setMs365SiteEnabled`, line 22):

```ts
  listMs365Flows(): Promise<readonly Ms365FlowView[]>;
  addMs365Flow(name: string, url: string, timeoutMs?: number): Promise<readonly Ms365FlowView[]>;
  deleteMs365Flow(name: string): Promise<readonly Ms365FlowView[]>;
  setMs365FlowEnabled(name: string, enabled: boolean): Promise<readonly Ms365FlowView[]>;
  setMs365FlowTimeout(name: string, timeoutMs: number): Promise<readonly Ms365FlowView[]>;
```

- [ ] **Step 3b: Append the section in `renderConnectedSummary`**

In `renderConnectedSummary`, after `card.append(renderSiteScopeSection(deps));` (line 298):

```ts
  card.append(renderPowerAutomateSection(deps));
```

- [ ] **Step 3c: Add `renderPowerAutomateSection`**

Add at the end of the file (mirror `renderSiteScopeSection`):

```ts
/**
 * "Power Automate (tùy chỉnh)" — manage custom flow triggers: list (name + enable toggle +
 * per-flow timeout + delete) and an add form (name + HTTP-trigger URL + timeout seconds). The
 * flow URL is a bearer secret and is NEVER rendered back — the list carries only name/enabled/
 * timeoutMs. Loads on mount via `listMs365Flows()` and re-renders in place from each mutating
 * call's refreshed list.
 */
function renderPowerAutomateSection(deps: RenderMsConnectDeps): HTMLElement {
  const wrap = el("div", "ms-flows");
  wrap.append(el("h3", "ms-section-label", "Power Automate (tùy chỉnh)"));

  const list = el("div", "ms-flows__list");
  const status = el("p", "ms-flows__status", "Đang tải danh sách flow…");
  wrap.append(status, list);

  const paint = (flows: readonly Ms365FlowView[]): void => {
    status.hidden = true;
    list.replaceChildren();
    if (flows.length === 0) {
      status.textContent = "Chưa có flow nào — thêm bên dưới.";
      status.hidden = false;
      return;
    }
    for (const flow of flows) list.append(renderFlowRow(deps, flow, paint));
  };

  void deps.client
    .listMs365Flows()
    .then(paint)
    .catch(() => {
      status.textContent = "Không thể tải danh sách flow, thử lại sau.";
    });

  wrap.append(renderFlowAddForm(deps, paint));
  return wrap;
}

function renderFlowRow(
  deps: RenderMsConnectDeps,
  flow: Ms365FlowView,
  onRefresh: (flows: readonly Ms365FlowView[]) => void,
): HTMLElement {
  const row = el("div", "ms-flows__row");
  row.append(el("span", "ms-flows__name", flow.name));

  const toggle = el("input", "ms-flows__toggle") as HTMLInputElement;
  toggle.type = "checkbox";
  toggle.checked = flow.enabled;
  toggle.setAttribute("aria-label", `Bật/tắt ${flow.name}`);
  toggle.addEventListener("change", () => {
    const next = toggle.checked;
    toggle.disabled = true;
    void deps.client
      .setMs365FlowEnabled(flow.name, next)
      .then(onRefresh)
      .catch(() => {
        toggle.checked = !next;
        toggle.disabled = false;
      });
  });

  const timeout = el("input", "ms-flows__timeout") as HTMLInputElement;
  timeout.type = "number";
  timeout.min = "1";
  timeout.value = String(Math.round(flow.timeoutMs / 1000));
  timeout.setAttribute("aria-label", `Timeout (giây) cho ${flow.name}`);
  const commitTimeout = (): void => {
    const secs = Number.parseInt(timeout.value, 10);
    if (!Number.isFinite(secs) || secs < 1) {
      timeout.value = String(Math.round(flow.timeoutMs / 1000));
      return;
    }
    void deps.client.setMs365FlowTimeout(flow.name, secs * 1000).then(onRefresh).catch(() => {});
  };
  timeout.addEventListener("change", commitTimeout);

  const del = el("button", "ms-flows__delete", "Xóa") as HTMLButtonElement;
  del.type = "button";
  del.addEventListener("click", () => {
    del.disabled = true;
    void deps.client.deleteMs365Flow(flow.name).then(onRefresh).catch(() => {
      del.disabled = false;
    });
  });

  row.append(toggle, el("span", "ms-flows__timeout-label", "giây:"), timeout, del);
  return row;
}

function renderFlowAddForm(
  deps: RenderMsConnectDeps,
  onRefresh: (flows: readonly Ms365FlowView[]) => void,
): HTMLElement {
  const form = el("div", "ms-flows__add-form");

  const nameInput = el("input", "ms-flows__name-input") as HTMLInputElement;
  nameInput.type = "text";
  nameInput.placeholder = "Tên flow";
  nameInput.autocomplete = "off";

  const urlInput = el("input", "ms-flows__url-input") as HTMLInputElement;
  urlInput.type = "text";
  urlInput.placeholder = "URL HTTP-trigger của flow";
  urlInput.autocomplete = "off";
  urlInput.spellcheck = false;

  const timeoutInput = el("input", "ms-flows__timeout-input") as HTMLInputElement;
  timeoutInput.type = "number";
  timeoutInput.min = "1";
  timeoutInput.placeholder = "Timeout (giây)";
  timeoutInput.value = "120";

  const add = el("button", "ms-flows__add", "Thêm flow") as HTMLButtonElement;
  add.type = "button";
  const errorSlot = el("p", "ms-flows__add-error", "");
  errorSlot.hidden = true;

  add.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    if (name.length === 0 || url.length === 0) {
      errorSlot.textContent = "Cần nhập cả tên và URL.";
      errorSlot.hidden = false;
      return;
    }
    const secs = Number.parseInt(timeoutInput.value, 10);
    const timeoutMs = Number.isFinite(secs) && secs >= 1 ? secs * 1000 : undefined;
    add.disabled = true;
    errorSlot.hidden = true;
    void deps.client
      .addMs365Flow(name, url, timeoutMs)
      .then((flows) => {
        nameInput.value = "";
        urlInput.value = "";
        timeoutInput.value = "120";
        onRefresh(flows);
      })
      .catch(() => {
        errorSlot.textContent = "Không thêm được flow (trùng tên hoặc lỗi). Thử lại.";
        errorSlot.hidden = false;
      })
      .finally(() => {
        add.disabled = false;
      });
  });

  form.append(nameInput, urlInput, timeoutInput, add, errorSlot);
  return form;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="renders configured flows|add form calls addMs365Flow"`
Expected: PASS (2 tests).

- [ ] **Step 5: Full check + commit**

```bash
npm run typecheck
npm test
git add app/ui/src/ui-shell/microsoft/ms-connect-view.ts app/ui/tests/ms-power-automate-section.test.ts
git commit -m "feat(ms365): Power Automate flow management section in connected view"
```

- [ ] **Step 6: Build + visual check**

```bash
npm run build:app
```

Then run the app (see the `run` skill) and, on the connected MS365 tab, confirm: the "Power Automate (tùy chỉnh)" section renders under the SharePoint scope section; add a flow (name + URL + timeout) → it appears with an enable toggle + timeout box + Xóa button; toggle/delete/timeout persist across a tab reload (backed by `.runtime/ms365-power-automate.json`). Note: this is the packaged-acceptance step per CLAUDE.md — the URL must never appear anywhere in the rendered DOM.

---

## Self-Review

**Spec coverage:**
- Data model (`enabled`+`timeoutMs`, backward-compat) → Task 1. ✅
- 4→5 backend routes (list/add/delete/toggle/timeout) → Task 4. ✅
- Trigger feedback + timeout (AbortController, bounded body) → Task 2. ✅
- Enable/disable enforcement + trigger-by-name → Task 3. ✅
- URL secret never to renderer → Task 2 (`resolveFlow`/`listFlows` server-side), Task 4 (`publicFlows` omits url, test asserts), Task 6 (list carries no url). ✅
- Service-client 5 methods → Task 5. ✅
- UI section in `renderConnectedSummary` → Task 6. ✅
- Testing per layer → each task. ✅
- New `Ms365Error` kind `"timeout"` (spec §13 note) → Task 2 Step 3a. ✅

**Placeholder scan:** No TBD/TODO; every code step has full code. Task 5/6 tests intentionally reference "copy the harness from `<existing test>`" — this points to a concrete existing file to mirror, not a vague placeholder; the new-behavior assertions are written out in full.

**Type consistency:**
- `PowerAutomateFlow { name, url, enabled, timeoutMs }` used identically across Tasks 1–4. ✅
- `PowerAutomateService.resolveFlow` returns `{ url, timeoutMs, enabled }` — consumed with those exact keys in Task 3. ✅
- Route list shape `{ flows: { name, enabled, timeoutMs }[] }` (`PublicFlow`) matches `Ms365FlowView` in Task 5/6. ✅
- `triggerFlow({ url, payload?, timeoutMs })` signature consistent Task 2 ↔ Task 3. ✅
- `DEFAULT_FLOW_TIMEOUT_MS` defined in Task 1, imported in Tasks 3 and 4. ✅
- UI converts seconds↔ms consistently (`* 1000` on write, `/ 1000` on display). ✅

**Note for implementer:** `ctx.body` is already-parsed JSON in this router (see existing handlers using `ctx.body` directly). Route handler test calls pass `{ body: <object> }`; the real boundary dispatcher supplies the same shape.
