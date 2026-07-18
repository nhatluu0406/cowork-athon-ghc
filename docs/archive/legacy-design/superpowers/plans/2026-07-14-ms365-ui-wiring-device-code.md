# MS365 UI Wiring + Device-Code OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the MS365 connect UI to the existing backend connector so a user can connect for real via manual token (works now) or device-code OAuth (reads client ID/tenant from env, honest-gated until IT provisions an Azure app registration), and produce an IT request doc.

**Architecture:** Add device-code capability to `Ms365Connector` (it currently only has `connectWithToken`), expose it via two new token-guarded loopback routes (`device/begin`, `device/poll`) using UI-driven polling (Option A — service holds device state, UI polls every ~5s). Add typed service-client methods, then rewrite `ms-connect-view` into three data-driven states (disconnected → device_pending → connected) with a collapsed manual-token fallback. Client ID/tenant come from `CGHC_MS365_CLIENT_ID`/`CGHC_MS365_TENANT` env, wired in the composition root behind the existing `CGHC_MS365_ENABLED` flag.

**Tech Stack:** TypeScript (strict, ESM, `.js` specifiers), Node.js, `node:test` + `node:assert/strict`. Reuses `service/src/ms365/*` (connector, device-code-provider, view), `service/src/ms365/ms365-tool-router.ts`, `app/ui/src/service-client.ts`, `app/ui/src/ui-shell/microsoft/ms-connect-view.ts`, `service/src/composition/compose-service.ts`.

## Global Constraints

- **Language:** Code/comments/tests/identifiers in **English**; human-facing docs under `docs/` in **Vietnamese** (per `.claude/rules/documentation.md`). UI copy strings shown to the user are Vietnamese (matches existing `ms-connect-view`).
- **Type safety:** strict; **no `any`** (incl. tests); validate at HTTP/IPC boundaries; exhaustive unions.
- **Secrets:** access/refresh token stays in keyring + service memory only — never in renderer state, DOM, logs, EV frames, or any route/poll response. `userCode` is a short-lived pairing code (NOT a secret) and may be displayed. Client ID/tenant are non-secret config but must NOT be hardcoded or committed.
- **Network/SSRF:** device-code provider already SSRF-pins `login.microsoftonline.com`; do not add new outbound hosts. No new fetch outside the existing provider.
- **Permission/security:** every new route is token-guarded (NO `publicUnauthenticated`).
- **Feature flag:** everything stays behind `CGHC_MS365_ENABLED` (OFF by default). Flag off → no device routes reachable, baseline unchanged.
- **Honesty:** never render "connected" without the service `view` confirming it; device button disabled + honest note when `not_configured`; no fake success.
- **Test commands:** from `service/`: `node --import tsx --test tests/<file>.test.ts`; from repo root: `npm run typecheck`, `npm run build:renderer`. Pre-existing ~20 failures in live/integration suites (streaming/session/execution/composition-*) are unrelated — ignore them; confirm your new tests pass and no NEW failures elsewhere.
- **Runtime reality:** `Ms365Connector.connectWithDeviceCode` does NOT exist yet (connector only has `connectWithToken`). The device-code PROVIDER exists (`device-code-provider.ts`, `begin()`/`poll()`) but is unwired. This plan adds the connector capability.
- **No `openExternal` bridge:** the shell bridge (`app/ui/src/bridge.ts`) exposes only `getBootstrap`/`pickWorkspaceFolder`/`pickWorkspaceFile`/`connectLive`/`setWindowTheme` — there is NO open-URL capability. Baseline UI uses copy-to-clipboard for the verification URL + user code. A native `openExternal` IPC is an OPTIONAL task (Task 8), not required for the flow to work.

---

## File Structure

Modified:
- `service/src/ms365/ms365-connector.ts` — add device-code capability to the interface + deps + state machine.
- `service/src/ms365/ms365-tool-router.ts` — add `POST /v1/ms365/device/begin` + `POST /v1/ms365/device/poll`; export new path constants.
- `service/src/ms365/index.ts` — re-export new path constants + device types.
- `service/src/composition/compose-service.ts` — read `CGHC_MS365_CLIENT_ID`/`CGHC_MS365_TENANT`, build the device provider when present, pass to connector.
- `app/ui/src/service-client.ts` — add `connectMs365Token`, `beginMs365Device`, `pollMs365Device`, `fetchMs365View` + result types.
- `app/ui/src/ui-shell/microsoft/ms-connect-view.ts` — rewrite into 3 data-driven states + manual fallback + device flow.
- `app/ui/src/ui-shell/microsoft/microsoft-view.ts` — pass the service client + view refresh into the connect view (wiring the surface).
- (Optional Task 8) `app/shell/src/ipc/channels.ts`, `bridge.ts`, `register-handlers.ts`, `app/ui/src/bridge.ts` — add validated `openExternal`.

Created:
- `docs/integration/ms365-it-request.md` — Vietnamese IT request checklist.

Tests (created):
- `service/tests/ms365-connector-device.test.ts`, `service/tests/ms365-device-routes.test.ts`, `service/tests/ms365-device-config.test.ts`, `app/ui/tests/ms-connect-view.test.ts` (or the repo's UI test location — confirm at Step 2).

---

## Task 1: Connector device-code capability

**Files:**
- Modify: `service/src/ms365/ms365-connector.ts`
- Test: `service/tests/ms365-connector-device.test.ts`

**Interfaces:**
- Consumes: `DeviceCodePrompt` from `./device-code-provider.js` (`{ userCode, verificationUri, expiresInSec }`); the device provider factory shape `{ provider: TokenProvider; begin(): Promise<DeviceCodePrompt>; poll(): Promise<"pending" | "connected"> }`.
- Produces (added to `Ms365Connector`):
  - `beginDeviceCode(): Promise<DeviceCodePrompt>` — throws `Ms365Error("not_configured", ...)` when no device provider is wired.
  - `pollDeviceCode(): Promise<"pending" | "connected" | "expired">` — maps the provider's `poll()`; on `connected` runs the same `verify` + sets state `connected`, source `"device_code"`; a provider "expired"/timeout surfaces as `"expired"`.
  - `deviceConfigured(): boolean`.
  - New optional dep `device?: { provider: TokenProvider; begin(): Promise<DeviceCodePrompt>; poll(): Promise<"pending" | "connected"> }` on `Ms365ConnectorDeps`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-connector-device.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMs365Connector } from "../src/ms365/ms365-connector.js";
import { createManualTokenProvider } from "../src/ms365/token-provider.js";
import { createCredentialService } from "../src/credential/index.js";
import { createMemoryStore } from "../src/credential/memory-store.js";
import type { GraphClient } from "../src/ms365/graph-client.js";
import type { DeviceCodePrompt } from "../src/ms365/device-code-provider.js";

function okGraph(): GraphClient {
  return { json: async () => ({}) as never, bytes: async () => new Uint8Array() };
}
function manual() {
  return createManualTokenProvider({ credentials: createCredentialService({ store: createMemoryStore() }) });
}
function fakeDevice(script: Array<"pending" | "connected">) {
  let i = 0;
  const prompt: DeviceCodePrompt = { userCode: "ABCD-EFGH", verificationUri: "https://microsoft.com/devicelogin", expiresInSec: 900 };
  return {
    provider: { source: "device_code" as const, getAccessToken: async () => "AT", isValid: async () => true, clear: async () => {} },
    begin: async () => prompt,
    poll: async () => script[Math.min(i++, script.length - 1)]!,
  };
}

test("not configured: beginDeviceCode throws not_configured, deviceConfigured false", async () => {
  const c = createMs365Connector({ manual: manual(), makeGraph: () => okGraph() });
  assert.equal(c.deviceConfigured(), false);
  await assert.rejects(() => c.beginDeviceCode(), (e: unknown) => (e as { kind?: string }).kind === "not_configured");
});

test("configured: begin returns prompt; poll pending then connected → state connected, source device_code", async () => {
  const c = createMs365Connector({ manual: manual(), makeGraph: () => okGraph(), device: fakeDevice(["pending", "connected"]) });
  assert.equal(c.deviceConfigured(), true);
  const prompt = await c.beginDeviceCode();
  assert.equal(prompt.userCode, "ABCD-EFGH");
  assert.equal(await c.pollDeviceCode(), "pending");
  assert.equal(await c.pollDeviceCode(), "connected");
  assert.equal(c.connectionState(), "connected");
  assert.equal(c.source(), "device_code");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-connector-device.test.ts`
Expected: FAIL — `beginDeviceCode`/`pollDeviceCode`/`deviceConfigured` not on the connector; `device` not on deps.

- [ ] **Step 3: Implement** the additions in `ms365-connector.ts`:
  - Add the three methods to the `Ms365Connector` interface and `device?` to `Ms365ConnectorDeps`.
  - `beginDeviceCode`: if `deps.device === undefined` → `throw new Ms365Error("not_configured", "Chưa cấu hình client ID Microsoft.", "Nhờ IT cấp app registration rồi đặt CGHC_MS365_CLIENT_ID.", false)`; else set state `connecting`, return `await deps.device.begin()`.
  - `pollDeviceCode`: if no device → `throw Ms365Error("not_configured", ...)`; else `const r = await deps.device.poll();` — on `"pending"` return `"pending"`; on `"connected"` run `verify(makeGraph(() => deps.device!.provider.getAccessToken()))`, set state `connected`, source `"device_code"`, return `"connected"`. Catch an `Ms365Error` with `kind === "auth_expired"` from a provider timeout and return `"expired"` with state back to `disconnected`. Import `Ms365Error` (already imported).
  - `deviceConfigured`: `return deps.device !== undefined`.
  - `graph()` must return a client whose token comes from the ACTIVE source (manual or device). Track which provider is active; `getToken` pulls from it.

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-connector-device.test.ts` → PASS
Run (from repo root): `npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-connector.ts service/tests/ms365-connector-device.test.ts
git commit -m "feat(ms365): add device-code capability to connector"
```

---

## Task 2: Device-code routes on the boundary

**Files:**
- Modify: `service/src/ms365/ms365-tool-router.ts`
- Modify: `service/src/ms365/index.ts`
- Test: `service/tests/ms365-device-routes.test.ts`

**Interfaces:**
- Consumes: `Ms365Connector.beginDeviceCode/pollDeviceCode/deviceConfigured` (Task 1), `buildMs365View` (existing).
- Produces:
  - `export const MS365_DEVICE_BEGIN_PATH = "/v1/ms365/device/begin";`
  - `export const MS365_DEVICE_POLL_PATH = "/v1/ms365/device/poll";`
  - `POST device/begin` → `{ userCode, verificationUri, expiresInSec }` on success; when `!deviceConfigured()` → `{ status: 200, data: { error: "not_configured" } }` (a structured non-error result, NOT a 400 — the UI needs to render the honest gate).
  - `POST device/poll` → `{ status: "pending" | "connected" | "expired", view?: Ms365ViewData }` (view present only on `connected`).
  - Both token-guarded; body may be empty `{}`.
  - Re-export both path constants from `index.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-device-routes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMs365Router, MS365_DEVICE_BEGIN_PATH, MS365_DEVICE_POLL_PATH } from "../src/ms365/index.js";
import type { RouteContext } from "../src/boundary/contract.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";

function ctx(path: string): RouteContext {
  return { method: "POST", url: new URL(`http://127.0.0.1${path}`), params: {}, body: {} };
}
function connector(over: Partial<Ms365Connector>): Ms365Connector {
  return {
    connectionState: () => "disconnected", connectWithToken: async () => {}, disconnect: async () => {},
    graph: () => ({ json: async () => ({}) as never, bytes: async () => new Uint8Array() }),
    source: () => null, lastError: () => null,
    beginDeviceCode: async () => ({ userCode: "X", verificationUri: "u", expiresInSec: 900 }),
    pollDeviceCode: async () => "pending", deviceConfigured: () => true, ...over,
  } as Ms365Connector;
}
function tools() { return {} as never; }

test("device/begin returns prompt when configured", async () => {
  const router = createMs365Router({ tools: tools(), connector: connector({}), scopes: [] });
  const route = router.routes.find((r) => "path" in r && r.path === MS365_DEVICE_BEGIN_PATH);
  assert.ok(route && "handler" in route);
  const res = (await route.handler(ctx(MS365_DEVICE_BEGIN_PATH))) as { data: { userCode?: string } };
  assert.equal(res.data.userCode, "X");
});

test("device/begin returns not_configured when unconfigured", async () => {
  const router = createMs365Router({ tools: tools(), connector: connector({ deviceConfigured: () => false }), scopes: [] });
  const route = router.routes.find((r) => "path" in r && r.path === MS365_DEVICE_BEGIN_PATH);
  const res = (await (route as { handler: (c: RouteContext) => Promise<{ data: unknown }> }).handler(ctx(MS365_DEVICE_BEGIN_PATH)));
  assert.deepEqual(res.data, { error: "not_configured" });
});

test("device routes are token-guarded", () => {
  const router = createMs365Router({ tools: tools(), connector: connector({}), scopes: [] });
  for (const r of router.routes) assert.notEqual((r as { publicUnauthenticated?: true }).publicUnauthenticated, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-device-routes.test.ts`
Expected: FAIL — path constants not exported; routes not mounted.

- [ ] **Step 3: Implement** the two routes in `createMs365Router` (mirror the existing `connect` route). `begin`: `if (!deps.connector.deviceConfigured()) return { status: 200, data: { error: "not_configured" } };` else `return { status: 200, data: await deps.connector.beginDeviceCode() };`. `poll`: `const status = await deps.connector.pollDeviceCode(); return { status: 200, data: status === "connected" ? { status, view: buildMs365View(deps.connector, deps.scopes) } : { status } };`. Add + export the two path constants; re-export from `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-device-routes.test.ts` → PASS
Run (from repo root): `npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-tool-router.ts service/src/ms365/index.ts service/tests/ms365-device-routes.test.ts
git commit -m "feat(ms365): device-code begin/poll boundary routes"
```

---

## Task 3: Env config → device provider wiring

**Files:**
- Modify: `service/src/composition/compose-service.ts`
- Modify: `service/src/ms365/index.ts` (add a small pure config reader)
- Test: `service/tests/ms365-device-config.test.ts`

**Interfaces:**
- Consumes: `createDeviceCodeProvider` from `./device-code-provider.js` (`createDeviceCodeProvider({ ssrf, config: { clientId, tenant, scopes } })`), `isMs365Enabled` (existing).
- Produces:
  - `export function readMs365DeviceConfig(env: Record<string, string | undefined>): { clientId: string; tenant: string } | null` in `ms365/index.ts` — returns the config only when `CGHC_MS365_CLIENT_ID` is a non-empty string (tenant defaults to `CGHC_MS365_TENANT` or `"common"`); else `null`.
  - In `compose-service.ts` (inside the `isMs365Enabled` branch that builds the connector): if `readMs365DeviceConfig(process.env)` is non-null, build the device provider (reuse the same `ssrf` instance) and pass it as `device` to `createMs365Connector`; else omit `device`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-device-config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readMs365DeviceConfig } from "../src/ms365/index.js";

test("no client id → null", () => {
  assert.equal(readMs365DeviceConfig({}), null);
  assert.equal(readMs365DeviceConfig({ CGHC_MS365_TENANT: "contoso.onmicrosoft.com" }), null);
});
test("client id present → config, tenant defaults to common", () => {
  assert.deepEqual(readMs365DeviceConfig({ CGHC_MS365_CLIENT_ID: "cid" }), { clientId: "cid", tenant: "common" });
});
test("client id + tenant → both", () => {
  assert.deepEqual(readMs365DeviceConfig({ CGHC_MS365_CLIENT_ID: "cid", CGHC_MS365_TENANT: "t1" }), { clientId: "cid", tenant: "t1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-device-config.test.ts`
Expected: FAIL — `readMs365DeviceConfig` not found.

- [ ] **Step 3: Implement** `readMs365DeviceConfig` in `ms365/index.ts` (pure). Then wire it in `compose-service.ts`: read the config, and when non-null build `const deviceProvider = createDeviceCodeProvider({ ssrf, config: { clientId, tenant, scopes: MS365_SCOPES } });` and pass `device: deviceProvider` into the existing `createMs365Connector({...})`. Reuse the SAME `ssrf` instance already in scope (do not create a second). Read `compose-service.ts` first to place this inside the existing MS365 flag branch.

- [ ] **Step 4: Run test + full suite + typecheck**

Run (from `service/`): `node --import tsx --test tests/ms365-device-config.test.ts` → PASS
Run (from `service/`): `npm test` → PASS (your ms365 tests pass; only the known ~20 pre-existing failures remain; NO new failures)
Run (from repo root): `npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/composition/compose-service.ts service/src/ms365/index.ts service/tests/ms365-device-config.test.ts
git commit -m "feat(ms365): wire device provider from CGHC_MS365_CLIENT_ID/TENANT env"
```

---

## Task 4: Service-client methods

**Files:**
- Modify: `app/ui/src/service-client.ts`
- Test: `app/ui/tests/ms365-service-client.test.ts` (confirm UI test dir at Step 2; if UI tests live elsewhere, follow the repo convention)

**Interfaces:**
- Consumes: the four routes (`/v1/ms365/connect`, `/v1/ms365/view`, `/v1/ms365/device/begin`, `/v1/ms365/device/poll`) and the `call<T>(path, init?)` helper already in `service-client.ts` (POST = `{ method: "POST", body: JSON.stringify(...) }`).
- Produces (on the `ServiceClient` interface + factory):
  - `connectMs365Token(token: string): Promise<Ms365ViewData>`
  - `fetchMs365View(): Promise<Ms365ViewData>`
  - `beginMs365Device(): Promise<{ userCode: string; verificationUri: string; expiresInSec: number } | { error: "not_configured" }>`
  - `pollMs365Device(): Promise<{ status: "pending" | "connected" | "expired"; view?: Ms365ViewData }>`
  - A local `Ms365ViewData` type mirroring the service shape (`{ connectionState, services, scopes, actionHistory, error? }`) — declared in service-client, NOT imported from the service (renderer must not import service code).

- [ ] **Step 1: Write the failing test**

```ts
// app/ui/tests/ms365-service-client.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServiceClient } from "../src/service-client.js";

function stubFetch(routes: Record<string, unknown>) {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string, init?: { method?: string }) => {
    const path = new URL(url).pathname;
    seen.push(`${init?.method ?? "GET"} ${path}`);
    return { json: async () => ({ protocol: 1, ok: true, data: routes[path] }) } as unknown as Response;
  }) as unknown as typeof fetch;
  return seen;
}

test("beginMs365Device posts to device/begin and returns prompt", async () => {
  const seen = stubFetch({ "/v1/ms365/device/begin": { userCode: "AB", verificationUri: "u", expiresInSec: 900 } });
  const client = createServiceClient("http://127.0.0.1:9/", "tok");
  const r = await client.beginMs365Device();
  assert.deepEqual(r, { userCode: "AB", verificationUri: "u", expiresInSec: 900 });
  assert.ok(seen.includes("POST /v1/ms365/device/begin"));
});

test("pollMs365Device returns status", async () => {
  stubFetch({ "/v1/ms365/device/poll": { status: "pending" } });
  const client = createServiceClient("http://127.0.0.1:9/", "tok");
  assert.deepEqual(await client.pollMs365Device(), { status: "pending" });
});
```

> Confirm `BOUNDARY_PROTOCOL_VERSION` value at Step 2 (the stub uses `protocol: 1`); set the stub's `protocol` field to the real constant so `call<T>` doesn't throw `protocol_mismatch`. Import it or read it from `@cowork-ghc/contracts`.

- [ ] **Step 2: Run test to verify it fails (and confirm protocol constant + UI test dir)**

Run (from repo root): `node --import tsx --test app/ui/tests/ms365-service-client.test.ts`
Expected: FAIL — methods not on the client. While here, confirm `BOUNDARY_PROTOCOL_VERSION` and adjust the stub; confirm UI tests run from this path (else use the repo's UI test location).

- [ ] **Step 3: Implement** the four methods in the client factory + interface, mirroring existing methods (e.g. `connectMs365Token: async (token) => call<Ms365ViewData>("/v1/ms365/connect", { method: "POST", body: JSON.stringify({ token }) })`). Declare the local `Ms365ViewData` type.

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `node --import tsx --test app/ui/tests/ms365-service-client.test.ts` → PASS; `npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add app/ui/src/service-client.ts app/ui/tests/ms365-service-client.test.ts
git commit -m "feat(ui): MS365 service-client methods (connect/view/device)"
```

---

## Task 5: Rewrite ms-connect-view (3 states + manual fallback)

**Files:**
- Modify: `app/ui/src/ui-shell/microsoft/ms-connect-view.ts`
- Modify: `app/ui/src/ui-shell/microsoft/microsoft-view.ts` (pass the client + a re-render callback into the connect view)
- Test: `app/ui/tests/ms-connect-view.test.ts`

**Interfaces:**
- Consumes: service-client methods (Task 4); `MicrosoftIntegrationView`/`Ms365ViewData` shape.
- Produces: `renderMsConnect(container, deps)` where `deps = { view: Ms365ViewData; client: Ms365ConnectClient; onViewChange(view): void }` and `Ms365ConnectClient` is the minimal slice of the service client the view needs (`connectMs365Token`, `beginMs365Device`, `pollMs365Device`, `fetchMs365View`). The view owns local `mode`/`deviceCode`/timer state; connection truth comes from `view`/`onViewChange`.

- [ ] **Step 1: Write the failing test** (render states + gating; use a fake client)

```ts
// app/ui/tests/ms-connect-view.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMsConnect } from "../src/ui-shell/microsoft/ms-connect-view.js";

function fakeClient(over = {}) {
  return {
    connectMs365Token: async () => ({ connectionState: "connected", services: [], scopes: [], actionHistory: [] }),
    beginMs365Device: async () => ({ userCode: "ABCD", verificationUri: "https://microsoft.com/devicelogin", expiresInSec: 900 }),
    pollMs365Device: async () => ({ status: "pending" as const }),
    fetchMs365View: async () => ({ connectionState: "disconnected", services: [], scopes: [], actionHistory: [] }),
    ...over,
  };
}
function container() { return document.createElement("div"); }

test("disconnected renders device sign-in button enabled + manual fallback", () => {
  const c = container();
  renderMsConnect(c, { view: { connectionState: "disconnected", services: [], scopes: [], actionHistory: [] }, client: fakeClient(), onViewChange: () => {} });
  assert.ok(c.querySelector(".ms-connect__signin"));
  assert.equal((c.querySelector(".ms-connect__signin") as HTMLButtonElement).disabled, false);
  assert.ok(c.querySelector(".ms-connect__manual")); // fallback expander present
});

test("device begin returning not_configured disables the button with a note", async () => {
  const c = container();
  renderMsConnect(c, { view: { connectionState: "disconnected", services: [], scopes: [], actionHistory: [] }, client: fakeClient({ beginMs365Device: async () => ({ error: "not_configured" as const }) }), onViewChange: () => {} });
  (c.querySelector(".ms-connect__signin") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(c.textContent ?? "", /app registration|nhờ IT|chưa cấu hình/i);
});

test("connected view shows the connected summary", () => {
  const c = container();
  renderMsConnect(c, { view: { connectionState: "connected", services: [{ id: "sharepoint", label: "SharePoint", connected: true }], scopes: ["Sites.Read.All"], actionHistory: [] }, client: fakeClient(), onViewChange: () => {} });
  assert.ok(c.querySelector(".ms-connect__summary"));
});
```

> Confirm the UI test harness provides a DOM (`document`). If the repo's UI tests use jsdom/happy-dom or a helper, follow that convention (check an existing `app/ui/tests/*.test.ts`). Adjust imports accordingly at Step 2.

- [ ] **Step 2: Run test to verify it fails (and confirm UI DOM harness)**

Run (from repo root): `node --import tsx --test app/ui/tests/ms-connect-view.test.ts`
Expected: FAIL. Confirm how existing UI tests get a DOM; mirror it.

- [ ] **Step 3: Implement** the rewrite:
  - `renderMsConnect(container, deps)` renders by `deps.view.connectionState`: `connected` → existing summary; else the disconnected card.
  - Disconnected card: device sign-in button (enabled). On click → `client.beginMs365Device()`; if `{ error: "not_configured" }` → disable button + show honest note ("Cần app registration — nhờ IT cấu hình `CGHC_MS365_CLIENT_ID`"); else enter `device_pending`.
  - Manual fallback: a `.ms-connect__manual` expander with a token `<input>` + "Kết nối bằng token" → `client.connectMs365Token(token)` → `deps.onViewChange(view)`.
  - `device_pending`: show `userCode` (copyable), a "Sao chép liên kết" button for `verificationUri` (copy-to-clipboard — NO openExternal bridge exists), then poll `client.pollMs365Device()` every 5s. `connected` → `onViewChange(result.view)` + stop timer; `expired` → note + back to disconnected + stop; keep polling on `pending`. Guard against overlapping polls and clear the timer on re-render/unmount.
  - Keep the existing scope-list rendering.
- Wire in `microsoft-view.ts`: pass the real service client + an `onViewChange` that re-renders the surface with the new view.

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `node --import tsx --test app/ui/tests/ms-connect-view.test.ts` → PASS; `npm run typecheck` → PASS; `npm run build:renderer` → PASS

- [ ] **Step 5: Commit**

```bash
git add app/ui/src/ui-shell/microsoft/ms-connect-view.ts app/ui/src/ui-shell/microsoft/microsoft-view.ts app/ui/tests/ms-connect-view.test.ts
git commit -m "feat(ui): wire MS365 connect view to backend (manual + device-code)"
```

---

## Task 6: IT request document

**Files:**
- Create: `docs/integration/ms365-it-request.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write the doc** (Vietnamese body, English identifiers). Include, as a checklist an IT admin can act on:
  - Mục đích: 1–2 câu (Cowork GHC cần app registration để user đăng nhập MS365 bằng device-code, delegated).
  - Loại app: **public client** (không client secret).
  - Platform: **Mobile and desktop applications**; redirect URI cho device-code không bắt buộc.
  - **Allow public client flows = Yes** (Authentication → Advanced settings) — bắt buộc.
  - Delegated API permissions (Microsoft Graph): `User.Read`, `Sites.Read.All`, `Files.ReadWrite.All` (slice hiện tại) + danh sách mở rộng cho sau: `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `Tasks.ReadWrite`, `ChannelMessage.Send`, `offline_access`.
  - **Admin consent**: bấm "Grant admin consent" nếu tenant yêu cầu.
  - Trả về cho team: **Application (client) ID** + **Directory (tenant) ID**, đặt vào env `CGHC_MS365_CLIENT_ID` / `CGHC_MS365_TENANT`.
  - Lưu ý bảo mật: token lưu Windows Credential Manager, không nằm trong UI/log; mọi hành động ghi qua phê duyệt (permission modal).
  - Frontmatter: `language: "vi"`.

- [ ] **Step 2: Commit**

```bash
git add docs/integration/ms365-it-request.md
git commit -m "docs(integration): MS365 Azure app registration request for IT"
```

---

## Task 7: Packaged verification + status update

**Files:**
- Modify: `tools/verify/ui-shell-v3-production-screenshots.mjs` (extend the existing microsoft-connect capture to assert the wired card: device button + manual fallback present)
- Modify: `docs/product/current-status.md`
- Modify: `docs/integration/external-systems-integration-readiness.md`

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Build + package + run verifier**

Run (from repo root): `npm run build:renderer` → PASS; `npm run typecheck` → PASS.
Run: `npm run package:win` then `node tools/verify/ui-shell-v3-production-screenshots.mjs` → exit 0. (If a prior packaged app is running and locks the exe, stop it via `scripts\stop.bat` first.) Confirm `microsoft-connect.png` shows the device sign-in card + manual fallback rendered in the main area.

- [ ] **Step 2: Extend the verifier assertion** for the microsoft-connect capture to check the device sign-in button exists and (with no env configured) is either enabled-or-disabled-with-note honestly, and that the manual fallback (`.ms-connect__manual`) is present. Keep the assertion honest — do not assert a live connection.

- [ ] **Step 3: Update `docs/product/current-status.md`** (Vietnamese): record the wiring slice — manual token connects for real; device-code wired but requires `CGHC_MS365_CLIENT_ID`/`CGHC_MS365_TENANT` (gated honest until IT provisions the app); **remove** the stale "UI chưa nối backend" limitation and replace with the remaining honest limitations (device-code needs IT app registration; OpenCode child tool-consumption still unverified end-to-end; no live tenant run).

- [ ] **Step 4: Update D2 intake** (`external-systems-integration-readiness.md` §5): auth model now has device-code wired (gated), UI connect is real, disconnect/revocation reflected in view.

- [ ] **Step 5: Commit**

```bash
git add tools/verify/ui-shell-v3-production-screenshots.mjs docs/product/current-status.md docs/integration/external-systems-integration-readiness.md reports/ui-shell-v3-commercial-readiness/
git commit -m "docs(product): record MS365 UI wiring slice + refresh evidence"
```

---

## Task 8 (OPTIONAL): Native openExternal for the verification URL

Only do this if the Product Owner wants the "Mở trang Microsoft" button to open the system browser directly instead of copy-to-clipboard. This is a NATIVE SHELL change (new capability) — requires care; the flow works without it (Task 5 uses copy).

**Files:**
- Modify: `app/shell/src/ipc/channels.ts` (add `OpenExternal`), `app/shell/src/ipc/bridge.ts`, `app/shell/src/ipc/register-handlers.ts` (handler validates the URL is `https://microsoft.com/devicelogin` or the exact `verificationUri` from a begin response — reject anything else), `app/ui/src/bridge.ts` (add `openExternal` to the bridge type), `app/ui/src/ui-shell/microsoft/ms-connect-view.ts` (use it when available, fall back to copy).
- Test: shell IPC handler test asserting a non-allowlisted URL is refused.

**Interfaces:**
- Produces: `openExternal(url: string): Promise<void>` on the shell bridge; handler uses Electron `shell.openExternal` ONLY after allowlist validation (never open an arbitrary URL from the renderer).

- [ ] **Step 1–5:** TDD the handler (allowlist test first — reject `https://evil.example`), implement the IPC channel + handler + bridge method, wire the UI to prefer `openExternal` and fall back to copy, verify `npm run typecheck` + build, commit `feat(shell): validated openExternal for MS365 device login`.

---

## Self-Review

**1. Spec coverage:**
- Manual token connect (works now) → Task 4 (`connectMs365Token`) + Task 5 (fallback UI). ✓
- Device-code wired, env-gated → Task 1 (connector capability), Task 2 (routes), Task 3 (env→provider), Task 5 (UI flow). ✓
- UI-driven poll (Option A) → Task 2 (poll route returns status), Task 5 (5s poll, stop conditions). ✓
- 3 UI states + honest `not_configured` gate → Task 5. ✓
- Env config `CGHC_MS365_CLIENT_ID`/`CGHC_MS365_TENANT`, no hardcode → Task 3. ✓
- Secrets never in UI/log/response; token only keyring+memory → Global Constraints; Task 5 test asserts no token in state; connector returns only `view`. ✓
- Token-guarded routes → Task 2 test. ✓
- IT request doc → Task 6. ✓
- Packaged evidence + status/intake update → Task 7. ✓
- Feature flag OFF default preserved → Task 3 (wiring inside existing flag branch). ✓

**2. Placeholder scan:** No TBD/TODO. Two documented "confirm at Step 2" items (UI test DOM harness location; `BOUNDARY_PROTOCOL_VERSION` value) are verification-of-existing-repo-facts, not placeholders — the behavior is fully specified and the implementer adjusts an import if a name differs. Task 5's UI body is prose+spec (large DOM-building file) with the exact classes/behaviors/states enumerated and the test pinning behavior — implementers write complete code, no runtime placeholders.

**3. Type consistency:** `Ms365ViewData` shape identical across Tasks 2/4/5 (`{ connectionState, services, scopes, actionHistory, error? }`). Connector methods `beginDeviceCode/pollDeviceCode/deviceConfigured` stable across Tasks 1/2. Poll status union `"pending" | "connected" | "expired"` consistent across Tasks 1/2/4/5. Service-client method names (`connectMs365Token/beginMs365Device/pollMs365Device/fetchMs365View`) identical across Tasks 4/5.

**Correction from grounding (flagged for the implementer):** the spec assumed `Ms365Connector.connectWithDeviceCode` existed; it does NOT. Task 1 adds the capability. And there is NO `openExternal` shell bridge — Task 5 uses copy-to-clipboard; native open is optional Task 8.
