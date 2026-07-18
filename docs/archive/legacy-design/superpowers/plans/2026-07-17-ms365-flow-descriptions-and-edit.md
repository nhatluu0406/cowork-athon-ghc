# MS365 Flow Descriptions + Edit + Dialog UI + Payload Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add per-flow `description` + `payloadSchema` (so the Agent knows when to use a flow and what JSON to send), the ability to edit a flow, and a dialog-based management UI (read-only list + enable/disable + add/edit/delete).

**Architecture:** Extends the existing Power Automate flow feature. `description` and `payloadSchema` (a user-pasted JSON Schema text) thread store→service→tool→router→service-client→UI. `power_automate_list_flows` returns `{ name, description, payloadSchema }` so the Agent builds a conformant payload and triggers by name. Editing is an `update` op (name immutable; blank URL keeps the stored secret URL). Add/edit use a modal dialog mirroring `permission-modal.ts`.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), `node --test` via tsx (run new files directly: `npx tsx --test <path>`), `tsc -b`, DOM-only renderer.

## Global Constraints

- **URL flow = bearer secret** — never in any route response, client type, or DOM. Edit dialog NEVER pre-fills URL; blank URL on update keeps the stored URL. `PublicFlow`/`Ms365FlowView` carry `{ name, enabled, timeoutMs, description, payloadSchema }` — no `url`.
- **`description` and `payloadSchema` are NOT secret** — shown in UI and returned to the Agent via `power_automate_list_flows`. `payloadSchema` is a JSON Schema text the Agent reads to build the trigger payload; the server does NOT validate payload-vs-schema at trigger time (guidance only).
- **`payloadSchema` validation**: on add/update the router validates the text is empty OR parseable JSON (`JSON.parse` succeeds) → invalid → 400. The dialog validates the same before submit.
- **Backward-compat**: existing `.runtime/ms365-power-automate.json` entries load with `description=""` and `payloadSchema=""`.
- **Edit**: name is immutable (read-only in edit dialog). Delete is immediate (no confirm).
- `DEFAULT_FLOW_TIMEOUT_MS`/`MIN`/`MAX`/`clampTimeout` already exist — reuse.
- ESM `.js` imports. TDD: RED then GREEN. Do not touch `package-lock.json`. Run tests in the foreground.

---

### Task 1 — DONE (store: `description` + `update`)
Commit 36cfd87. Store has `description`; `add({name,url,description,timeoutMs})`; `update(name,{description,timeoutMs,url?})`.

### Task 2 — DONE (service/tool: `description` in `list_flows`)
Commit 7ff328f. `listFlows()` returns `{name,description}` enabled-only; tool description updated.

---

### Task 3: Backfill `payloadSchema` into store + service + tool

**Files:**
- Modify: `service/src/ms365/power-automate-store.ts`
- Modify: `service/src/ms365/power-automate-service.ts`
- Modify: `service/src/runtime/ms365-plugin-file.ts`
- Test: `service/tests/ms365-power-automate-store.test.ts`, `service/tests/ms365-power-automate-service.test.ts` (extend)

**Interfaces:**
- Produces: `PowerAutomateFlow` gains `readonly payloadSchema: string`. `add(flow: { name; url; description; timeoutMs; payloadSchema })`. `update(name, { description; timeoutMs; payloadSchema; url? })`. `PowerAutomateService.listFlows(): { name; description; payloadSchema }[]`.

- [ ] **Step 1: Failing tests**

Append to `service/tests/ms365-power-automate-store.test.ts`:
```ts
test("payloadSchema: legacy default, add stores, update replaces", async () => {
  const legacy = [{ name: "old", url: "https://x/y?sig=a", enabled: true, timeoutMs: 5000, description: "d" }] as unknown as PowerAutomateFlow[];
  const store = await createPowerAutomateStore({ persistence: { load: async () => legacy, save: async () => {} } });
  assert.equal(store.list()[0]!.payloadSchema, "");
  await store.add({ name: "f1", url: "https://x/1?sig=a", description: "d", timeoutMs: 5000, payloadSchema: '{"type":"object"}' });
  assert.equal(store.resolve("f1")?.payloadSchema, '{"type":"object"}');
  await store.update("f1", { description: "d", timeoutMs: 5000, payloadSchema: '{"type":"string"}' });
  assert.equal(store.resolve("f1")?.payloadSchema, '{"type":"string"}');
});
```
Append to `service/tests/ms365-power-automate-service.test.ts`:
```ts
test("listFlows returns payloadSchema", async () => {
  const store = await storeWith([{ name: "on", url: "https://x/1?sig=a", enabled: true, timeoutMs: 5000, description: "d", payloadSchema: '{"type":"object"}' }]);
  const svc = createPowerAutomateService({ store, ssrf: allowAll });
  assert.deepEqual(svc.listFlows(), [{ name: "on", description: "d", payloadSchema: '{"type":"object"}' }]);
});
```
Also update the existing store/service fixtures + `add`/`update` calls to include `payloadSchema` (additive; use `""` or a value) so the files typecheck.

- [ ] **Step 2: Run to verify FAIL** — `npx tsx --test service/tests/ms365-power-automate-store.test.ts service/tests/ms365-power-automate-service.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`power-automate-store.ts`: add `readonly payloadSchema: string;` to `PowerAutomateFlow`. In `normalize`, add:
```ts
    payloadSchema: typeof (f as { payloadSchema?: unknown }).payloadSchema === "string" ? (f as { payloadSchema: string }).payloadSchema : "",
```
Change `add` interface + impl to include `payloadSchema` (mirror `description`):
```ts
  add(flow: { name: string; url: string; description: string; timeoutMs: number; payloadSchema: string }): Promise<void>;
```
```ts
    async add(flow) {
      if (current.some((f) => f.name === flow.name)) throw new Error(`A flow named "${flow.name}" already exists.`);
      await commit([...current, { name: flow.name, url: flow.url, enabled: true, timeoutMs: clampTimeout(flow.timeoutMs), description: flow.description, payloadSchema: flow.payloadSchema }]);
    },
```
Change `update` interface + impl to carry `payloadSchema`:
```ts
  update(name: string, fields: { description: string; timeoutMs: number; payloadSchema: string; url?: string }): Promise<void>;
```
```ts
    async update(name, fields) {
      if (!current.some((f) => f.name === name)) throw new Error(`No flow named "${name}".`);
      await commit(current.map((f) =>
        f.name === name
          ? { ...f, description: fields.description, timeoutMs: clampTimeout(fields.timeoutMs), payloadSchema: fields.payloadSchema, url: fields.url !== undefined && fields.url.length > 0 ? fields.url : f.url }
          : f,
      ));
    },
```

`power-automate-service.ts`: change `listFlows` return type + impl:
```ts
  listFlows(): { readonly name: string; readonly description: string; readonly payloadSchema: string }[];
```
```ts
    listFlows() {
      return deps.store.list().filter((f) => f.enabled).map((f) => ({ name: f.name, description: f.description, payloadSchema: f.payloadSchema }));
    },
```

`ms365-plugin-file.ts`: update the `power_automate_list_flows` description:
```ts
    power_automate_list_flows: tool({ description: "List configured Power Automate flows (name + description + payloadSchema). Read each description to decide when to call a flow, and read its payloadSchema (a JSON Schema) to build a conformant payload from the user's request, then call power_automate_trigger_flow by name with that payload.", args: {}, async execute(args, ctx) { return call("power_automate_list_flows", args, ctx); } }),
```

- [ ] **Step 4: Run to verify PASS** — both test files pass.

- [ ] **Step 5: Typecheck + commit** — `npm run typecheck` (the router add/update caller may still show a break — it's fixed in Task 4; note it).
```bash
git add service/src/ms365/power-automate-store.ts service/src/ms365/power-automate-service.ts service/src/runtime/ms365-plugin-file.ts service/tests/ms365-power-automate-store.test.ts service/tests/ms365-power-automate-service.test.ts
git commit -m "feat(ms365): flow payloadSchema in store/service; list_flows returns it"
```

---

### Task 4: Router — `description` + `payloadSchema` + `update` route

**Files:**
- Modify: `service/src/ms365/ms365-tool-router.ts`
- Test: `service/tests/ms365-power-automate-router.test.ts` (extend)

**Interfaces:**
- Produces: `MS365_FLOWS_UPDATE_PATH = "/v1/ms365/flows/update"`; `PublicFlow` = `{ name, enabled, timeoutMs, description, payloadSchema }` (no url); add body accepts `description?` + `payloadSchema?`; update body `{ name, description, timeoutMs, payloadSchema, url? }`. Invalid (non-empty, non-JSON) `payloadSchema` → 400.

- [ ] **Step 1: Failing tests** — append to `service/tests/ms365-power-automate-router.test.ts`:
```ts
import { MS365_FLOWS_UPDATE_PATH } from "../src/ms365/ms365-tool-router.js"; // add to existing import

test("GET /flows returns description + payloadSchema, never url", async () => {
  const { store, find } = await routerWithStore();
  await store.add({ name: "f1", url: "https://x/1?sig=secret", description: "d1", timeoutMs: 5000, payloadSchema: '{"type":"object"}' });
  const res = await find("GET", MS365_FLOWS_PATH).handler({ body: undefined } as never);
  assert.deepEqual(res.data, { flows: [{ name: "f1", enabled: true, timeoutMs: 5000, description: "d1", payloadSchema: '{"type":"object"}' }] });
  assert.equal(JSON.stringify(res.data).includes("sig=secret"), false);
});

test("POST /flows rejects invalid payloadSchema JSON with 400", async () => {
  const { find } = await routerWithStore();
  await assert.rejects(() => find("POST", MS365_FLOWS_PATH).handler({ body: { name: "f1", url: "https://x/1?sig=a", payloadSchema: "{not json" } } as never));
});

test("POST /flows/update updates desc/timeout/schema; keeps url when blank; unknown → 400", async () => {
  const { store, find } = await routerWithStore();
  await store.add({ name: "f1", url: "https://x/1?sig=a", description: "d", timeoutMs: 5000, payloadSchema: "" });
  const upd = find("POST", MS365_FLOWS_UPDATE_PATH).handler;
  await upd({ body: { name: "f1", description: "d2", timeoutMs: 8000, payloadSchema: '{"type":"string"}' } } as never);
  assert.equal(store.resolve("f1")?.description, "d2");
  assert.equal(store.resolve("f1")?.payloadSchema, '{"type":"string"}');
  assert.equal(store.resolve("f1")?.url, "https://x/1?sig=a");
  await upd({ body: { name: "f1", description: "d3", timeoutMs: 8000, payloadSchema: "", url: "https://x/2?sig=b" } } as never);
  assert.equal(store.resolve("f1")?.url, "https://x/2?sig=b");
  await assert.rejects(() => upd({ body: { name: "ghost", description: "x", timeoutMs: 8000, payloadSchema: "" } } as never));
});
```
Also update the existing `POST /flows adds`, `toggle + timeout`, and any GET-shape assertions to include `description` + `payloadSchema` in the expected `PublicFlow` objects, and pass them in add bodies.

- [ ] **Step 2: Run to verify FAIL** — `npx tsx --test service/tests/ms365-power-automate-router.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `ms365-tool-router.ts`:

Add path constant `export const MS365_FLOWS_UPDATE_PATH = "/v1/ms365/flows/update";`.

Extend `PublicFlow` + `publicFlows`:
```ts
interface PublicFlow { name: string; enabled: boolean; timeoutMs: number; description: string; payloadSchema: string }
function publicFlows(store: PowerAutomateStore): PublicFlow[] {
  return store.list().map((f) => ({ name: f.name, enabled: f.enabled, timeoutMs: f.timeoutMs, description: f.description, payloadSchema: f.payloadSchema }));
}
```

Add a JSON-schema validator helper:
```ts
/** Empty is allowed; otherwise the text must be parseable JSON. Returns the text or throws 400. */
function validateSchemaText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Ms365RouterRequestError("payloadSchema must be a string.");
  if (value.length === 0) return "";
  try { JSON.parse(value); } catch { throw new Ms365RouterRequestError("payloadSchema must be valid JSON."); }
  return value;
}
```

Extend `parseAddFlowBody`:
```ts
function parseAddFlowBody(body: unknown): { name: string; url: string; description: string; payloadSchema: string; timeoutMs?: number } {
  if (typeof body !== "object" || body === null) throw new Ms365RouterRequestError("Request body must be a JSON object.");
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.name)) throw new Ms365RouterRequestError("name is required.");
  if (!nonEmptyString(record.url)) throw new Ms365RouterRequestError("url is required.");
  const out: { name: string; url: string; description: string; payloadSchema: string; timeoutMs?: number } = {
    name: record.name,
    url: record.url,
    description: typeof record.description === "string" ? record.description : "",
    payloadSchema: validateSchemaText(record.payloadSchema),
  };
  if (typeof record.timeoutMs === "number") out.timeoutMs = record.timeoutMs;
  return out;
}
```

Add `parseUpdateFlowBody`:
```ts
function parseUpdateFlowBody(body: unknown): { name: string; description: string; timeoutMs: number; payloadSchema: string; url?: string } {
  if (typeof body !== "object" || body === null) throw new Ms365RouterRequestError("Request body must be a JSON object.");
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.name)) throw new Ms365RouterRequestError("name is required.");
  if (typeof record.timeoutMs !== "number") throw new Ms365RouterRequestError("timeoutMs must be a number.");
  const out: { name: string; description: string; timeoutMs: number; payloadSchema: string; url?: string } = {
    name: record.name,
    description: typeof record.description === "string" ? record.description : "",
    timeoutMs: record.timeoutMs,
    payloadSchema: validateSchemaText(record.payloadSchema),
  };
  if (nonEmptyString(record.url)) out.url = record.url;
  return out;
}
```

Update the add route handler to pass `description` + `payloadSchema`:
```ts
          const { name, url, description, payloadSchema, timeoutMs } = parseAddFlowBody(ctx.body);
          if (deps.powerAutomateStore.resolve(name) !== null) throw new Ms365RouterRequestError("A flow with this name already exists.");
          await deps.powerAutomateStore.add({ name, url, description, payloadSchema, timeoutMs: timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS });
```

Add the update route (after the timeout route):
```ts
      {
        method: "POST",
        path: MS365_FLOWS_UPDATE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name, description, timeoutMs, payloadSchema, url } = parseUpdateFlowBody(ctx.body);
          if (deps.powerAutomateStore.resolve(name) === null) throw new Ms365RouterRequestError("No flow with this name exists.");
          await deps.powerAutomateStore.update(name, url !== undefined ? { description, timeoutMs, payloadSchema, url } : { description, timeoutMs, payloadSchema });
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
```

- [ ] **Step 4: Run to verify PASS** — router test passes.
- [ ] **Step 5: Typecheck + commit** — typecheck clean (Task 1/3 add/update breaks resolved here).
```bash
git add service/src/ms365/ms365-tool-router.ts service/tests/ms365-power-automate-router.test.ts
git commit -m "feat(ms365): flow routes carry description+payloadSchema + add update route with JSON validation"
```

---

### Task 5: Dialog component — `ms-flow-dialog.ts` (with payload schema field)

**Files:**
- Create: `app/ui/src/ui-shell/microsoft/ms-flow-dialog.ts`
- Test: `app/ui/tests/ms-flow-dialog.test.ts` (create)

**Interfaces:**
```ts
export interface FlowDialogValues { name: string; url: string; description: string; payloadSchema: string; timeoutSec: number }
export interface FlowDialogOptions {
  mode: "add" | "edit";
  initial?: { name: string; description: string; payloadSchema: string; timeoutSec: number };
  onSubmit: (values: FlowDialogValues) => Promise<void>;
}
export function openFlowDialog(container: HTMLElement, opts: FlowDialogOptions): void
```
Standalone (no service-client import) → typecheck stays clean.

- [ ] **Step 1: Failing test** — create `app/ui/tests/ms-flow-dialog.test.ts` (reuse JSDOM bootstrap from `app/ui/tests/ms-connect-view.test.ts`):
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
// ... JSDOM `document` bootstrap ...
import { openFlowDialog } from "../src/ui-shell/microsoft/ms-flow-dialog.js";

test("add submits values incl. payloadSchema; timeout in seconds", async () => {
  const container = document.createElement("div");
  const out: unknown[] = [];
  openFlowDialog(container, { mode: "add", onSubmit: async (v) => { out.push(v); } });
  (container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).value = "f1";
  (container.querySelector(".ms-flow-dialog__url") as HTMLInputElement).value = "https://x/1?sig=a";
  (container.querySelector(".ms-flow-dialog__desc") as HTMLTextAreaElement).value = "send mail";
  (container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value = '{"type":"object"}';
  (container.querySelector(".ms-flow-dialog__timeout") as HTMLInputElement).value = "30";
  (container.querySelector(".ms-flow-dialog__save") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(out, [{ name: "f1", url: "https://x/1?sig=a", description: "send mail", payloadSchema: '{"type":"object"}', timeoutSec: 30 }]);
});

test("invalid schema JSON blocks submit with inline error", async () => {
  const container = document.createElement("div");
  let called = false;
  openFlowDialog(container, { mode: "add", onSubmit: async () => { called = true; } });
  (container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).value = "f1";
  (container.querySelector(".ms-flow-dialog__url") as HTMLInputElement).value = "https://x/1?sig=a";
  (container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value = "{not json";
  (container.querySelector(".ms-flow-dialog__save") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(called, false);
  assert.equal((container.querySelector(".ms-flow-dialog__error") as HTMLElement).hidden, false);
});

test("edit locks name, blank URL, prefills desc + schema", async () => {
  const container = document.createElement("div");
  openFlowDialog(container, { mode: "edit", initial: { name: "f1", description: "old", payloadSchema: '{"a":1}', timeoutSec: 120 }, onSubmit: async () => {} });
  assert.equal((container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).readOnly, true);
  assert.equal((container.querySelector(".ms-flow-dialog__url") as HTMLInputElement).value, "");
  assert.equal((container.querySelector(".ms-flow-dialog__desc") as HTMLTextAreaElement).value, "old");
  assert.equal((container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value, '{"a":1}');
});

test("Escape closes", async () => {
  const container = document.createElement("div");
  openFlowDialog(container, { mode: "add", onSubmit: async () => {} });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(container.querySelector(".ms-flow-dialog"), null);
});
```

- [ ] **Step 2: Run to verify FAIL** — module not found.

- [ ] **Step 3: Implement** — create `app/ui/src/ui-shell/microsoft/ms-flow-dialog.ts`:
```ts
/**
 * Modal dialog for adding or editing a Power Automate flow. Mirrors permission-modal.ts:
 * backdrop + role="dialog" with a focus trap, Escape/backdrop-to-close, focus restore. The flow
 * URL is a bearer secret — in edit mode the URL field is NEVER pre-filled; blank means "keep the
 * stored URL". The name is the identity key, so it is read-only in edit mode. payloadSchema is a
 * JSON Schema text validated as parseable JSON (empty allowed) before submit.
 */
import { el } from "../dom-utils.js";

export interface FlowDialogValues { name: string; url: string; description: string; payloadSchema: string; timeoutSec: number }
export interface FlowDialogOptions {
  mode: "add" | "edit";
  initial?: { name: string; description: string; payloadSchema: string; timeoutSec: number };
  onSubmit: (values: FlowDialogValues) => Promise<void>;
}

const FOCUSABLE = 'button, input, textarea, [tabindex]:not([tabindex="-1"])';

export function openFlowDialog(container: HTMLElement, opts: FlowDialogOptions): void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const backdrop = el("div", "ms-flow-dialog-backdrop");
  const dialog = el("section", "ms-flow-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const title = el("h2", "ms-flow-dialog__title", opts.mode === "add" ? "Thêm Power Automate flow" : "Sửa flow");

  const nameInput = el("input", "ms-flow-dialog__name") as HTMLInputElement;
  nameInput.type = "text";
  nameInput.placeholder = "Tên flow";
  nameInput.autocomplete = "off";
  if (opts.mode === "edit" && opts.initial) { nameInput.value = opts.initial.name; nameInput.readOnly = true; }

  const urlInput = el("input", "ms-flow-dialog__url") as HTMLInputElement;
  urlInput.type = "text";
  urlInput.autocomplete = "off";
  urlInput.spellcheck = false;
  urlInput.placeholder = opts.mode === "edit" ? "Để trống nếu giữ URL cũ" : "URL HTTP-trigger của flow";

  const descInput = el("textarea", "ms-flow-dialog__desc") as HTMLTextAreaElement;
  descInput.rows = 2;
  descInput.placeholder = "Mô tả (cho Agent): flow làm gì, khi nào dùng";
  if (opts.initial) descInput.value = opts.initial.description;

  const schemaInput = el("textarea", "ms-flow-dialog__schema") as HTMLTextAreaElement;
  schemaInput.rows = 4;
  schemaInput.spellcheck = false;
  schemaInput.placeholder = 'Payload JSON Schema (tùy chọn), ví dụ {"type":"object","properties":{"message":{"type":"string"}}}';
  if (opts.initial) schemaInput.value = opts.initial.payloadSchema;

  const timeoutInput = el("input", "ms-flow-dialog__timeout") as HTMLInputElement;
  timeoutInput.type = "number";
  timeoutInput.min = "1";
  timeoutInput.placeholder = "Timeout (giây)";
  timeoutInput.value = String(opts.initial?.timeoutSec ?? 120);

  const errorSlot = el("p", "ms-flow-dialog__error", "");
  errorSlot.hidden = true;

  const cancelBtn = el("button", "ms-flow-dialog__cancel", "Hủy") as HTMLButtonElement;
  cancelBtn.type = "button";
  const saveBtn = el("button", "ms-flow-dialog__save", "Lưu") as HTMLButtonElement;
  saveBtn.type = "button";
  const actions = el("footer", "ms-flow-dialog__actions");
  actions.append(cancelBtn, saveBtn);

  dialog.append(title, labeled("Tên", nameInput), labeled("URL", urlInput), labeled("Mô tả", descInput), labeled("Payload JSON Schema", schemaInput), labeled("Timeout (giây)", timeoutInput), errorSlot, actions);
  backdrop.append(dialog);
  container.append(backdrop);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
  };

  const showError = (msg: string): void => { errorSlot.textContent = msg; errorSlot.hidden = false; };

  const submit = (): void => {
    if (closed) return;
    const name = opts.mode === "edit" && opts.initial ? opts.initial.name : nameInput.value.trim();
    const url = urlInput.value.trim();
    const description = descInput.value;
    const payloadSchema = schemaInput.value.trim();
    const secs = Number.parseInt(timeoutInput.value, 10);
    if (name.length === 0) return showError("Cần nhập tên flow.");
    if (opts.mode === "add" && url.length === 0) return showError("Cần nhập URL flow.");
    if (!Number.isFinite(secs) || secs < 1) return showError("Timeout phải là số giây ≥ 1.");
    if (payloadSchema.length > 0) { try { JSON.parse(payloadSchema); } catch { return showError("Payload JSON Schema không phải JSON hợp lệ."); } }
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    errorSlot.hidden = true;
    void opts.onSubmit({ name, url, description, payloadSchema, timeoutSec: secs })
      .then(() => close())
      .catch(() => { showError("Không lưu được flow (trùng tên hoặc lỗi). Thử lại."); saveBtn.disabled = false; cancelBtn.disabled = false; });
  };

  function onKeydown(event: KeyboardEvent): void {
    if (closed) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", submit);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  document.addEventListener("keydown", onKeydown, true);
  (opts.mode === "edit" ? descInput : nameInput).focus();
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", "ms-flow-dialog__field");
  wrap.append(el("span", "ms-flow-dialog__field-label", label), control);
  return wrap;
}
```

- [ ] **Step 4: Run to verify PASS** — dialog test passes.
- [ ] **Step 5: Typecheck + commit** (standalone, clean).
```bash
git add app/ui/src/ui-shell/microsoft/ms-flow-dialog.ts app/ui/tests/ms-flow-dialog.test.ts
git commit -m "feat(ms365): add/edit flow modal dialog with payload JSON schema field"
```

---

### Task 6: Service-client — `description` + `payloadSchema` + `updateMs365Flow`

**Files:**
- Modify: `app/ui/src/service-client.ts`
- Test: `app/ui/tests/ms365-flows-service-client.test.ts` (extend)

**Interfaces:**
- Produces: `Ms365FlowView` = `{ name; enabled; timeoutMs; description; payloadSchema }`. `addMs365Flow(name, url, description, payloadSchema, timeoutMs?)`. `updateMs365Flow(name, { description; timeoutMs; payloadSchema; url? })`.

- [ ] **Step 1: Failing tests** — append (reuse the envelope `stubFetch`):
```ts
test("addMs365Flow sends description + payloadSchema", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  await client.addMs365Flow("f1", "https://x/1?sig=a", "send mail", '{"type":"object"}', 3000);
  assert.deepEqual(JSON.parse(calls.at(-1)!.init!.body as string), { name: "f1", url: "https://x/1?sig=a", description: "send mail", payloadSchema: '{"type":"object"}', timeoutMs: 3000 });
});

test("updateMs365Flow posts schema; omits url when blank", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  await client.updateMs365Flow("f1", { description: "d2", timeoutMs: 8000, payloadSchema: '{"a":1}' });
  const last = calls.at(-1)!;
  assert.ok(last.url.endsWith("/v1/ms365/flows/update"));
  assert.deepEqual(JSON.parse(last.init!.body as string), { name: "f1", description: "d2", timeoutMs: 8000, payloadSchema: '{"a":1}' });
});

test("updateMs365Flow includes url when given", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  await client.updateMs365Flow("f1", { description: "d", timeoutMs: 8000, payloadSchema: "", url: "https://x/2?sig=b" });
  assert.deepEqual(JSON.parse(calls.at(-1)!.init!.body as string), { name: "f1", description: "d", timeoutMs: 8000, payloadSchema: "", url: "https://x/2?sig=b" });
});
```
Update the existing `addMs365Flow` test to the new 5-arg signature + expected body.

- [ ] **Step 2: Run to verify FAIL**.
- [ ] **Step 3: Implement** — in `service-client.ts`:
```ts
export interface Ms365FlowView {
  readonly name: string;
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly description: string;
  readonly payloadSchema: string;
}
```
Interface members:
```ts
  addMs365Flow(name: string, url: string, description: string, payloadSchema: string, timeoutMs?: number): Promise<readonly Ms365FlowView[]>;
  updateMs365Flow(name: string, fields: { description: string; timeoutMs: number; payloadSchema: string; url?: string }): Promise<readonly Ms365FlowView[]>;
```
Impl:
```ts
    addMs365Flow: async (name, url, description, payloadSchema, timeoutMs) =>
      (
        await call<{ flows: readonly Ms365FlowView[] }>("/v1/ms365/flows", {
          method: "POST",
          body: JSON.stringify(timeoutMs !== undefined ? { name, url, description, payloadSchema, timeoutMs } : { name, url, description, payloadSchema }),
        })
      ).flows,

    updateMs365Flow: async (name, fields) =>
      (
        await call<{ flows: readonly Ms365FlowView[] }>("/v1/ms365/flows/update", {
          method: "POST",
          body: JSON.stringify(
            fields.url !== undefined && fields.url.length > 0
              ? { name, description: fields.description, timeoutMs: fields.timeoutMs, payloadSchema: fields.payloadSchema, url: fields.url }
              : { name, description: fields.description, timeoutMs: fields.timeoutMs, payloadSchema: fields.payloadSchema },
          ),
        })
      ).flows,
```

- [ ] **Step 4: Run to verify PASS**.
- [ ] **Step 5: Typecheck + commit** — note the expected UI break (fixed Task 7).
```bash
git add app/ui/src/service-client.ts app/ui/tests/ms365-flows-service-client.test.ts
git commit -m "feat(ms365): service-client add(description,payloadSchema) + updateMs365Flow"
```

---

### Task 7: UI section rewrite — read-only list + dialog + edit/delete/toggle

**Files:**
- Modify: `app/ui/src/ui-shell/microsoft/ms-connect-view.ts` (replace `renderPowerAutomateSection`/`renderFlowRow`/`renderFlowAddForm`; extend `Ms365ConnectClient`)
- Modify: `app/ui/src/app-shell.ts` (`NULL_MS365_CLIENT`)
- Modify: `app/ui/tests/ms-connect-view.test.ts`, `app/ui/tests/microsoft-view.test.ts` (fake clients)
- Modify: `app/ui/src/ui-shell/microsoft/microsoft.css`
- Test: `app/ui/tests/ms-power-automate-section.test.ts` (rewrite)

**Interfaces:** consumes `openFlowDialog` (Task 5) + service-client methods (Task 6).

- [ ] **Step 1: Failing test** — rewrite `app/ui/tests/ms-power-automate-section.test.ts` (reuse harness + `connectedView` + `baseClient` from `ms-connect-view.test.ts`; extend `baseClient` with flow methods incl. `updateMs365Flow`):
```ts
test("renders flows read-only with name + description", async () => {
  const container = document.createElement("div");
  const client = { ...baseClient, listMs365Flows: async () => [{ name: "f1", enabled: true, timeoutMs: 5000, description: "does X", payloadSchema: "" }] };
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(container.textContent ?? "", /f1/);
  assert.match(container.textContent ?? "", /does X/);
});

test("Thêm flow → dialog → addMs365Flow with description, payloadSchema, seconds→ms", async () => {
  const container = document.createElement("div");
  const added: unknown[] = [];
  const client = { ...baseClient, listMs365Flows: async () => [], addMs365Flow: async (name: string, url: string, description: string, payloadSchema: string, timeoutMs?: number) => { added.push({ name, url, description, payloadSchema, timeoutMs }); return [] as never; } };
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  (container.querySelector(".ms-flows__add-btn") as HTMLButtonElement).click();
  (container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).value = "f2";
  (container.querySelector(".ms-flow-dialog__url") as HTMLInputElement).value = "https://x/2?sig=b";
  (container.querySelector(".ms-flow-dialog__desc") as HTMLTextAreaElement).value = "send mail";
  (container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value = '{"type":"object"}';
  (container.querySelector(".ms-flow-dialog__timeout") as HTMLInputElement).value = "30";
  (container.querySelector(".ms-flow-dialog__save") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(added, [{ name: "f2", url: "https://x/2?sig=b", description: "send mail", payloadSchema: '{"type":"object"}', timeoutMs: 30_000 }]);
});

test("Sửa → dialog prefilled (name locked, schema prefilled) → updateMs365Flow", async () => {
  const container = document.createElement("div");
  const updated: unknown[] = [];
  const client = { ...baseClient, listMs365Flows: async () => [{ name: "f1", enabled: true, timeoutMs: 5000, description: "old", payloadSchema: '{"a":1}' }], updateMs365Flow: async (name: string, fields: unknown) => { updated.push({ name, fields }); return [] as never; } };
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  (container.querySelector(".ms-flows__edit") as HTMLButtonElement).click();
  assert.equal((container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).readOnly, true);
  assert.equal((container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value, '{"a":1}');
  (container.querySelector(".ms-flow-dialog__desc") as HTMLTextAreaElement).value = "new";
  (container.querySelector(".ms-flow-dialog__save") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(updated, [{ name: "f1", fields: { description: "new", timeoutMs: 5000, payloadSchema: '{"a":1}', url: "" } }]);
});

test("Xóa → deleteMs365Flow immediately; no url in DOM", async () => {
  const container = document.createElement("div");
  const deleted: string[] = [];
  const client = { ...baseClient, listMs365Flows: async () => [{ name: "f1", enabled: true, timeoutMs: 5000, description: "d", payloadSchema: "" }], deleteMs365Flow: async (name: string) => { deleted.push(name); return [] as never; } };
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  (container.querySelector(".ms-flows__delete") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(deleted, ["f1"]);
  assert.doesNotMatch(container.innerHTML, /:\/\//);
});
```

- [ ] **Step 2: Run to verify FAIL**.

- [ ] **Step 3a: Extend client interface** — in `ms-connect-view.ts`, add the import `import { openFlowDialog } from "./ms-flow-dialog.js";` and set `Ms365ConnectClient` to:
```ts
  listMs365Flows(): Promise<readonly Ms365FlowView[]>;
  addMs365Flow(name: string, url: string, description: string, payloadSchema: string, timeoutMs?: number): Promise<readonly Ms365FlowView[]>;
  updateMs365Flow(name: string, fields: { description: string; timeoutMs: number; payloadSchema: string; url?: string }): Promise<readonly Ms365FlowView[]>;
  deleteMs365Flow(name: string): Promise<readonly Ms365FlowView[]>;
  setMs365FlowEnabled(name: string, enabled: boolean): Promise<readonly Ms365FlowView[]>;
  setMs365FlowTimeout(name: string, timeoutMs: number): Promise<readonly Ms365FlowView[]>;
```
(Keep `setMs365FlowTimeout` for interface compatibility even though the dialog now covers timeout via update; if a grep shows no remaining caller you MAY drop it from the interface — `ServiceClient` keeps its own.)

- [ ] **Step 3b: Replace section renderers** — replace `renderPowerAutomateSection`, `renderFlowRow`, and delete `renderFlowAddForm`:
```ts
function renderPowerAutomateSection(deps: RenderMsConnectDeps): HTMLElement {
  const wrap = el("div", "ms-flows");
  const header = el("div", "ms-flows__header");
  header.append(el("h3", "ms-section-label", "Power Automate (tùy chỉnh)"));
  const addBtn = el("button", "ms-flows__add-btn", "＋ Thêm flow") as HTMLButtonElement;
  addBtn.type = "button";
  header.append(addBtn);
  wrap.append(header);

  const list = el("div", "ms-flows__list");
  const status = el("p", "ms-flows__status", "Đang tải danh sách flow…");
  wrap.append(status, list);

  const paint = (flows: readonly Ms365FlowView[]): void => {
    status.hidden = true;
    list.replaceChildren();
    if (flows.length === 0) { status.textContent = "Chưa có flow nào — bấm “Thêm flow”."; status.hidden = false; return; }
    for (const flow of flows) list.append(renderFlowRow(deps, flow, paint));
  };

  addBtn.addEventListener("click", () => {
    openFlowDialog(document.body, { mode: "add", onSubmit: async (v) => { paint(await deps.client.addMs365Flow(v.name, v.url, v.description, v.payloadSchema, v.timeoutSec * 1000)); } });
  });

  void deps.client.listMs365Flows().then(paint).catch(() => { status.textContent = "Không thể tải danh sách flow, thử lại sau."; status.hidden = false; });
  return wrap;
}

function renderFlowRow(deps: RenderMsConnectDeps, flow: Ms365FlowView, onRefresh: (flows: readonly Ms365FlowView[]) => void): HTMLElement {
  const row = el("div", "ms-flows__row");
  const info = el("div", "ms-flows__info");
  info.append(el("span", "ms-flows__name", flow.name));
  if (flow.description.length > 0) info.append(el("span", "ms-flows__desc", flow.description));
  info.append(el("span", "ms-flows__timeout-badge", `${Math.round(flow.timeoutMs / 1000)}s`));
  if (flow.payloadSchema.length > 0) info.append(el("span", "ms-flows__schema-badge", "schema"));

  const controls = el("div", "ms-flows__controls");
  const toggle = el("input", "ms-flows__toggle") as HTMLInputElement;
  toggle.type = "checkbox";
  toggle.checked = flow.enabled;
  toggle.setAttribute("aria-label", `Bật/tắt ${flow.name}`);
  toggle.addEventListener("change", () => {
    const next = toggle.checked;
    toggle.disabled = true;
    void deps.client.setMs365FlowEnabled(flow.name, next).then(onRefresh).catch(() => { toggle.checked = !next; toggle.disabled = false; });
  });

  const editBtn = el("button", "ms-flows__edit", "Sửa") as HTMLButtonElement;
  editBtn.type = "button";
  editBtn.addEventListener("click", () => {
    openFlowDialog(document.body, {
      mode: "edit",
      initial: { name: flow.name, description: flow.description, payloadSchema: flow.payloadSchema, timeoutSec: Math.round(flow.timeoutMs / 1000) },
      onSubmit: async (v) => { onRefresh(await deps.client.updateMs365Flow(v.name, { description: v.description, timeoutMs: v.timeoutSec * 1000, payloadSchema: v.payloadSchema, url: v.url })); },
    });
  });

  const delBtn = el("button", "ms-flows__delete", "Xóa") as HTMLButtonElement;
  delBtn.type = "button";
  delBtn.addEventListener("click", () => { delBtn.disabled = true; void deps.client.deleteMs365Flow(flow.name).then(onRefresh).catch(() => { delBtn.disabled = false; }); });

  controls.append(toggle, editBtn, delBtn);
  row.append(info, controls);
  return row;
}
```

- [ ] **Step 3c: `app-shell.ts` NULL client** — add/adjust:
```ts
  addMs365Flow: () => Promise.reject(new Error("service_not_ready")),
  updateMs365Flow: () => Promise.reject(new Error("service_not_ready")),
```

- [ ] **Step 3d: sibling fixtures** — in `ms-connect-view.test.ts` and `microsoft-view.test.ts`, add `addMs365Flow`/`updateMs365Flow` (correct signatures) to the fake clients (additive; no assertion changes).

- [ ] **Step 3e: CSS** — add `microsoft.css` rules for `.ms-flows__header`, `.ms-flows__add-btn`, `.ms-flows__row`, `.ms-flows__info`, `.ms-flows__desc`, `.ms-flows__timeout-badge`, `.ms-flows__schema-badge`, `.ms-flows__controls`, `.ms-flows__edit`, `.ms-flows__delete`, and dialog classes (`.ms-flow-dialog-backdrop`, `.ms-flow-dialog`, `.ms-flow-dialog__field`, `.ms-flow-dialog__field-label`, `.ms-flow-dialog__actions`, `.ms-flow-dialog__error`). Reuse `--cghc-*` tokens; mirror `.permission-backdrop`/`.permission-dialog` for the modal look. `.ms-flow-dialog__error` uses `var(--cghc-error, #c0392b)`.

- [ ] **Step 4: Run to verify PASS**:
```bash
npx tsx --test app/ui/tests/ms-power-automate-section.test.ts app/ui/tests/ms-flow-dialog.test.ts app/ui/tests/ms-connect-view.test.ts app/ui/tests/microsoft-view.test.ts
```

- [ ] **Step 5: Full check + commit**:
```bash
npm run typecheck   # fully clean (resolves Task 6 break)
npm run build:app   # succeeds
git add app/ui/src/ui-shell/microsoft/ms-connect-view.ts app/ui/src/app-shell.ts app/ui/tests/ms-power-automate-section.test.ts app/ui/tests/ms-connect-view.test.ts app/ui/tests/microsoft-view.test.ts app/ui/src/ui-shell/microsoft/microsoft.css
git commit -m "feat(ms365): flow management via read-only list + add/edit dialog (desc + payload schema) + delete"
```

- [ ] **Step 6: Packaged visual acceptance (LEAVE FOR HUMAN)** — do not run the app. Note for the human: connected MS365 tab shows the flow list (name + description + timeout + schema badge + toggle); ＋Thêm opens the dialog with a Payload JSON Schema field; Sửa prefills (name read-only, blank URL, schema prefilled); Xóa removes immediately; no URL ever appears in the UI.

---

## Self-Review

**Spec coverage:** description (T1/T2 done; T4/T6/T7) ✅; payloadSchema (T3 store/service/tool; T4 router+validation; T5 dialog; T6 client; T7 UI) ✅; list_flows returns description+payloadSchema (T2/T3) ✅; edit via update op+route+client+dialog (T1/T3/T4/T5/T6/T7) ✅; URL blank=keep (T1/T3 store, T4 router, T6 client, T5 placeholder, T7 passes v.url) ✅; name immutable on edit (T5/T7) ✅; delete immediate (T7) ✅; dialog mirrors permission-modal (T5) ✅; read-only list + toggle + add/edit/delete (T7) ✅; URL never in DOM/response/type (T4 PublicFlow, T6 type, T5 no prefill, T7 test asserts) ✅; payloadSchema JSON validation (T4 router, T5 dialog) ✅; backward-compat (T1/T3) ✅; testing + build per task ✅.

**Placeholder scan:** No TBD/TODO; full code in every code step. "reuse harness from `<file>`" points to concrete files; new assertions written out.

**Type consistency:** `PowerAutomateFlow {name,url,enabled,timeoutMs,description,payloadSchema}`. `add({name,url,description,timeoutMs,payloadSchema})` (T3) ↔ router add (T4). `update(name,{description,timeoutMs,payloadSchema,url?})` (T3) ↔ router `/flows/update` (T4) ↔ client `updateMs365Flow` (T6) ↔ section (T7). `listFlows()`/`PublicFlow`/`Ms365FlowView` all `{name,description,payloadSchema(+enabled,timeoutMs where applicable)}`, never url. `addMs365Flow(name,url,description,payloadSchema,timeoutMs?)` (T6) ↔ section call (T7). `FlowDialogValues {name,url,description,payloadSchema,timeoutSec}` (T5) ↔ T7 onSubmit. Seconds↔ms consistent.

**Intermediate typecheck states (documented):** T1/T3 break router add/update callers → fixed T4. T6 breaks UI add caller/fixtures → fixed T7. Noted in each task's commit step.
