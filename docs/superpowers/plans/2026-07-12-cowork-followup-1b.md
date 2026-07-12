# Follow-up 1b: Manual Compress + Crash-Resilient Session Highlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual "Compress conversation" action (trim history to system message + last 3 turns) and crash-resilient last-session tracking that highlights (but does not auto-open) the most recently active conversation in the sidebar on launch.

**Architecture:** A pure history-trimming function is added alongside the existing `history-store.ts` persistence helpers, wired behind a new `cowork:compress` IPC channel that mutates the same in-memory `conversationHistories` map `ipc.ts` already maintains, then persists via the existing `saveConversation`/`persistConversation` path. `AppConfig` gains a `last_session.cowork` field, written every time a conversation is persisted. The renderer's existing composer "Nén" button (already present in the static HTML, unwired) and history sidebar (already rendering `.history-item` elements) both get minimal additive wiring — no new DOM structure beyond one CSS class and one small inline status line.

**Tech Stack:** TypeScript, Electron IPC (`ipcMain.handle`/`contextBridge`), Vitest.

## Global Constraints

- Do not modify the already-approved logic in `runCowork`, `ConversationManager`, `AnthropicProvider`, `OpenAICompatProvider`, or the existing history-store CRUD functions (`saveConversation`, `loadConversation`, `listConversations`, `deleteConversation`, `renameConversation`, `setPinned`) — only add to them.
- Trim rule (ported from `OldVersion/src/cowork_local/ui/chat_panel.py:349-365`): keep all `system`-role messages, plus everything from the 3rd-most-recent `user`-role message onward; if there are ≤ 3 user turns total, do nothing and report 0 removed.
- `last_session` restore is **highlight-only** — the renderer must NOT call `openConversation()` automatically on launch, per explicit user decision (differs from the Python original's auto-open behavior).
- Config field added: `last_session: { cowork: string }`, default `{ cowork: '' }`, must deep-merge correctly with an existing `config.json` that predates this field (no `last_session` key at all).
- No automated tests for IPC/renderer DOM wiring (consistent with the rest of this codebase, e.g. `src/main/ipc.ts` and `src/renderer/index.ts` have none) — automated gates for those pieces are `npx tsc --noEmit`, `npm test` (no regressions), and `npm run build`; manual verification via `npm start` covers the actual UX.

---

## File Structure

```
src/main/
├── history-compress.ts        # NEW — pure trim function, no I/O
├── config.ts                  # MODIFY — add LastSessionConf + default
├── ipc.ts                     # MODIFY — cowork:compress handler, last_session write in persistConversation
src/preload/
└── index.ts                   # MODIFY — expose compress()
src/renderer/
├── index.ts                   # MODIFY — wire Nén button, highlight last-session item on load
└── style.css                  # MODIFY — .history-item--last-session style

tests/main/
└── history-compress.test.ts   # NEW
tests/main/
└── config.test.ts             # MODIFY — extend for last_session default/merge
```

---

### Task 1: Pure history-compress function

**Files:**
- Create: `src/main/history-compress.ts`
- Test: `tests/main/history-compress.test.ts`

**Interfaces:**
- Consumes: `Message` type from `src/main/agent/types.ts` (already defined: `interface Message { role: Role; content: string | ...; tool_calls?: ...; tool_call_id?: string; name?: string; }` — for this task only `role` and `content` matter).
- Produces: `function compressHistory(messages: Message[], keepTurns?: number): { messages: Message[]; removed: number }` — `keepTurns` defaults to `3`. Later tasks (Task 3, `ipc.ts`) call this exact signature.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/history-compress.test.ts
import { describe, it, expect } from 'vitest';
import { compressHistory } from '../../src/main/history-compress';
import { Message } from '../../src/main/agent/types';

function userMsg(text: string): Message {
  return { role: 'user', content: text };
}
function assistantMsg(text: string): Message {
  return { role: 'assistant', content: text, tool_calls: [] };
}

describe('compressHistory', () => {
  it('keeps system messages and the last 3 user turns, dropping older ones', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      userMsg('turn 1'),
      assistantMsg('reply 1'),
      userMsg('turn 2'),
      assistantMsg('reply 2'),
      userMsg('turn 3'),
      assistantMsg('reply 3'),
      userMsg('turn 4'),
      assistantMsg('reply 4'),
    ];
    const { messages: out, removed } = compressHistory(messages);
    expect(out).toEqual([
      { role: 'system', content: 'sys' },
      userMsg('turn 2'),
      assistantMsg('reply 2'),
      userMsg('turn 3'),
      assistantMsg('reply 3'),
      userMsg('turn 4'),
      assistantMsg('reply 4'),
    ]);
    expect(removed).toBe(2); // turn 1 + reply 1 dropped
  });

  it('keeps multiple system messages at the front', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys A' },
      { role: 'system', content: 'sys B' },
      userMsg('turn 1'),
      userMsg('turn 2'),
      userMsg('turn 3'),
      userMsg('turn 4'),
    ];
    const { messages: out, removed } = compressHistory(messages);
    expect(out[0]).toEqual({ role: 'system', content: 'sys A' });
    expect(out[1]).toEqual({ role: 'system', content: 'sys B' });
    expect(removed).toBe(1); // only "turn 1" dropped
  });

  it('does nothing when there are 3 or fewer user turns', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      userMsg('turn 1'),
      assistantMsg('reply 1'),
      userMsg('turn 2'),
      userMsg('turn 3'),
    ];
    const { messages: out, removed } = compressHistory(messages);
    expect(out).toEqual(messages);
    expect(removed).toBe(0);
  });

  it('does nothing on an empty message array', () => {
    const { messages: out, removed } = compressHistory([]);
    expect(out).toEqual([]);
    expect(removed).toBe(0);
  });

  it('honors a custom keepTurns value', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      userMsg('turn 1'),
      userMsg('turn 2'),
      userMsg('turn 3'),
    ];
    const { messages: out, removed } = compressHistory(messages, 1);
    expect(out).toEqual([{ role: 'system', content: 'sys' }, userMsg('turn 3')]);
    expect(removed).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- history-compress.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/history-compress'`.

- [ ] **Step 3: Write `src/main/history-compress.ts`**

```ts
import { Message } from './agent/types';

/**
 * Trims conversation history to reduce token usage: keeps every leading
 * system message plus the last `keepTurns` user-initiated turns (a "turn"
 * starts at a user message and runs up to, but not including, the next
 * user message). Returns the original array unchanged (same reference)
 * when there is nothing to trim.
 */
export function compressHistory(
  messages: Message[],
  keepTurns = 3,
): { messages: Message[]; removed: number } {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const userStarts = rest.reduce<number[]>((acc, m, i) => {
    if (m.role === 'user') acc.push(i);
    return acc;
  }, []);

  if (userStarts.length <= keepTurns) {
    return { messages, removed: 0 };
  }

  const cutIndex = userStarts[userStarts.length - keepTurns];
  const trimmedRest = rest.slice(cutIndex);
  return {
    messages: [...systemMessages, ...trimmedRest],
    removed: cutIndex,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- history-compress.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/history-compress.ts tests/main/history-compress.test.ts
git commit -m "feat: add pure history-compress trim function"
```

---

### Task 2: `last_session` config field

**Files:**
- Modify: `src/main/config.ts`
- Test: `tests/main/config.test.ts` (add cases; do not remove or weaken any existing test)

**Interfaces:**
- Consumes: existing `AppConfigData`, `DEFAULT_CONFIG`, `deepMerge`, `AppConfig` class — all already defined in `src/main/config.ts` (read the current file before editing; do not restate it from memory).
- Produces: `AppConfigData.last_session: { cowork: string }` field, present in `DEFAULT_CONFIG` as `{ cowork: '' }`. Task 4 (`ipc.ts`) reads/writes `config.data.last_session.cowork`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/config.test.ts` (append inside the existing `describe('AppConfig', ...)` block, alongside the current tests — do not remove any existing test):

```ts
  it('includes a default empty last_session.cowork', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);
    expect(config.data.last_session).toEqual({ cowork: '' });
  });

  it('deep-merges a stored last_session over the default without needing the key to pre-exist', () => {
    const configPath = path.join(tmpDir, 'config.json');
    // Simulates an old config.json written before this field existed.
    fs.writeFileSync(configPath, JSON.stringify({ active_provider: 'anthropic' }));
    const config = AppConfig.load(configPath);
    expect(config.data.last_session).toEqual({ cowork: '' });
  });

  it('preserves a stored last_session.cowork value', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ last_session: { cowork: '20260101-000000-000' } }));
    const config = AppConfig.load(configPath);
    expect(config.data.last_session.cowork).toBe('20260101-000000-000');
  });
```

(These reuse the existing `tmpDir`/`fs`/`path` setup already present at the top of `tests/main/config.test.ts` — no new imports needed.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- config.test.ts`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'cowork')` (or similar), since `last_session` doesn't exist yet on `AppConfigData`.

- [ ] **Step 3: Modify `src/main/config.ts`**

Add a new interface and extend `AppConfigData`:

```ts
export interface LastSessionConf {
  cowork: string;
}
```

Add `last_session: LastSessionConf;` as a new field on the `AppConfigData` interface (alongside the existing `active_provider`, `theme`, `providers`, `cowork`, `history` fields).

Add `last_session: { cowork: '' },` as a new top-level key in the `DEFAULT_CONFIG` object literal (alongside the existing `active_provider`, `theme`, `providers`, `cowork`, `history` keys).

Do not modify `deepMerge`, `applyEnvOverrides`, `AppConfig.load`, `AppConfig.save`, or `AppConfig.mergeAndSave` — the existing recursive `deepMerge` already handles a missing/partial `last_session` key correctly once it's part of `DEFAULT_CONFIG`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- config.test.ts`
Expected: all tests in the file pass, including the 3 new ones (existing test count + 3).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: every test file passes, total count increased by 3 (from `compressHistory`'s 5 tests in Task 1 plus these 3 — check the printed total against the previous run).

- [ ] **Step 6: Commit**

```bash
git add src/main/config.ts tests/main/config.test.ts
git commit -m "feat: add last_session.cowork config field for crash-resilient highlight"
```

---

### Task 3: `cowork:compress` IPC handler

**Files:**
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `compressHistory(messages, keepTurns?)` from `src/main/history-compress.ts` (Task 1); the existing `conversationHistories: Map<string, Message[]>`, `getHistory(conversationId)`, `persistConversation(conversationId)` functions already defined in `src/main/ipc.ts` (read the current file in full before editing — it already has `cowork:send`, `cowork:cancel`, `history:*`, `settings:*`, `shell:openPath` handlers registered inside `registerIpcHandlers(mainWin)`; add the new handler alongside them, inside the same function).
- Produces: IPC channel `cowork:compress` (invoke), handler signature `(conversationId: string) => { removed: number }`. Task 5 (preload) and Task 6 (renderer) depend on this exact channel name and return shape.

This task has no dedicated automated test (consistent with the rest of `ipc.ts`, which has none) — it is verified by `npx tsc --noEmit`, the full `npm test` run showing no regressions, `npm run build`, and manual testing in Task 7.

- [ ] **Step 1: Add the import**

At the top of `src/main/ipc.ts`, add to the existing import list from `./history-compress` (a new import line, since no such import exists yet):

```ts
import { compressHistory } from './history-compress';
```

- [ ] **Step 2: Add the handler**

Inside `registerIpcHandlers(mainWin: BrowserWindow)`, add this handler in the same block as the other `ipcMain.handle(...)` registrations (e.g. right after the existing `cowork:cancel` handler):

```ts
  ipcMain.handle('cowork:compress', (_e, conversationId: string) => {
    const current = getHistory(conversationId);
    const { messages: compressed, removed } = compressHistory(current);
    if (removed > 0) {
      conversationHistories.set(conversationId, compressed);
      persistConversation(conversationId);
    }
    return { removed };
  });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: same test count/pass status as after Task 2 (this task adds no new tests, only IPC glue).

- [ ] **Step 5: Build to confirm the main bundle compiles**

Run: `npm run build`
Expected: `dist/main/index.js` rebuilds successfully alongside the preload/renderer bundles.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: add cowork:compress IPC handler"
```

---

### Task 4: `last_session.cowork` tracking in `persistConversation`

**Files:**
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `config.data.last_session.cowork` (Task 2), `config.save()` (already exists on `AppConfig`), the existing `persistConversation(conversationId: string)` function already defined at the bottom of `src/main/ipc.ts`.
- Produces: side effect only — after this task, every successful `persistConversation` call also updates `config.data.last_session.cowork` and persists it to disk when the value changes. No new exported symbol; Task 6 (renderer) instead reads this via the existing `settings:get` IPC channel, which already returns the full `config.data` (including `last_session` once Task 2 lands).

- [ ] **Step 1: Modify `persistConversation` in `src/main/ipc.ts`**

Read the current `persistConversation` function first (it's a plain function at the bottom of the file, not inside `registerIpcHandlers`). Change it from:

```ts
function persistConversation(conversationId: string): void {
  const messages = getHistory(conversationId);
  const title = conversationTitles.get(conversationId);
  saveConversation(config.historyDir(), 'cowork', conversationId, messages, title ? { title } : {});
}
```

to:

```ts
function persistConversation(conversationId: string): void {
  const messages = getHistory(conversationId);
  const title = conversationTitles.get(conversationId);
  saveConversation(config.historyDir(), 'cowork', conversationId, messages, title ? { title } : {});
  if (config.data.last_session.cowork !== conversationId) {
    config.data.last_session.cowork = conversationId;
    config.save();
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `config.data.last_session` resolves correctly given Task 2's type addition).

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: same pass count as after Task 3.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: track last_session.cowork on every successful conversation persist"
```

---

### Task 5: Expose `compress` in preload

**Files:**
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: IPC channel `cowork:compress` (Task 3).
- Produces: `window.coworkAPI.compress(conversationId: string): Promise<{ removed: number }>`. Task 6 (renderer) calls this exact method name/signature. Task 7 (renderer) also relies on `window.coworkAPI.settingsGet()` already existing (it does, unchanged).

- [ ] **Step 1: Add the method to the exposed API**

In `src/preload/index.ts`, inside the `contextBridge.exposeInMainWorld('coworkAPI', { ... })` object literal, add a new property alongside the existing `cancel: (...) => ...` line:

```ts
  compress: (conversationId: string) => ipcRenderer.invoke('cowork:compress', conversationId),
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: same pass count as after Task 4 (preload has no dedicated tests).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `dist/preload/index.js` rebuilds successfully.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose compress() in the preload coworkAPI bridge"
```

---

### Task 6: Wire the "Nén" button in the renderer

**Files:**
- Modify: `src/renderer/index.ts`

**Interfaces:**
- Consumes: `window.coworkAPI.compress(conversationId)` (Task 5); the existing `currentConversationId` module-level variable, `escapeHtml`, and the existing `.composer__bar` `<button class="text-btn" aria-label="Nén">` element already present (unwired) in `src/renderer/index.html:147-149` — this task does NOT modify the HTML, only queries the existing button by its `aria-label`.
- Produces: click handler on the existing Nén button. No new exported symbol — this is renderer glue, verified manually in Task 8.

The existing `CoworkAPI` interface declared at the top of `src/renderer/index.ts` must also be updated so the new method type-checks — do this as part of Step 1.

- [ ] **Step 1: Extend the `CoworkAPI` interface**

In `src/renderer/index.ts`, inside the `interface CoworkAPI { ... }` block near the top of the file, add a new line alongside the existing `cancel(...)` line:

```ts
  compress(conversationId: string): Promise<{ removed: number }>;
```

- [ ] **Step 2: Add a status-line helper and the click handler**

Add this new code in `src/renderer/index.ts`. Place it near the other composer-related code (after the existing `btnStop` block, before the `scrollToBottom` function is a reasonable spot — follow the file's existing top-to-bottom grouping by feature):

```ts
// ── Compress button ──────────────────────────────────────────
const btnCompress = document.querySelector<HTMLButtonElement>('.composer__bar [aria-label="Nén"]');

function showComposerStatus(message: string): void {
  const hint = document.querySelector('.composer__hint');
  if (!hint) return;
  const original = hint.textContent;
  hint.textContent = message;
  setTimeout(() => {
    if (hint.textContent === message) hint.textContent = original;
  }, 3000);
}

btnCompress?.addEventListener('click', async () => {
  if (!api || !currentConversationId) {
    showComposerStatus('Chưa có hội thoại nào để nén.');
    return;
  }
  const { removed } = await api.compress(currentConversationId);
  if (removed > 0) {
    showComposerStatus(`Đã nén hội thoại: bỏ ${removed} tin cũ.`);
  } else {
    showComposerStatus('Hội thoại đã ngắn — không cần nén.');
  }
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: same pass count as after Task 5 (renderer has no dedicated tests).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: `dist/renderer/index.js` rebuilds successfully.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.ts
git commit -m "feat: wire the composer Nén button to cowork:compress"
```

---

### Task 7: Highlight the last-session item in the history sidebar on launch

**Files:**
- Modify: `src/renderer/index.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: `window.coworkAPI.settingsGet()` (already exists, unchanged — now returns `data.last_session.cowork` once Task 2/main-process changes are in place); the existing `refreshHistoryList()` function and `window.addEventListener('load', ...)` block in `src/renderer/index.ts`.
- Produces: a new CSS class `.history-item--last-session` applied to the matching sidebar item after `refreshHistoryList()` runs on launch. No new exported symbol.

- [ ] **Step 1: Add the CSS class**

Append to `src/renderer/style.css` (find the end of the file, or group near any existing `.history-item` rules if present — read the current file to place it sensibly near related selectors):

```css
.history-item--last-session {
  box-shadow: inset 3px 0 0 0 var(--accent, #F36F21);
}
```

(This uses the existing `--accent` CSS variable already defined in this file's `:root` per the project's design tokens — confirm it exists by checking `style.css`'s `:root` block; if the variable name differs, use the actual accent color variable already in use elsewhere in the file instead of inventing a new one.)

- [ ] **Step 2: Highlight the item after the initial history load**

In `src/renderer/index.ts`, modify the `window.addEventListener('load', ...)` block. It currently reads:

```ts
window.addEventListener('load', () => {
  scrollToBottom();
  window.lucide?.createIcons();
  void refreshHistoryList();
});
```

Change it to:

```ts
window.addEventListener('load', () => {
  scrollToBottom();
  window.lucide?.createIcons();
  void refreshHistoryList().then(() => void highlightLastSession());
});
```

Add the new `highlightLastSession` function anywhere above this block (e.g. right after the `refreshHistoryList`/`openConversation` function definitions, before the `btn-new-chat` click handler):

```ts
async function highlightLastSession(): Promise<void> {
  if (!api) return;
  const settings = await api.settingsGet();
  const lastSessionId = settings?.last_session?.cowork;
  if (!lastSessionId) return;
  const item = document.querySelector(`.history-item[data-session-id="${CSS.escape(lastSessionId)}"]`);
  item?.classList.add('history-item--last-session');
}
```

This does NOT call `openConversation()` — it only adds a CSS class to the existing sidebar item if one with a matching `data-session-id` is present after the list renders. If the last session was deleted or doesn't appear in the current list, `querySelector` returns `null` and nothing happens (no error).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: same pass count as after Task 6.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds, all `dist/renderer/*` outputs present.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.ts src/renderer/style.css
git commit -m "feat: highlight (without auto-opening) the last-active conversation on launch"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only — if a bug is found, fix it in the relevant file from Tasks 1-7 and re-run the failing step).

- [ ] **Step 1: Launch the app**

Run: `npm start`
Expected: window opens normally, no console errors.

- [ ] **Step 2: Test the Compress button with no active conversation**

Action: without sending any message, click the "Nén" button in the composer.
Expected: the composer hint briefly shows "Chưa có hội thoại nào để nén." then reverts to the original hint text after ~3 seconds.

- [ ] **Step 3: Test Compress on a short conversation**

Action: send 1 message, wait for a reply, then click "Nén".
Expected: hint shows "Hội thoại đã ngắn — không cần nén." (since 1 turn ≤ 3, nothing is trimmed).

- [ ] **Step 4: Test Compress on a long conversation**

Action: send 5 short messages in the same conversation (waiting for each reply, or letting them queue — either is fine), then click "Nén".
Expected: hint shows "Đã nén hội thoại: bỏ N tin cũ." with some N > 0; reopening the conversation from history afterward (click away to "New chat" then click back) shows a shorter transcript than before compressing.

- [ ] **Step 5: Test crash-resilient highlight**

Action: with at least one conversation in history, fully quit the app (not just close the window — ensure the Electron process exits) and relaunch with `npm start`.
Expected: the most recently active conversation's item in the History sidebar shows a visible left-edge accent highlight (the `.history-item--last-session` style), but the transcript area is empty ("Cuộc trò chuyện mới") — confirming the conversation was NOT auto-opened, only highlighted.

- [ ] **Step 6: Record the outcome**

If Steps 2-5 all pass, the follow-up is complete. If any step fails, identify the responsible file from Tasks 1-7, fix it, re-run `npm test`, rebuild with `npm run build`, and repeat the failing manual step until it passes.

---

## Self-Review Notes

- **Spec coverage:** manual Compress button (Tasks 1, 3, 5, 6) — covered; crash-resilient highlight-only session restore (Tasks 2, 4, 7) — covered; confirms Thinking/reasoning UI needs no work — already true per the design doc, no task needed since `StreamEvent.reasoning` handling already exists in the current `src/renderer/index.ts` (verified by reading the file: `case 'reasoning': appendReasoningText(...)` at line 206-208, and the `ensureReasoningBox`/`appendReasoningText` helpers already present).
- **Placeholder scan:** no TBD/TODO; every step has complete runnable code or an exact command with expected output.
- **Type consistency:** `compressHistory(messages, keepTurns?)` return shape `{ messages, removed }` is used identically in Task 1's tests, Task 3's IPC handler, and referenced identically in Task 5's preload signature and Task 6's `CoworkAPI.compress` return type (`Promise<{ removed: number }>`). `last_session.cowork` field name is consistent across Task 2 (config), Task 4 (write), and Task 7 (read via `settingsGet()`).
