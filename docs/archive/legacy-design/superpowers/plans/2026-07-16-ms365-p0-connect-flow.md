# MS365 P0 Connect Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect Microsoft 365 with a manual access token (and disconnect), wiring the existing backend connect/disconnect routes to the MS365 tab so the composer unlocks and MS365 chat/tools run end-to-end.

**Architecture:** Pure UI wiring — the backend (`connectWithToken`/`disconnect`/`buildMs365View` + routes `POST /v1/ms365/connect`, `POST /v1/ms365/disconnect`) already exists and is untouched. Add `connectMs365`/`disconnectMs365` to the service-client (the route returns a `Ms365ViewData` that is structurally identical to the renderer's `MicrosoftIntegrationView`, so no field remapping is needed), turn the disabled sign-in card into a manual-token form + a disconnect button, and thread `onConnect`/`onDisconnect` handlers through `microsoft-view` into `app-shell`, which updates `state.ms365View` from the response and (on disconnect) also calls `ms365Chat.disconnect()` to revoke the session scope.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), vanilla-TS renderer, `node:test` via tsx.

## Global Constraints

- The Microsoft access token is a SECRET: it is passed exactly once into the `POST /v1/ms365/connect` body and never stored in UI state, logs, or the DOM after send. The input is cleared the moment Connect is pressed. (spec §2)
- `Ms365ViewData` (service) and `MicrosoftIntegrationView` (renderer) are structurally identical (`connectionState` 5-value union, `services {id,label,connected}[]`, `scopes string[]`, `actionHistory {label,source,at?}[]`, `error?`) — a direct `call<MicrosoftIntegrationView>` works; add a mapper ONLY if a field genuinely differs. (spec §4A)
- View state updates come from the connect/disconnect RESPONSE only — no polling, no `GET /view` on open. (spec §2)
- The Disconnect button calls BOTH `disconnectMs365()` AND `ms365Chat.disconnect()` (revoke `Ms365SessionScope` + close stream + clear session). Fail-safe: reset the UI to disconnected even if one call throws. (spec §2, §6)
- The composer stays gated on `connectionState === "connected"` (existing Task-6 behavior) — do NOT change that gate.
- Renderer never touches the DB or secret bytes. ESM `.js` imports; `node:test` + `node:assert/strict`.
- Do NOT touch: `ms365-connector.ts`, `ms365-tool-router.ts` routes, `ms365-chat-controller.ts` internals (only CALL its existing `disconnect()`), session-scope, provider, supervisor.
- Commands: `npm run typecheck` (tsc -b), `npm test` (node --test via tsx), `scripts\verify-fast.bat`. NOTE: `npm test` has ~16 files of KNOWN pre-existing failures — confirm NO NEW failures, not a fully green suite.

---

## File Structure

- `app/ui/src/service-client.ts` — **Modify.** Add `connectMs365(token)` + `disconnectMs365()` to the `ServiceClient` interface + impl.
- `app/ui/src/ui-shell/microsoft/ms-connect-view.ts` — **Modify.** Replace the disabled sign-in card with a manual-token form; add a disconnect button to the connected summary; accept handlers.
- `app/ui/src/ui-shell/microsoft/microsoft-view.ts` — **Modify.** Extend `MicrosoftSurfaceHandlers` with `onConnect`/`onDisconnect`; pass them to `renderMsConnect`.
- `app/ui/src/app-shell.ts` — **Modify.** `onMs365Connect`/`onMs365Disconnect` handlers; update `state.ms365View` from responses; disconnect also calls `ms365Chat.disconnect()` + resets transcript state.
- Tests: `app/ui/tests/service-client-ms365.test.ts` (extend — already exists from prior work), `app/ui/tests/ms-connect-view.test.ts` (new).

---

## Task 1: Service-client `connectMs365` + `disconnectMs365`

**Files:**
- Modify: `app/ui/src/service-client.ts`
- Test: `app/ui/tests/service-client-ms365.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: the `call<T>(path, init?)` helper + the existing global-fetch-stub test harness in `service-client-ms365.test.ts`.
- Produces on `ServiceClient`:
  - `connectMs365(token: string): Promise<MicrosoftIntegrationView>` → POST `/v1/ms365/connect` body `{ token }`.
  - `disconnectMs365(): Promise<MicrosoftIntegrationView>` → POST `/v1/ms365/disconnect` body `{}`.

- [ ] **Step 1: Confirm the view shapes match** (no code — a 2-minute read that decides whether a mapper is needed).

Run: `grep -n "interface Ms365ViewData" -A12 service/src/ms365/ms365-view.ts` and compare to `MicrosoftIntegrationView` in `app/ui/src/integration-slots.ts:47-53`.
Expected: identical field names/types (`connectionState`, `services`, `scopes`, `actionHistory`, `error?`). If identical → `call<MicrosoftIntegrationView>` directly (Step 3 below). If a field differs → add a `mapMs365View(raw): MicrosoftIntegrationView` in service-client and note the divergence in your report.

- [ ] **Step 2: Write the failing tests** — append to `app/ui/tests/service-client-ms365.test.ts`:

```typescript
test("connectMs365 POSTs the token to /v1/ms365/connect and returns the view", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch = async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return new Response(
      JSON.stringify({ ok: true, data: { connectionState: "connected", services: [], scopes: ["User.Read"], actionHistory: [] } }),
      { status: 200 },
    );
  };
  const client = makeClient(fakeFetch); // reuse the existing harness helper in this file
  const view = await client.connectMs365("eyJ.fake.token");
  assert.equal(view.connectionState, "connected");
  const call = calls.find((c) => c.url.includes("/v1/ms365/connect"));
  assert.ok(call, "hit the connect route");
  assert.deepEqual(call!.body, { token: "eyJ.fake.token" });
});

test("disconnectMs365 POSTs to /v1/ms365/disconnect and returns the view", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    return new Response(
      JSON.stringify({ ok: true, data: { connectionState: "disconnected", services: [], scopes: [], actionHistory: [] } }),
      { status: 200 },
    );
  };
  const client = makeClient(fakeFetch);
  const view = await client.disconnectMs365();
  assert.equal(view.connectionState, "disconnected");
  assert.ok(calls.some((u) => u.includes("/v1/ms365/disconnect")));
});
```

> NOTE: reuse the EXACT client-construction helper the existing tests in this file use (the file already builds a client with a global-fetch stub — mirror it; the sketch above calls it `makeClient` but use the real helper name/shape present in the file).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test app/ui/tests/service-client-ms365.test.ts`
Expected: FAIL — `connectMs365`/`disconnectMs365` not a function.

- [ ] **Step 4: Add to the `ServiceClient` interface** — in `app/ui/src/service-client.ts`, near `setMs365SessionScope`:

```typescript
  /** Connect Microsoft 365 with a manual access token (Microsoft 365 tab). Returns the fresh view. */
  connectMs365(token: string): Promise<MicrosoftIntegrationView>;
  /** Disconnect Microsoft 365. Returns the fresh (disconnected) view. */
  disconnectMs365(): Promise<MicrosoftIntegrationView>;
```

Ensure `MicrosoftIntegrationView` is imported in this file (from `./integration-slots.js`); add the import if absent.

- [ ] **Step 5: Implement** — in the client impl object, near `setMs365SessionScope`:

```typescript
    connectMs365: (token) =>
      call<MicrosoftIntegrationView>("/v1/ms365/connect", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),

    disconnectMs365: () =>
      call<MicrosoftIntegrationView>("/v1/ms365/disconnect", {
        method: "POST",
        body: "{}",
      }),
```

> NOTE: if Step 1 found a shape divergence, wrap the `call` result in your `mapMs365View(...)` instead of casting directly.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx tsx --test app/ui/tests/service-client-ms365.test.ts && npm run typecheck`
Expected: PASS + GREEN.

- [ ] **Step 7: Commit**

```bash
git add app/ui/src/service-client.ts app/ui/tests/service-client-ms365.test.ts
git commit -m "feat(ui): service-client connectMs365 + disconnectMs365

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Manual-token form + disconnect button in `ms-connect-view`

**Files:**
- Modify: `app/ui/src/ui-shell/microsoft/ms-connect-view.ts`
- Modify: `app/ui/src/ui-shell/microsoft/microsoft-view.ts` (extend handlers + pass to `renderMsConnect`)
- Test: `app/ui/tests/ms-connect-view.test.ts` (new)

**Interfaces:**
- Consumes: `MicrosoftIntegrationView` (view), a new `MsConnectHandlers`.
- Produces:
  - `MsConnectHandlers { onConnect(token: string): void; onDisconnect(): void }`.
  - `renderMsConnect(container, view, handlers: MsConnectHandlers): void` — sign-in card becomes a token form when not connected; connected summary gains a Disconnect button.
  - `MicrosoftSurfaceHandlers` extended with `onConnect(token: string): void` and `onDisconnect(): void`.

- [ ] **Step 1: Write the failing test** — create `app/ui/tests/ms-connect-view.test.ts` (mirror how other `app/ui/tests` DOM tests set up `setup-dom.js` / a document):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import "../tests/setup-dom.js"; // use the real DOM-setup import the other ui tests use
import { renderMsConnect } from "../src/ui-shell/microsoft/ms-connect-view.js";
import type { MicrosoftIntegrationView } from "../src/integration-slots.js";

const DISCONNECTED: MicrosoftIntegrationView = {
  connectionState: "disconnected", services: [], scopes: [], actionHistory: [],
};
const CONNECTED: MicrosoftIntegrationView = {
  connectionState: "connected", services: [], scopes: ["User.Read"], actionHistory: [],
};

test("disconnected: Connect is disabled until a token is entered, then fires onConnect + clears input", () => {
  const container = document.createElement("div");
  let connectedWith: string | null = null;
  renderMsConnect(container, DISCONNECTED, { onConnect: (t) => { connectedWith = t; }, onDisconnect: () => {} });
  const input = container.querySelector("input") as HTMLInputElement;
  const connectBtn = container.querySelector("button") as HTMLButtonElement;
  assert.ok(input, "token input present");
  assert.equal(connectBtn.disabled, true, "Connect disabled when empty");
  input.value = "eyJ.fake";
  input.dispatchEvent(new Event("input"));
  assert.equal(connectBtn.disabled, false, "Connect enabled after typing");
  connectBtn.click();
  assert.equal(connectedWith, "eyJ.fake", "onConnect got the token");
  assert.equal(input.value, "", "token input cleared after connect");
});

test("connected: shows a Disconnect button that fires onDisconnect", () => {
  const container = document.createElement("div");
  let disconnected = false;
  renderMsConnect(container, CONNECTED, { onConnect: () => {}, onDisconnect: () => { disconnected = true; } });
  const btns = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
  const disconnectBtn = btns.find((b) => /ngắt/i.test(b.textContent ?? ""));
  assert.ok(disconnectBtn, "Disconnect button present when connected");
  disconnectBtn!.click();
  assert.equal(disconnected, true);
});

test("error: renders view.error text", () => {
  const container = document.createElement("div");
  renderMsConnect(container, { ...DISCONNECTED, connectionState: "error", error: "Token không hợp lệ" }, { onConnect: () => {}, onDisconnect: () => {} });
  assert.match(container.textContent ?? "", /Token không hợp lệ/);
});
```

> NOTE: verify the real DOM-setup pattern used by existing `app/ui/tests/*.test.ts` (e.g. an import like `./setup-dom.js` or a `happy-dom`/`jsdom` global) and mirror it exactly. If the button-finding selectors don't match the real markup you write, align the test to your markup — but keep the three behaviors asserted (disabled-until-typed + clear-on-send, disconnect button when connected, error text).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test app/ui/tests/ms-connect-view.test.ts`
Expected: FAIL — `renderMsConnect` takes 2 args / no token input.

- [ ] **Step 3: Add the handlers type + rewrite the sign-in card** — in `app/ui/src/ui-shell/microsoft/ms-connect-view.ts`:

Add near the top:
```typescript
export interface MsConnectHandlers {
  readonly onConnect: (token: string) => void;
  readonly onDisconnect: () => void;
}
```

Change the signature:
```typescript
export function renderMsConnect(
  container: HTMLElement,
  view: MicrosoftIntegrationView,
  handlers: MsConnectHandlers,
): void {
```

Replace `renderSignInCard()` with a token-form card (keep the scope list; drop the disabled placeholder button):
```typescript
function renderSignInCard(view: MicrosoftIntegrationView, onConnect: (token: string) => void): HTMLElement {
  const card = el("section", "ms-card ms-connect__signin-card");
  const logoWrap = el("div", "ms-connect__logo");
  logoWrap.append(createMicrosoftLogo(34));

  const input = el("input", "ms-connect__token-input") as HTMLInputElement;
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = "Dán Microsoft access token…";
  input.setAttribute("aria-label", "Microsoft access token");

  const connect = el("button", "ms-connect__signin", "Kết nối") as HTMLButtonElement;
  connect.type = "button";
  connect.disabled = input.value.trim().length === 0;
  input.addEventListener("input", () => {
    connect.disabled = input.value.trim().length === 0;
  });
  const submit = (): void => {
    const token = input.value.trim();
    if (token.length === 0) return;
    input.value = ""; // clear the secret from the DOM immediately
    connect.disabled = true;
    onConnect(token);
  };
  connect.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); submit(); }
  });

  const scopeTitle = el("h3", "ms-section-label", "Quyền sẽ xin khi kết nối");
  const scopeList = el("ul", "ms-scope-list");
  for (const item of MS365_REQUESTED_SCOPES) {
    const li = el("li", "ms-scope-list__item");
    li.append(el("code", "ms-scope-list__scope", item.scope), el("span", "ms-scope-list__note", item.note));
    scopeList.append(li);
  }
  card.append(logoWrap, el("h2", "ms-card__title", "Kết nối Microsoft 365"), input, connect);
  if (view.connectionState === "error" && view.error !== undefined) {
    card.append(el("p", "ms-connect__error", view.error));
  } else if (view.connectionState === "needs_reconnect") {
    card.append(el("p", "ms-connect__error", "Phiên đã hết hạn, hãy kết nối lại."));
  }
  card.append(scopeTitle, scopeList);
  return card;
}
```

In `renderMsConnect`, call the new signatures:
```typescript
  container.replaceChildren();
  const wrap = el("div", "ms-connect");
  if (view.connectionState !== "connected") {
    wrap.append(renderSignInCard(view, handlers.onConnect));
  } else {
    wrap.append(renderConnectedSummary(view, handlers.onDisconnect));
  }
  container.append(wrap);
```

Add a Disconnect button in `renderConnectedSummary(view, onDisconnect)`:
```typescript
function renderConnectedSummary(view: MicrosoftIntegrationView, onDisconnect: () => void): HTMLElement {
  const card = el("section", "ms-card ms-connect__summary");
  card.append(el("h2", "ms-card__title", "Microsoft 365"), el("span", "ms-pill ms-pill--ok", "Đã kết nối"));
  const services = el("div", "ms-service-grid");
  for (const service of view.services) {
    const item = el("div", "ms-service-card");
    item.append(
      el("div", "ms-service-card__name", service.label),
      el("div", "ms-service-card__state", service.connected ? "Đang bật" : "Chờ quyền"),
    );
    services.append(item);
  }
  const scopeList = el("div", "ms-granted-scopes");
  for (const scope of view.scopes) scopeList.append(el("code", "ms-scope-pill", scope));
  const disconnect = el("button", "ms-connect__disconnect", "Ngắt kết nối") as HTMLButtonElement;
  disconnect.type = "button";
  disconnect.addEventListener("click", () => onDisconnect());
  card.append(el("h3", "ms-section-label", "Dịch vụ khả dụng"), services, el("h3", "ms-section-label", "Quyền đã cấp"), scopeList, disconnect);
  return card;
}
```

> NOTE: `MS365_REQUESTED_SCOPES`, `el`, `createMicrosoftLogo` already exist in this file. Keep the existing `oauthNote`/copy if you want, but the disabled placeholder button + its "backend chưa tích hợp" note must be removed (they are now false).

- [ ] **Step 4: Thread handlers through `microsoft-view.ts`** — extend `MicrosoftSurfaceHandlers`:
```typescript
export interface MicrosoftSurfaceHandlers {
  readonly onSend: (text: string) => void;
  readonly onConnect: (token: string) => void;
  readonly onDisconnect: () => void;
}
```
And in `renderMicrosoftSurfaceInternal`, change the connect branch:
```typescript
  } else {
    dom.assistantTranscript = null;
    renderMsConnect(dom.body, view, {
      onConnect: (token) => handlers?.onConnect(token),
      onDisconnect: () => handlers?.onDisconnect(),
    });
  }
```

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `npx tsx --test app/ui/tests/ms-connect-view.test.ts && npm run typecheck`
Expected: PASS + GREEN. (typecheck will flag app-shell not passing `onConnect`/`onDisconnect` yet — that's Task 3; if `renderMicrosoftSurface`'s caller now fails to compile, that is the expected RED for Task 3, note it and proceed.)

- [ ] **Step 6: Commit**

```bash
git add app/ui/src/ui-shell/microsoft/ms-connect-view.ts app/ui/src/ui-shell/microsoft/microsoft-view.ts app/ui/tests/ms-connect-view.test.ts
git commit -m "feat(ui): MS365 connect view — manual-token form + disconnect button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: app-shell wiring (connect/disconnect handlers + scope revoke)

**Files:**
- Modify: `app/ui/src/app-shell.ts`

**Interfaces:**
- Consumes: `ServiceClient.connectMs365`/`disconnectMs365` (Task 1); `MicrosoftSurfaceHandlers.onConnect`/`onDisconnect` (Task 2); the existing `ms365Chat` controller (`disconnect()`), `renderMicrosoftSurface`, `renderMs365Transcript`, `safeError`.
- Produces: MS365 connect/disconnect fully wired; `state.ms365View` reflects the live connection; disconnect revokes the session scope.

- [ ] **Step 1: Pass `onConnect`/`onDisconnect` into `renderMicrosoftSurface`** — in `renderState`, the microsoft branch currently passes `{ onSend }`. Extend it:

```typescript
  } else if (isMicrosoftSurface) {
    renderMicrosoftSurface(dom.microsoftView, state.ms365View, {
      onSend: (text) => handlers.onMs365Send?.(text),
      onConnect: (token) => handlers.onMs365Connect?.(token),
      onDisconnect: () => handlers.onMs365Disconnect?.(),
    });
    renderMs365Transcript(dom, state);
  }
```

And extend the `handlers` param type of `renderState` to include:
```typescript
  onMs365Connect?: (token: string) => void;
  onMs365Disconnect?: () => void;
```

- [ ] **Step 2: Add the handlers in `mountCoworkApp`** — next to the existing `onMs365Send`:

```typescript
    onMs365Connect: (token: string) => {
      void (async () => {
        try {
          state.ms365View = await state.client!.connectMs365(token);
        } catch (error) {
          state.ms365View = { ...MS_DISCONNECTED_VIEW, connectionState: "error", error: safeError(error) };
        }
        renderState(dom, state, handlers);
      })();
    },
    onMs365Disconnect: () => {
      void (async () => {
        // Revoke the tool scope + tear down the chat session FIRST (the security-critical step),
        // then disconnect the Graph connection. Reset UI to disconnected regardless of either result.
        try { await ms365Chat.disconnect(); } catch { /* fail-safe: still reset below */ }
        try { await state.client!.disconnectMs365(); } catch { /* fail-safe */ }
        state.ms365View = MS_DISCONNECTED_VIEW;
        state.ms365UserText = "";
        state.ms365AssistantText = "";
        state.ms365Phase = "idle";
        state.ms365Error = null;
        renderState(dom, state, handlers);
      })();
    },
```

> NOTE: match the real accessor for the client — the existing `onMs365Send` uses `state.client` (nullable). Use the same guard style the file already uses (e.g. if other handlers do `const client = state.client; if (!client) return;`, mirror that instead of `!`). `safeError`, `MS_DISCONNECTED_VIEW`, `ms365Chat` are all already in scope in this function.

- [ ] **Step 3: Typecheck + focused tests + verify-fast**

Run: `npm run typecheck`
Expected: GREEN (the Task-2 caller error is now resolved).

Run: `npx tsx --test app/ui/tests/service-client-ms365.test.ts app/ui/tests/ms-connect-view.test.ts app/ui/tests/ms365-chat-controller.test.ts`
Expected: PASS.

Run: `scripts\verify-fast.bat`
Expected: PASS.

- [ ] **Step 4: Full-suite regression (no NEW failures)**

Run: `npm test`
Expected: only the KNOWN pre-existing failures (per the prior baseline: ~16-17 files incl. `streaming-coalesce.test.ts`, plus `Merge/` glob noise). If any NEW failure lands in a file this plan touched → STOP and fix. Capture the failing-file list.

- [ ] **Step 5: Update status doc + commit** — in `docs/product/current-status.md`, update the MS365 row:

```markdown
| MS365 | PARTIAL — CHAT LIVE | Manual-token connect wires the tab end-to-end; chat via session scoped (Ms365SessionScope); conversation surface=ms365 tách khỏi sidebar; write actions qua permission gate; disconnect revokes scope. Device-code/OAuth deferred. |
```

```bash
git add app/ui/src/app-shell.ts docs/product/current-status.md
git commit -m "feat(ui): wire MS365 connect/disconnect + scope revoke on disconnect

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Packaged acceptance (PO, after Task 3)

Per CLAUDE.md, this unlocks the real end-to-end path. PO checks in the packaged app:
1. MS365 "Kết nối" tab shows a token field; Connect is disabled until a token is pasted.
2. Pasting a valid token → connects; composer in "Trợ lý AI" enables; the token field is cleared.
3. A prompt streams a reply; a prompt that triggers an MS365 tool actually calls the tool; a write action shows the permission card.
4. "Ngắt kết nối" disconnects, disables the composer, and (verify in logs/behavior) the session can no longer call MS365 tools (scope revoked).
5. An invalid token shows an honest error and leaves the composer disabled.

## Self-Review notes

- **Spec §4A (service-client):** Task 1. **§4B (connect view):** Task 2. **§4C (microsoft-view):** Task 2. **§4D (app-shell):** Task 3.
- **§2 token-cleared-on-send:** Task 2 Step 3 (`input.value = ""` before `onConnect`) + Task 2 test asserts it.
- **§2 view-from-response:** Task 1 returns the view; Task 3 sets `state.ms365View` from it — no polling/GET-on-open added.
- **§2/§6 disconnect calls BOTH + fail-safe:** Task 3 Step 2 (`ms365Chat.disconnect()` then `disconnectMs365()`, each in its own try, UI reset regardless).
- **§6 error handling:** Task 3 connect-catch sets `connectionState:"error"`; Task 2 renders `view.error`; empty-token gated by disabled button (Task 2).
- **Mapper decision:** shapes verified structurally identical in Global Constraints; Task 1 Step 1 re-confirms and only adds a mapper if a field diverges — no speculative mapper.
- **Type consistency:** `connectMs365(token): Promise<MicrosoftIntegrationView>`, `disconnectMs365(): Promise<MicrosoftIntegrationView>`, `MsConnectHandlers {onConnect,onDisconnect}` used identically across Tasks 1-3.
- **Known risk flagged to implementers:** the exact DOM-test setup import and the real `state.client` guard style must be read from existing code (Task 2/3 notes) — don't guess.
