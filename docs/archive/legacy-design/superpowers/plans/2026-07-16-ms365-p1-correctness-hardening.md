# MS365 P1 Correctness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four correctness defects in the MS365 chat path — half-init session, single-shot transcript (only last turn shown), malformed IPv6 tool endpoint, and a disconnect that leaves the controller dirty when scope-revoke fails.

**Architecture:** Four independent fixes across three files. Two are in the thin `Ms365ChatController` (assign `sessionId` only after allow+stream succeed; move disconnect cleanup into `finally`). One is a pure helper in `live-launch.ts` (bracket IPv6 hosts in the endpoint URL). One converts the app-shell MS365 transcript from two single-value fields to a `ms365Messages` array so multi-turn history renders while the session stays reused.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), vanilla-TS renderer, `node:test` via tsx.

## Global Constraints

- The controller KEEPS one reused session per MS365 conversation (agent remembers prior turns) — do NOT create a new session per prompt. (spec §2)
- `sessionId` (and `stream`) must be assigned ONLY after BOTH `setMs365SessionScope(sid, true)` AND `startStream(sid)` succeed; if either throws, `sessionId` stays `null` so the next `send()` re-runs `ensureSession`. Keep `conversationId` across a failed attempt (no orphan conversations). (spec §4 #1)
- `disconnect()` clears `sessionId`/`stream`/`conversationId` (and calls `stream?.stop()`) in a `finally`, so a thrown `setMs365SessionScope(sid,false)` never leaves the controller dirty. (spec §4 #4)
- The MS365 tool endpoint URL must bracket an IPv6 host: `http://[::1]:PORT/...`, while IPv4/hostname pass through unchanged. (spec §4 #3)
- MS365 transcript renders the full turn sequence from a `ms365Messages: { role: "user" | "assistant"; text: string }[]` array in app-shell state (NOT loaded from SQLite — that is P2). (spec §2, §4 #2)
- Renderer never touches the DB or secret bytes. `Ms365SessionScope` at the router remains the real execution guard. ESM `.js` imports; `node:test` + `node:assert/strict`.
- Do NOT touch: backend router/connector/session-scope/supervisor; the `/v1/ms365/disconnect` route (backend revoke-all is a deferred follow-up).
- Commands: `npm run typecheck` (tsc -b), `npm test`, `scripts\verify-fast.bat`. NOTE: `npm test` has ~16-17 files of KNOWN pre-existing failures — confirm NO NEW failures, not a green suite.

---

## File Structure

- `service/src/composition/live-launch.ts` — **Modify.** Add `formatHostForUrl(host)` helper; use it in the endpoint template. (Fix #3)
- `app/ui/src/ms365-chat-controller.ts` — **Modify.** `ensureSession` late-assign (Fix #1); `disconnect()` `finally` (Fix #4).
- `app/ui/src/app-shell.ts` — **Modify.** Replace `ms365UserText`/`ms365AssistantText` with `ms365Messages` array; update the render fn, the send handler, the stream `onView`, the disconnect reset, and the init. (Fix #2 + transcript)
- Tests: `app/ui/tests/ms365-chat-controller.test.ts` (extend), `service/tests/live-launch.test.ts` or a small new `service/tests/format-host-for-url.test.ts` (Fix #3).

---

## Task 1: Fix #3 — bracket IPv6 host in the tool endpoint

**Files:**
- Modify: `service/src/composition/live-launch.ts` (helper + endpoint line ~195)
- Test: `service/tests/format-host-for-url.test.ts` (new)

**Interfaces:**
- Produces: `formatHostForUrl(host: string): string` — brackets an IPv6 literal (`"::1"` → `"[::1]"`), passes IPv4/hostname through. Exported so it is unit-testable.

- [ ] **Step 1: Write the failing test** — create `service/tests/format-host-for-url.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHostForUrl } from "../src/composition/live-launch.js";

test("formatHostForUrl brackets IPv6 literals", () => {
  assert.equal(formatHostForUrl("::1"), "[::1]");
  assert.equal(formatHostForUrl("fe80::1"), "[fe80::1]");
});

test("formatHostForUrl leaves IPv4 and hostnames unchanged", () => {
  assert.equal(formatHostForUrl("127.0.0.1"), "127.0.0.1");
  assert.equal(formatHostForUrl("localhost"), "localhost");
});

test("formatHostForUrl does not double-bracket an already-bracketed host", () => {
  assert.equal(formatHostForUrl("[::1]"), "[::1]");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test service/tests/format-host-for-url.test.ts`
Expected: FAIL — `formatHostForUrl` is not exported.

- [ ] **Step 3: Add the helper + use it** — in `service/src/composition/live-launch.ts`, add near the top-level helpers (e.g. next to `allocateLoopbackPort`):

```typescript
/**
 * Format a loopback host for embedding in a URL authority. An IPv6 literal (contains ":")
 * must be wrapped in brackets — `http://::1:PORT` is malformed; `http://[::1]:PORT` is correct.
 * IPv4 / hostnames pass through unchanged; an already-bracketed host is returned as-is.
 */
export function formatHostForUrl(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) return host;
  return host.includes(":") ? `[${host}]` : host;
}
```

Change the endpoint line (~195) from:
```typescript
  const ms365Endpoint = `http://${serviceHost}:${servicePort}${MS365_TOOL_CALL_PATH}`;
```
to:
```typescript
  const ms365Endpoint = `http://${formatHostForUrl(serviceHost)}:${servicePort}${MS365_TOOL_CALL_PATH}`;
```

- [ ] **Step 4: Run test to verify it passes + typecheck**

Run: `npx tsx --test service/tests/format-host-for-url.test.ts && npm run typecheck`
Expected: PASS + GREEN.

> NOTE: if an existing `service/tests/ms365-child-env.test.ts` asserts the endpoint for the default `127.0.0.1` host, it must still pass unchanged (IPv4 passes through). Run it to confirm: `npx tsx --test service/tests/ms365-child-env.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add service/src/composition/live-launch.ts service/tests/format-host-for-url.test.ts
git commit -m "fix(ms365): bracket IPv6 host in the tool endpoint URL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Fix #1 — assign sessionId only after allow + stream succeed

**Files:**
- Modify: `app/ui/src/ms365-chat-controller.ts` (`ensureSession`, ~lines 34-47)
- Test: `app/ui/tests/ms365-chat-controller.test.ts` (extend)

**Interfaces:**
- Consumes: `ServiceClient.createConversation`/`createSession`/`setMs365SessionScope`, `deps.startStream` — all unchanged.
- Produces: after a failed `setMs365SessionScope`/`startStream`, `controller.runtimeSessionId === null` and `conversationId` is retained; the next `send()` re-runs the full `ensureSession`.

- [ ] **Step 1: Write the failing test** — append to `app/ui/tests/ms365-chat-controller.test.ts` (mirror the existing `fakeDeps()` harness in that file — it returns `{ calls, setConnected, controller }` with fake client methods pushing to `calls`):

```typescript
test("half-init: a failed scope-allow leaves sessionId null so the next send retries cleanly", async () => {
  const calls: string[] = [];
  let scopeShouldThrow = true;
  const client = {
    createConversation: async () => { calls.push("createConversation"); return { id: "conv-1" } as never; },
    createSession: async () => { calls.push("createSession"); return { id: "sess-1" } as never; },
    setMs365SessionScope: async (sid: string, enabled: boolean) => {
      calls.push(`scope:${sid}:${enabled}`);
      if (scopeShouldThrow) throw new Error("scope service down");
      return { allowed: enabled };
    },
    sendSessionMessage: async (sid: string, text: string) => { calls.push(`send:${sid}:${text}`); return { accepted: true, sessionId: sid }; },
  };
  const startStream = (sid: string) => { calls.push(`stream:${sid}`); return { stop() {}, done: Promise.resolve() }; };
  const controller = createMs365ChatController({
    getClient: () => client as never,
    isConnected: () => true,
    workspacePath: () => "C:\\ws",
    startStream: startStream as never,
  });

  // First send: scope throws → send rejects, and NO prompt was sent to an un-scoped session.
  await assert.rejects(controller.send("one"));
  assert.equal(controller.runtimeSessionId, null, "sessionId must stay null after a failed allow");
  assert.ok(!calls.some((c) => c.startsWith("send:")), "must NOT send into an un-allowed session");
  assert.ok(!calls.includes("stream:sess-1"), "stream must not open when allow failed");

  // Second send: scope now succeeds → full ensureSession runs and the prompt is sent.
  scopeShouldThrow = false;
  await controller.send("two");
  assert.equal(controller.runtimeSessionId, "sess-1");
  assert.ok(calls.includes("scope:sess-1:true"));
  assert.ok(calls.includes("stream:sess-1"));
  assert.ok(calls.includes("send:sess-1:two"));
});
```

> NOTE: if the file's existing tests use a shared `fakeDeps()` helper, reuse it and only override `setMs365SessionScope` to throw-once; the inline client above is a fallback if no reusable helper fits. Keep the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test app/ui/tests/ms365-chat-controller.test.ts`
Expected: FAIL — current code assigns `sessionId` before the throw, so after the first (failed) send `runtimeSessionId === "sess-1"` (not null) and/or the retry short-circuits.

- [ ] **Step 3: Late-assign in `ensureSession`** — replace the body (current lines ~34-47):

```typescript
  async function ensureSession(client: ServiceClient): Promise<string> {
    if (sessionId !== null) return sessionId;
    const workspace = deps.workspacePath();
    if (workspace === null) throw new Error("Chưa chọn workspace.");
    if (conversationId === null) {
      const conv = await client.createConversation({ workspacePath: workspace, surface: "ms365" });
      conversationId = conv.id; // retained across a later failure so retry reuses it (no orphan)
    }
    const session = await client.createSession({ workspaceId: workspace });
    const sid = session.id;
    // Grant tool scope + open the stream BEFORE committing sid to controller state. If either
    // throws, sessionId stays null and the next send() re-runs ensureSession from scratch —
    // never leaving a half-initialized session that send() would skip past.
    await client.setMs365SessionScope(sid, true); // one-time allow
    const openedStream = deps.startStream(sid);
    sessionId = sid;
    stream = openedStream;
    return sessionId;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test app/ui/tests/ms365-chat-controller.test.ts`
Expected: PASS (the new test + all existing controller tests).

- [ ] **Step 5: Commit**

```bash
git add app/ui/src/ms365-chat-controller.ts app/ui/tests/ms365-chat-controller.test.ts
git commit -m "fix(ms365): assign sessionId only after scope-allow + stream succeed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Fix #4 — clear disconnect state in a finally

**Files:**
- Modify: `app/ui/src/ms365-chat-controller.ts` (`disconnect()`, ~lines 62-71)
- Test: `app/ui/tests/ms365-chat-controller.test.ts` (extend)

**Interfaces:**
- Produces: after `disconnect()`, even if `setMs365SessionScope(sid,false)` throws, `controller.runtimeSessionId === null` and the stream was stopped.

- [ ] **Step 1: Write the failing test** — append to `app/ui/tests/ms365-chat-controller.test.ts`:

```typescript
test("disconnect stays clean even if scope-revoke throws", async () => {
  let stopped = false;
  const client = {
    createConversation: async () => ({ id: "conv-1" } as never),
    createSession: async () => ({ id: "sess-1" } as never),
    setMs365SessionScope: async (_sid: string, enabled: boolean) => {
      if (!enabled) throw new Error("revoke service down"); // throw only on revoke
      return { allowed: enabled };
    },
    sendSessionMessage: async (sid: string) => ({ accepted: true, sessionId: sid }),
  };
  const startStream = () => ({ stop() { stopped = true; }, done: Promise.resolve() });
  const controller = createMs365ChatController({
    getClient: () => client as never,
    isConnected: () => true,
    workspacePath: () => "C:\\ws",
    startStream: startStream as never,
  });
  await controller.send("hi"); // establishes sess-1
  assert.equal(controller.runtimeSessionId, "sess-1");

  await controller.disconnect(); // revoke throws internally, but must not leave state dirty
  assert.equal(controller.runtimeSessionId, null, "session cleared despite revoke throwing");
  assert.equal(stopped, true, "stream stopped despite revoke throwing");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test app/ui/tests/ms365-chat-controller.test.ts`
Expected: FAIL — current `disconnect()` awaits the (throwing) revoke before clearing; the throw propagates and `runtimeSessionId` stays `"sess-1"`, stream not stopped.

- [ ] **Step 3: Move cleanup into `finally`** — replace `disconnect()` (current lines ~62-71):

```typescript
    async disconnect() {
      try {
        const client = deps.getClient();
        if (client !== null && sessionId !== null) {
          await client.setMs365SessionScope(sessionId, false); // revoke
        }
      } finally {
        stream?.stop();
        stream = null;
        sessionId = null;
        conversationId = null;
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test app/ui/tests/ms365-chat-controller.test.ts`
Expected: PASS (new test + all existing).

> NOTE: `disconnect()` now no longer rejects on a revoke failure (the `finally` runs and the method returns normally after the caught throw re-propagates? — it does NOT: a `try/finally` without `catch` still re-throws). If the app-shell caller relies on `disconnect()` NOT rejecting, verify: app-shell's `onMs365Disconnect` already wraps `ms365Chat.disconnect()` in its own `try/catch` (from P0), so a re-thrown revoke error is swallowed there and the UI still resets. Confirm that wrapper exists; if it does, leaving the `try/finally` (which re-throws) is correct and the state is still cleaned. Do NOT add a `catch` that hides the error from app-shell's logging.

- [ ] **Step 5: Commit**

```bash
git add app/ui/src/ms365-chat-controller.ts app/ui/tests/ms365-chat-controller.test.ts
git commit -m "fix(ms365): clear disconnect state in finally so revoke failure can't leave it dirty

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Fix #2 + multi-turn transcript (app-shell `ms365Messages`)

**Files:**
- Modify: `app/ui/src/app-shell.ts` (state interface ~199-202, render ~2091-2107, stream onView ~2124-2132, init ~2195-2198, send handler ~2220-2230, disconnect reset ~2265-2268)

**Interfaces:**
- Consumes: `Ms365ChatController.send` (unchanged — still reuses one session).
- Produces: `AppState.ms365Messages: { role: "user" | "assistant"; text: string }[]` replaces `ms365UserText`/`ms365AssistantText`; the transcript renders every message; the streaming assistant reply updates the LAST assistant entry in place.

- [ ] **Step 1: Replace the two single-value fields with an array** — in the `AppState` interface (~lines 199-202), replace:

```typescript
  ms365Phase: "idle" | "running" | "failed";
  ms365Error: string | null;
  ms365UserText: string;
  ms365AssistantText: string;
```
with:
```typescript
  ms365Phase: "idle" | "running" | "failed";
  ms365Error: string | null;
  /** MS365 transcript for the current in-session conversation (user + assistant turns, in order). */
  ms365Messages: { role: "user" | "assistant"; text: string }[];
```

And the init (~lines 2195-2198), replace `ms365UserText: "", ms365AssistantText: "",` with:
```typescript
    ms365Messages: [],
```

- [ ] **Step 2: Rewrite `renderMs365Transcript`** (~lines 2091-2107) to render the array:

```typescript
function renderMs365Transcript(dom: AppDom, state: AppState): void {
  const transcript = dom.microsoftView.assistantTranscript;
  if (transcript === null) return;
  if (state.ms365View.connectionState !== "connected") return; // the empty-state card owns the DOM here
  transcript.replaceChildren();
  for (const message of state.ms365Messages) {
    if (message.text.length === 0) continue;
    const cls =
      message.role === "user"
        ? "ms-assistant__bubble ms-assistant__bubble--user"
        : "ms-assistant__bubble ms-assistant__bubble--assistant";
    transcript.append(el("div", cls, message.text));
  }
  if (state.ms365Phase === "running") {
    transcript.append(el("p", "ms-assistant__status", "Đang chạy…"));
  } else if (state.ms365Phase === "failed") {
    transcript.append(el("p", "ms-assistant__status ms-assistant__status--error", state.ms365Error ?? "Đã xảy ra lỗi."));
  }
}
```

- [ ] **Step 3: Update the stream `onView`** (~lines 2124-2132) to update the LAST assistant entry in place:

```typescript
        onView: (view) => {
          if (view.text.length > 0) {
            const last = state.ms365Messages[state.ms365Messages.length - 1];
            if (last !== undefined && last.role === "assistant") last.text = view.text;
          }
          if (view.terminal === "completed" || view.terminal === "cancelled") state.ms365Phase = "idle";
          if (view.terminal === "errored" || view.terminal === "denied") {
            state.ms365Phase = "failed";
            state.ms365Error = view.error?.message ?? "Phiên kết thúc với lỗi.";
          }
          renderMs365Transcript(dom, state);
        },
```

- [ ] **Step 4: Update the send handler** (~lines 2220-2230) to append a user + placeholder-assistant turn:

```typescript
    onMs365Send: (text: string) => {
      state.ms365Messages.push({ role: "user", text });
      state.ms365Messages.push({ role: "assistant", text: "" }); // streaming target
      state.ms365Phase = "running";
      state.ms365Error = null;
      renderMs365Transcript(dom, state);
      void ms365Chat.send(text).catch((error) => {
        state.ms365Phase = "failed";
        state.ms365Error = safeError(error);
        renderMs365Transcript(dom, state);
      });
    },
```

- [ ] **Step 5: Update the disconnect reset** (~lines 2265-2268) to clear the array:

```typescript
        state.ms365View = MS_DISCONNECTED_VIEW;
        state.ms365Messages = [];
        state.ms365Phase = "idle";
        state.ms365Error = null;
```

- [ ] **Step 6: Typecheck + focused tests**

Run: `npm run typecheck`
Expected: GREEN — no remaining `ms365UserText`/`ms365AssistantText` references (grep to confirm: `grep -rn "ms365UserText\|ms365AssistantText" app/ui/src` returns nothing).

Run: `npx tsx --test app/ui/tests/ms365-chat-controller.test.ts app/ui/tests/service-client-ms365.test.ts app/ui/tests/ms-connect-view.test.ts`
Expected: PASS.

- [ ] **Step 7: Multi-turn behavior check (controller-level, since app-shell DOM glue has no easy unit seam)** — extend `app/ui/tests/ms365-chat-controller.test.ts` to assert one session is reused across two sends (this proves the multi-turn model — the transcript array itself is app-shell DOM glue validated by typecheck + packaged acceptance):

```typescript
test("two sends reuse ONE session (multi-turn: createSession + allow happen once)", async () => {
  const calls: string[] = [];
  const client = {
    createConversation: async () => { calls.push("createConversation"); return { id: "conv-1" } as never; },
    createSession: async () => { calls.push("createSession"); return { id: "sess-1" } as never; },
    setMs365SessionScope: async (sid: string, enabled: boolean) => { calls.push(`scope:${sid}:${enabled}`); return { allowed: enabled }; },
    sendSessionMessage: async (sid: string, text: string) => { calls.push(`send:${sid}:${text}`); return { accepted: true, sessionId: sid }; },
  };
  const startStream = (sid: string) => { calls.push(`stream:${sid}`); return { stop() {}, done: Promise.resolve() }; };
  const controller = createMs365ChatController({
    getClient: () => client as never, isConnected: () => true, workspacePath: () => "C:\\ws", startStream: startStream as never,
  });
  await controller.send("one");
  await controller.send("two");
  assert.equal(calls.filter((c) => c === "createSession").length, 1, "one session for the whole conversation");
  assert.equal(calls.filter((c) => c.startsWith("scope:")).length, 1, "scope allowed once");
  assert.ok(calls.includes("send:sess-1:one") && calls.includes("send:sess-1:two"));
});
```

Run: `npx tsx --test app/ui/tests/ms365-chat-controller.test.ts`
Expected: PASS.

- [ ] **Step 8: verify-fast + full-suite regression**

Run: `scripts\verify-fast.bat`
Expected: PASS.

Run: `npm test`
Expected: only KNOWN pre-existing failures (per baseline: ~16-17 files + `Merge/` glob noise). Any NEW failure in a touched file → STOP + fix. Capture the failing-file list.

- [ ] **Step 9: Commit**

```bash
git add app/ui/src/app-shell.ts app/ui/tests/ms365-chat-controller.test.ts
git commit -m "fix(ms365): multi-turn transcript via ms365Messages array (session reused)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Packaged acceptance (PO, after Task 4)

PO checks in the packaged app:
1. Connect MS365, send several prompts in a row — the transcript shows ALL turns (user + assistant), not just the last.
2. The agent's later replies reflect earlier turns' context (one reused session).
3. Disconnect clears the transcript and revokes scope; reconnect starts fresh.
4. (IPv6 — only if reachable in the test env) the tool bridge still works; the endpoint is well-formed.

## Self-Review notes

- **Spec §4 #1 (half-init):** Task 2 — late-assign after allow+stream; test proves `runtimeSessionId===null` + no send-to-unallowed + clean retry.
- **Spec §4 #2 + transcript:** Task 4 — `ms365Messages` array; Task 4 Step 7 proves the session is reused (the multi-turn model); the array render is DOM glue validated by typecheck + packaged acceptance.
- **Spec §4 #3 (IPv6):** Task 1 — `formatHostForUrl` + endpoint uses it; test covers IPv6/IPv4/hostname/already-bracketed.
- **Spec §4 #4 (scope-hardening):** Task 3 — `finally` cleanup; test proves clean state when revoke throws. Task 3's NOTE confirms app-shell's P0 `try/catch` wrapper already swallows a re-thrown revoke error (so the re-throw is safe) — the implementer must verify that wrapper exists.
- **Task independence:** Tasks 1-3 are independent; Task 4 depends on nothing from 1-3 (it only rewrites app-shell transcript state). Ordering 1→4 is convenience, not dependency.
- **Type consistency:** `formatHostForUrl(host: string): string`, `ms365Messages: {role,text}[]` used consistently; `runtimeSessionId` getter name matches the existing controller interface.
- **Known risk flagged:** the controller-test `fakeDeps()` harness shape and app-shell's existing disconnect `try/catch` must be read from real code (Task 2/3 notes), not guessed.
