# MS365 follow-up: composer running-gate (#1) + history highlight (#3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block sending a new MS365 turn while one is streaming (guard + visually disable composer), and highlight the active conversation in the MS365 sidebar.

**Architecture:** UI-only. Change `renderMsAssistant` to return composer refs (send button, input, chips) so `renderMs365Transcript` can toggle their `.disabled` by `ms365Phase` without rebuilding the composer. Add a guard to `onMs365Send`. Pass `ms365ActiveConversationId` into the sidebar to mark the active item.

**Tech Stack:** TypeScript, DOM (`el` helper), `node --test` via `tsx`.

## Global Constraints

- UI-only: touch `app/ui/src/app-shell.ts`, `app/ui/src/ui-shell/microsoft/ms-assistant-view.ts`, `app/ui/src/ui-shell/microsoft/microsoft-view.ts`, `app/ui/src/ui-shell/microsoft/microsoft.css`. NO backend / contract / controller / permission change.
- The functional block is the guard in `onMs365Send`; the disable is UX on top. Both required.
- Disable via toggling `.disabled` on stored refs inside `renderMs365Transcript` — do NOT rebuild the composer during a turn (avoids focus/scroll thrash).
- The active-conversation highlight uses `state.ms365ActiveConversationId`; the "New conversation" path sets it to `null` → no item highlighted.
- `renderMsAssistant`'s only caller is `renderMicrosoftSurfaceInternal` in `microsoft-view.ts` — update it when the return type changes; do not leave a second caller broken.
- Gate = focused tests pass + typecheck GREEN. Do NOT run the full suite (pre-existing failures + `Merge/` glob noise). Commit on `main` per user consent; do not push. When staging, add named files only — never `git add -A`/`.` (there is an untracked `Merge/` dir that must never be committed).

---

### Task 1: Composer running-gate (#1) — guard + disable send/input/chips

**Files:**
- Modify: `app/ui/src/ui-shell/microsoft/ms-assistant-view.ts` (renderComposer + renderMsAssistant return composer refs)
- Modify: `app/ui/src/ui-shell/microsoft/microsoft-view.ts` (MicrosoftViewDom composer-ref fields; store them)
- Modify: `app/ui/src/app-shell.ts` (guard onMs365Send; toggle disabled in renderMs365Transcript)
- Test: `app/ui/tests/ms-assistant-view.test.ts` (add cases; create if absent, matching repo DOM-test pattern)

**Interfaces:**
- Produces:
  - `renderComposer(enabled, onSend)` returns `{ root: HTMLElement; send: HTMLButtonElement; input: HTMLTextAreaElement; chips: readonly HTMLButtonElement[] }` (was: `HTMLElement`).
  - `renderMsAssistant(...)` returns `{ transcript: HTMLElement; composer: { send: HTMLButtonElement; input: HTMLTextAreaElement; chips: readonly HTMLButtonElement[] } | null }` (null in the disconnected empty-state where a composer with `enabled:false` is still built — see note). (was: `HTMLElement`).
  - `MicrosoftViewDom` gains `msComposer: { send: HTMLButtonElement; input: HTMLTextAreaElement; chips: readonly HTMLButtonElement[] } | null`.

- [ ] **Step 1: Write the failing tests**

Create/extend `app/ui/tests/ms-assistant-view.test.ts`. First read an existing DOM test in `app/ui/tests/` to match how the repo builds a container/`document`. Use these cases (adapt the container helper to the repo pattern):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMsAssistant } from "../src/ui-shell/microsoft/ms-assistant-view.js";
import type { MicrosoftIntegrationView } from "../src/integration-slots.js";

const CONNECTED = { connectionState: "connected" } as unknown as MicrosoftIntegrationView;
const noopHandlers = {
  onOpenConnect: () => {},
  onSend: () => {},
  onSelectConversation: () => {},
  onNewConversation: () => {},
};

test("renderMsAssistant returns composer refs when connected", () => {
  const container = document.createElement("div");
  const result = renderMsAssistant(container, CONNECTED, noopHandlers, [], null);
  assert.ok(result.composer !== null, "connected → composer refs present");
  assert.ok(result.composer!.send instanceof HTMLButtonElement);
  assert.ok(result.composer!.input instanceof HTMLTextAreaElement);
  assert.ok(Array.isArray(result.composer!.chips));
});
```

- [ ] **Step 2: Run test — verify FAIL**

Run: `npx tsx --test app/ui/tests/ms-assistant-view.test.ts`
Expected: FAIL (renderMsAssistant currently returns an HTMLElement, so `.composer` is undefined).

- [ ] **Step 3: renderComposer returns refs**

In `ms-assistant-view.ts`, change `renderComposer` (currently `function renderComposer(enabled, onSend): HTMLElement`) to return refs. Replace its signature + return:

```ts
function renderComposer(
  enabled: boolean,
  onSend: (text: string) => void,
): { root: HTMLElement; send: HTMLButtonElement; input: HTMLTextAreaElement; chips: readonly HTMLButtonElement[] } {
  const composer = el("div", "ms-composer");
  const chipsWrap = el("div", "ms-composer__chips");
  const chips: HTMLButtonElement[] = [];
  for (const suggestion of SUGGESTIONS) {
    const chip = el("button", "ms-composer__chip", suggestion) as HTMLButtonElement;
    chip.type = "button";
    chip.disabled = !enabled;
    chip.addEventListener("click", () => {
      if (chip.disabled) return;
      onSend(suggestion);
    });
    chips.push(chip);
    chipsWrap.append(chip);
  }
  const inputRow = el("div", "ms-composer__row");
  const input = el("textarea", "ms-composer__input") as HTMLTextAreaElement;
  input.rows = 1;
  input.placeholder = "Hỏi trợ lý về Microsoft 365…";
  input.setAttribute("aria-label", "Soạn yêu cầu Microsoft 365");
  input.disabled = !enabled;
  const send = el("button", "ms-composer__send") as HTMLButtonElement;
  send.type = "button";
  send.setAttribute("aria-label", "Gửi yêu cầu");
  send.textContent = "➤";
  send.disabled = !enabled;
  const submit = (): void => {
    if (send.disabled) return;
    const text = input.value.trim();
    if (text.length === 0) return;
    input.value = "";
    onSend(text);
  };
  send.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  inputRow.append(input, send);
  const hint = el(
    "p",
    "ms-composer__hint",
    "Hành động ghi (gửi mail, đăng Teams…) luôn cần phê duyệt trước khi thực thi qua Microsoft Graph.",
  );
  composer.append(chipsWrap, inputRow, hint);
  return { root: composer, send, input, chips };
}
```

Note vs current code: chips previously had no click handler (dead) — this wires them to `onSend(suggestion)` gated by `chip.disabled`, and the submit gate now reads `send.disabled` (so the transcript-level disable also blocks Enter/click). This is a deliberate, in-scope improvement that makes the disable authoritative for every send path.

- [ ] **Step 4: renderMsAssistant returns transcript + composer refs**

In `ms-assistant-view.ts`, change `renderMsAssistant` return type to
`{ transcript: HTMLElement; composer: { send: HTMLButtonElement; input: HTMLTextAreaElement; chips: readonly HTMLButtonElement[] } | null }`.
Capture the `renderComposer(...)` result in both branches:

```ts
  if (view.connectionState !== "connected") {
    // …empty-state card as today…
    const composer = renderComposer(false, handlers.onSend);
    transcript.append(card);
    column.append(transcript, composer.root);
    layout.append(column);
    container.append(layout);
    return { transcript, composer: { send: composer.send, input: composer.input, chips: composer.chips } };
  }
  const sidebar = renderMs365Sidebar(conversations, handlers, activeId);
  const composer = renderComposer(true, handlers.onSend);
  column.append(transcript, composer.root);
  layout.append(sidebar, column);
  container.append(layout);
  return { transcript, composer: { send: composer.send, input: composer.input, chips: composer.chips } };
```

(`renderMs365Sidebar` gains an `activeId` param in Task 2; for Task 1, add the param with a default of `null` or pass `null` at both call sites here — Task 2 fills in the highlighting. To keep Task 1 self-contained, add `activeId: string | null = null` to `renderMsAssistant`'s signature now and thread it into `renderMs365Sidebar(conversations, handlers, activeId)`; the sidebar can ignore it until Task 2.)

Update `renderMsAssistant` signature to add the trailing param:
`export function renderMsAssistant(container, view, handlers, conversations, activeId: string | null = null): { transcript: HTMLElement; composer: {...} | null }`.

And update `renderMs365Sidebar` signature to accept it (unused until Task 2):
`function renderMs365Sidebar(conversations, handlers, activeId: string | null): HTMLElement` — for Task 1 it may ignore `activeId`.

- [ ] **Step 5: microsoft-view.ts stores composer refs**

In `microsoft-view.ts`:
- Add to `MicrosoftViewDom`:
  ```ts
  msComposer: { send: HTMLButtonElement; input: HTMLTextAreaElement; chips: readonly HTMLButtonElement[] } | null;
  ```
  Initialize `msComposer: null` in `createMicrosoftView`'s `dom` object.
- In `renderMicrosoftSurfaceInternal`, the assistant branch currently does `dom.assistantTranscript = renderMsAssistant(...)`. Change to capture the object:
  ```ts
  const rendered = renderMsAssistant(dom.body, view, { …existing handlers… }, dom.lastConversations, dom.lastActiveConversationId);
  dom.assistantTranscript = rendered.transcript;
  dom.msComposer = rendered.composer;
  ```
  In the connect branch, set `dom.assistantTranscript = null; dom.msComposer = null;`.
- (`dom.lastActiveConversationId` is added in Task 2; for Task 1 pass `null`.)

- [ ] **Step 6: Guard + toggle in app-shell.ts**

In `app-shell.ts`:
- Guard: first line of `onMs365Send`:
  ```ts
  onMs365Send: (text: string) => {
    if (state.ms365Phase === "running") return; // #1 guard: no overlapping turn
    state.ms365Messages.push({ role: "user", text });
    // …unchanged…
  ```
- Toggle: at the end of `renderMs365Transcript`, after the existing status block, add:
  ```ts
  const composer = dom.microsoftView.msComposer;
  if (composer !== null) {
    const connected = state.ms365View.connectionState === "connected";
    const disabled = state.ms365Phase === "running" || !connected;
    composer.send.disabled = disabled;
    composer.input.disabled = disabled;
    for (const chip of composer.chips) chip.disabled = disabled;
  }
  ```

- [ ] **Step 7: Add the guard + toggle tests**

Append to `app/ui/tests/ms-assistant-view.test.ts` a test that the connected composer's send/input start enabled, and (unit for the toggle logic) — since the toggle lives in app-shell and reads `dom.microsoftView.msComposer`, assert the composer refs are togglable:

```ts
test("composer refs are individually disable-able (toggle target for running-gate)", () => {
  const container = document.createElement("div");
  const { composer } = renderMsAssistant(container, CONNECTED, noopHandlers, [], null);
  assert.ok(composer !== null);
  assert.equal(composer!.send.disabled, false);
  composer!.send.disabled = true;
  composer!.input.disabled = true;
  for (const chip of composer!.chips) chip.disabled = true;
  assert.equal(composer!.send.disabled, true);
  assert.equal(composer!.input.disabled, true);
  assert.ok(composer!.chips.every((c) => c.disabled));
});
```

For the guard itself, if an existing test harness exercises `handlers.onMs365Send` (grep app/ui/tests for `onMs365Send`), add a case: set `state.ms365Phase = "running"`, call the handler, assert `ms365Messages` length unchanged and the chat `send` spy not called. If no such harness exists, note in the report that the guard is verified by reading + the toggle test covers the disable; do NOT build a whole app-shell harness for one line.

- [ ] **Step 8: Run tests + typecheck**

Run: `npx tsx --test app/ui/tests/ms-assistant-view.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: GREEN. Confirm no other caller of `renderMsAssistant`/`renderComposer` broke (grep both symbols; only `microsoft-view.ts` should call `renderMsAssistant`, only `renderMsAssistant` calls `renderComposer`).

- [ ] **Step 9: Commit**

```bash
git add app/ui/src/ui-shell/microsoft/ms-assistant-view.ts app/ui/src/ui-shell/microsoft/microsoft-view.ts app/ui/src/app-shell.ts app/ui/tests/ms-assistant-view.test.ts
git commit -m "feat(ms365): guard send + disable composer while a turn is streaming"
```

---

### Task 2: Selected-conversation highlight (#3)

**Files:**
- Modify: `app/ui/src/ui-shell/microsoft/ms-assistant-view.ts` (renderMs365Sidebar marks active item)
- Modify: `app/ui/src/ui-shell/microsoft/microsoft-view.ts` (thread activeId through render + store lastActiveConversationId)
- Modify: `app/ui/src/app-shell.ts` (pass state.ms365ActiveConversationId into renderMicrosoftSurface)
- Modify: `app/ui/src/ui-shell/microsoft/microsoft.css` (.ms-history__item-btn--active)
- Test: `app/ui/tests/ms-assistant-view.test.ts`

**Interfaces:**
- Consumes: `renderMsAssistant(..., activeId)` + `renderMs365Sidebar(conversations, handlers, activeId)` (param added in Task 1).
- Produces: `renderMicrosoftSurface(dom, view, handlers, conversations, activeId?)` (added optional trailing param; default `null`); `MicrosoftViewDom.lastActiveConversationId: string | null`.

- [ ] **Step 1: Write the failing test**

Append to `app/ui/tests/ms-assistant-view.test.ts`:

```ts
test("sidebar marks the active conversation item", () => {
  const container = document.createElement("div");
  const convs = [
    { id: "c1", title: "One" },
    { id: "c2", title: "Two" },
  ];
  renderMsAssistant(container, CONNECTED, noopHandlers, convs, "c2");
  const active = container.querySelectorAll(".ms-history__item-btn--active");
  assert.equal(active.length, 1, "exactly one active item");
  assert.equal((active[0] as HTMLElement).textContent, "Two");
});

test("sidebar marks nothing active when activeId is null", () => {
  const container = document.createElement("div");
  const convs = [{ id: "c1", title: "One" }];
  renderMsAssistant(container, CONNECTED, noopHandlers, convs, null);
  assert.equal(container.querySelectorAll(".ms-history__item-btn--active").length, 0);
});
```

- [ ] **Step 2: Run test — verify FAIL**

Run: `npx tsx --test app/ui/tests/ms-assistant-view.test.ts`
Expected: FAIL (no `--active` class applied yet; both new tests fail).

- [ ] **Step 3: renderMs365Sidebar marks the active item**

In `ms-assistant-view.ts`, in `renderMs365Sidebar`'s loop, when building `btn`, add the active class:

```ts
    const btn = el("button", "ms-history__item-btn", conv.title || "Cuộc trò chuyện") as HTMLButtonElement;
    btn.type = "button";
    if (conv.id === activeId) btn.classList.add("ms-history__item-btn--active");
    btn.addEventListener("click", () => handlers.onSelectConversation(conv.id));
```

(`activeId` is the param added to `renderMs365Sidebar` in Task 1.)

- [ ] **Step 4: Thread activeId through microsoft-view.ts**

In `microsoft-view.ts`:
- Add `lastActiveConversationId: string | null;` to `MicrosoftViewDom`; init `lastActiveConversationId: null` in `createMicrosoftView`.
- `renderMicrosoftSurface(dom, view, handlers, conversations = [], activeId: string | null = null)`: store `dom.lastActiveConversationId = activeId;` alongside `dom.lastConversations = conversations;`.
- In `renderMicrosoftSurfaceInternal`, the `renderMsAssistant(...)` call passes `dom.lastActiveConversationId` as the trailing arg (replace the `null` placeholder left from Task 1 Step 5).

- [ ] **Step 5: Pass activeId from app-shell.ts**

In `app-shell.ts`, the `renderMicrosoftSurface(...)` call (in `renderState`, currently ends with `}, state.ms365Conversations);`) → add the trailing arg:

```ts
    }, state.ms365Conversations, state.ms365ActiveConversationId);
```

- [ ] **Step 6: CSS**

In `app/ui/src/ui-shell/microsoft/microsoft.css`, add near the other `.ms-history__*` rules:

```css
.ms-history__item-btn--active { background: var(--surface-active, #e8edf5); color: #1a2332; font-weight: 600; }
```

(Reuse an existing active/selected token if microsoft.css or shell-frame.css defines one — grep for `--surface-active` / existing selected styles and prefer that; fall back to the literal only if none exists.)

- [ ] **Step 7: Run tests + typecheck**

Run: `npx tsx --test app/ui/tests/ms-assistant-view.test.ts`
Expected: PASS (all cases from Task 1 + Task 2).
Run: `npm run typecheck`
Expected: GREEN.

- [ ] **Step 8: Commit**

```bash
git add app/ui/src/ui-shell/microsoft/ms-assistant-view.ts app/ui/src/ui-shell/microsoft/microsoft-view.ts app/ui/src/app-shell.ts app/ui/src/ui-shell/microsoft/microsoft.css app/ui/tests/ms-assistant-view.test.ts
git commit -m "feat(ms365): highlight the active conversation in the sidebar"
```

---

## Self-Review

**Spec coverage:**
- §1 #1a guard → Task 1 Step 6. #1b disable (send/input/chips) → Task 1 Steps 3-6. #3 highlight → Task 2. ✅
- §2 decisions: two layers (Task 1 guard + toggle); toggle-not-rebuild (Task 1 Step 6 sets `.disabled` on stored refs, no rebuild); chips included (Task 1 Step 3/6); activeId source + New→null (Task 2 Step 5 passes `state.ms365ActiveConversationId`, which onMs365NewConversation already sets null). ✅
- §5 error handling: refs null guard (Task 1 Step 6 `if composer !== null`); activeId null (Task 2 test 2); rebuild-on-connect keeps enabled=connected (Task 1 Step 4 unchanged enabled logic). ✅
- §6 testing 1-4 → Task 1 tests (composer refs + toggle target + guard note) + Task 2 tests (highlight/none). ✅

**Placeholder scan:** no TBD. The Task 1 note about adding `activeId` early (default null) so Task 2 fills it is a real sequencing instruction, not a placeholder. The "grep for existing token / harness" steps carry a concrete fallback.

**Type consistency:** composer-ref shape identical across renderComposer return, renderMsAssistant return, and MicrosoftViewDom.msComposer; `activeId: string | null` consistent across renderMsAssistant / renderMs365Sidebar / renderMicrosoftSurface / lastActiveConversationId. `renderMsAssistant` return changes from `HTMLElement` to `{transcript, composer}` — the sole caller (microsoft-view.ts) is updated in Task 1 Step 5.

## Execution Handoff

Will offer execution choice after saving.
