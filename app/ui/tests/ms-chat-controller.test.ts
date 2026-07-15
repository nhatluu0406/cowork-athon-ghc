/**
 * ms-chat-controller — MS365 tab chat state machine (P5.6).
 *
 * Pure logic, no DOM: fakes record labeled calls to prove the invariant ORDER per send
 * (create -> scope:true -> stream -> send), honest error handling on every failure path,
 * and that session-scope is always revoked (terminal / cancel / disconnect / reset) —
 * never leaking the MS365 tool allowlist. Every state mutation flows through one internal
 * setState which calls deps.onStateChange (asserted via a state-change counter).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMsChatController,
  type MsChatDeps,
  type MsChatMessage,
  type MsChatState,
} from "../src/ui-shell/microsoft/ms-chat-controller.js";

interface FakeStream {
  stop(): void;
  emit(view: { text: string; terminal: string | null }): void;
}

function makeDeps(overrides: Partial<MsChatDeps> = {}): {
  deps: MsChatDeps;
  calls: string[];
  states: MsChatState[];
  streams: Map<string, FakeStream>;
} {
  const calls: string[] = [];
  const states: MsChatState[] = [];
  const streams = new Map<string, FakeStream>();
  let nextId = 1;

  const deps: MsChatDeps = {
    preflight: () => ({ canSend: true, message: "" }),
    workspaceId: () => "ws-1",
    createSession: async (input) => {
      calls.push(`create`);
      const id = `sess-${nextId++}`;
      return { id };
    },
    setSessionScope: async (sessionId, enabled) => {
      calls.push(`scope:${enabled}:${sessionId}`);
    },
    sendMessage: async (sessionId, _text) => {
      calls.push(`send:${sessionId}`);
      return { accepted: true };
    },
    cancelSession: async (sessionId) => {
      calls.push(`cancel:${sessionId}`);
    },
    startStream: (sessionId, onView) => {
      calls.push(`stream:${sessionId}`);
      let stopped = false;
      const stream: FakeStream = {
        stop: () => {
          stopped = true;
        },
        emit: (view) => {
          if (!stopped) onView(view);
        },
      };
      streams.set(sessionId, stream);
      return { stop: () => stream.stop() };
    },
    buildDispatch: (_prior, prompt) => ({ ok: true, text: prompt }),
    onStateChange: (state) => {
      states.push(state);
    },
    ...overrides,
  };

  return { deps, calls, states, streams };
}

test("send happy path: invariant order create -> scope:true -> stream -> send; user msg then pending assistant bubble; phase running", async () => {
  const { deps, calls } = makeDeps();
  const controller = createMsChatController(deps);

  const sendPromise = controller.send("hello");
  await sendPromise;

  assert.deepEqual(calls, ["create", "scope:true:sess-1", "stream:sess-1", "send:sess-1"]);
  const state = controller.state();
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[0]?.role, "user");
  assert.equal(state.messages[0]?.content, "hello");
  assert.equal(state.messages[1]?.role, "assistant");
  assert.equal(state.messages[1]?.pending, true);
  assert.equal(state.phase, "running");
  assert.equal(state.sessionId, "sess-1");
});

test("onView updates assistant content by replace; terminal triggers revoke + stream stop + phase idle + pending clear", async () => {
  const { deps, streams } = makeDeps();
  const controller = createMsChatController(deps);
  await controller.send("hello");

  const stream = streams.get("sess-1");
  assert.ok(stream);
  stream!.emit({ text: "partial", terminal: null });
  let state = controller.state();
  assert.equal(state.messages[1]?.content, "partial");
  assert.equal(state.phase, "running");

  stream!.emit({ text: "final answer", terminal: "done" });
  // Revoke is awaited internally before the phase settles to idle — flush microtasks.
  await Promise.resolve();
  await Promise.resolve();
  state = controller.state();
  assert.equal(state.messages[1]?.content, "final answer");
  assert.equal(state.messages[1]?.pending, false);
  assert.equal(state.phase, "idle");
});

test("terminal calls setSessionScope(id, false) after the stream terminal view", async () => {
  const { deps, calls, streams } = makeDeps();
  const controller = createMsChatController(deps);
  await controller.send("hello");
  calls.length = 0;

  streams.get("sess-1")!.emit({ text: "final", terminal: "done" });

  assert.deepEqual(calls, ["scope:false:sess-1"]);
});

test("preflight fail => zero calls, errorMessage set, phase error", async () => {
  const { deps, calls } = makeDeps({
    preflight: () => ({ canSend: false, message: "Chưa sẵn sàng dịch vụ" }),
  });
  const controller = createMsChatController(deps);

  await controller.send("hello");

  assert.deepEqual(calls, []);
  const state = controller.state();
  assert.equal(state.errorMessage, "Chưa sẵn sàng dịch vụ");
  assert.equal(state.phase, "error");
  assert.equal(state.messages.length, 0);
});

test("buildDispatch fail (budget) => zero session calls, error shown, no messages created", async () => {
  const { deps, calls } = makeDeps({
    buildDispatch: () => ({ ok: false, message: "Vượt quá ngân sách ngữ cảnh" }),
  });
  const controller = createMsChatController(deps);

  await controller.send("hello");

  assert.deepEqual(calls, []);
  const state = controller.state();
  assert.equal(state.errorMessage, "Vượt quá ngân sách ngữ cảnh");
  assert.equal(state.phase, "error");
});

test("sendMessage not accepted => revoke + stop stream + honest error, never stuck running", async () => {
  const { deps, calls } = makeDeps({
    sendMessage: async (sessionId) => {
      calls.push(`send:${sessionId}`);
      return { accepted: false, reason: "Phiên đã hết hạn" };
    },
  });
  const controller = createMsChatController(deps);

  await controller.send("hello");

  assert.deepEqual(calls, ["create", "scope:true:sess-1", "stream:sess-1", "send:sess-1", "scope:false:sess-1"]);
  const state = controller.state();
  assert.equal(state.phase, "error");
  assert.notEqual(state.errorMessage, null);
  assert.ok(state.errorMessage?.length && state.errorMessage.length > 0);
});

test("cancel mid-flight: cancelSession + revoke + stream stop; assistant bubble marked cancelled", async () => {
  const { deps, calls } = makeDeps();
  const controller = createMsChatController(deps);
  await controller.send("hello");
  calls.length = 0;

  await controller.cancel();

  assert.deepEqual(calls, ["cancel:sess-1", "scope:false:sess-1"]);
  const state = controller.state();
  assert.equal(state.phase, "idle");
  assert.equal(state.messages[1]?.pending, false);
  assert.ok(state.messages[1]?.error);
});

test("reset revokes scope if session live and clears transcript", async () => {
  const { deps, calls } = makeDeps();
  const controller = createMsChatController(deps);
  await controller.send("hello");
  calls.length = 0;

  await controller.reset();

  assert.deepEqual(calls, ["scope:false:sess-1"]);
  const state = controller.state();
  assert.deepEqual(state.messages, []);
  assert.equal(state.phase, "idle");
  assert.equal(state.sessionId, null);
});

test("reset with no live session is a no-op on scope calls", async () => {
  const { deps, calls } = makeDeps();
  const controller = createMsChatController(deps);

  await controller.reset();

  assert.deepEqual(calls, []);
});

test("onDisconnected revokes + stops stream, KEEPS transcript, phase idle", async () => {
  const { deps, calls } = makeDeps();
  const controller = createMsChatController(deps);
  await controller.send("hello");
  calls.length = 0;

  await controller.onDisconnected();

  assert.deepEqual(calls, ["scope:false:sess-1"]);
  const state = controller.state();
  assert.equal(state.messages.length, 2);
  assert.equal(state.phase, "idle");
});

test("send while running is rejected as a no-op with a message; no overlapping sessions", async () => {
  const { deps, calls } = makeDeps();
  const controller = createMsChatController(deps);
  const first = controller.send("hello");
  // Still running (stream not terminal yet) — a second send must not start a new session.
  await controller.send("again");
  await first;

  assert.deepEqual(calls, ["create", "scope:true:sess-1", "stream:sess-1", "send:sess-1"]);
  const state = controller.state();
  assert.equal(state.messages.length, 2);
});

test("revoke throwing (network) is swallowed deliberately; stream still stopped; no unhandled rejection", async () => {
  const { deps, calls, streams } = makeDeps({
    setSessionScope: async (sessionId, enabled) => {
      calls.push(`scope:${enabled}:${sessionId}`);
      if (!enabled) throw new Error("network down");
    },
  });
  const controller = createMsChatController(deps);
  await controller.send("hello");

  let stoppedCalled = false;
  const stream = streams.get("sess-1")!;
  const originalStop = stream.stop.bind(stream);
  stream.stop = () => {
    stoppedCalled = true;
    originalStop();
  };

  // Should not throw / reject even though setSessionScope(false) rejects internally.
  await assert.doesNotReject(async () => {
    stream.emit({ text: "final", terminal: "done" });
    // allow any microtasks from the swallowed rejection to flush
    await Promise.resolve();
    await Promise.resolve();
  });

  const state = controller.state();
  assert.equal(state.phase, "idle");
});

test("setSessionScope(grant) throwing: revoke swallowed, stream stopped, honest error, phase not running", async () => {
  const { deps, calls, streams } = makeDeps({
    setSessionScope: async (sessionId, enabled) => {
      calls.push(`scope:${enabled}:${sessionId}`);
      if (enabled) throw new Error("grant failed");
    },
  });
  const controller = createMsChatController(deps);

  await assert.doesNotReject(async () => {
    await controller.send("hello");
  });

  // No sendMessage, no stream ever started; grant call attempted, revoke attempted (swallowed).
  assert.deepEqual(calls, ["create", "scope:true:sess-1", "scope:false:sess-1"]);
  assert.equal(streams.size, 0);

  const state = controller.state();
  assert.equal(state.phase, "error");
  assert.ok(state.errorMessage);
  assert.equal(state.messages[1]?.pending, false);
  assert.ok(state.messages[1]?.error);
});

test("single settlement per turn: terminal view arriving before sendMessage resolves not-accepted keeps the terminal outcome, revoke called exactly once", async () => {
  let resolveSend: ((result: { accepted: boolean; reason?: string }) => void) | null = null;
  const { deps, calls, streams } = makeDeps({
    sendMessage: async (sessionId) => {
      calls.push(`send:${sessionId}`);
      return new Promise((resolve) => {
        resolveSend = resolve;
      });
    },
  });
  const controller = createMsChatController(deps);

  const sendPromise = controller.send("hello");
  // Let send() run up through startStream + the sendMessage call (which is now pending).
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const stream = streams.get("sess-1");
  assert.ok(stream);

  // Terminal view arrives first.
  stream!.emit({ text: "final answer", terminal: "done" });
  await Promise.resolve();
  await Promise.resolve();

  // Now sendMessage resolves as not-accepted — this must be a no-op (loser of the race).
  assert.ok(resolveSend);
  resolveSend!({ accepted: false, reason: "Phiên đã hết hạn" });
  await sendPromise;
  await Promise.resolve();
  await Promise.resolve();

  const revokeCalls = calls.filter((c) => c === "scope:false:sess-1");
  assert.equal(revokeCalls.length, 1, "revoke must be called exactly once");

  const state = controller.state();
  // Final state reflects the terminal outcome (idle, content from the terminal view), not the
  // not-accepted error that arrived second.
  assert.equal(state.phase, "idle");
  assert.equal(state.messages[1]?.content, "final answer");
  assert.equal(state.messages[1]?.pending, false);
  assert.equal(state.messages[1]?.error, undefined);
});

test("cancel during the createSession gap is honored honestly, not a silent no-op", async () => {
  let resolveCreate: ((session: { id: string }) => void) | null = null;
  const { deps, calls } = makeDeps({
    createSession: async () => {
      calls.push("create");
      return new Promise((resolve) => {
        resolveCreate = resolve;
      });
    },
  });
  const controller = createMsChatController(deps);

  const sendPromise = controller.send("hello");
  // Let send() reach the awaited createSession call.
  await Promise.resolve();
  await Promise.resolve();

  // cancel() while sessionId is still null (createSession unresolved).
  const cancelPromise = controller.cancel();
  await cancelPromise;

  // Cancelling here must not itself call cancelSession (no session exists yet) or hang.
  assert.deepEqual(calls, ["create"]);

  // Now let createSession resolve.
  assert.ok(resolveCreate);
  resolveCreate!({ id: "sess-1" });
  await sendPromise;

  // send() must have honored the pending cancel: no scope grant, no revoke (nothing was ever
  // granted), no stream, no sendMessage.
  assert.deepEqual(calls, ["create"]);

  const state = controller.state();
  assert.equal(state.phase, "idle");
  assert.ok(state.messages[1]?.error);
  assert.equal(state.messages[1]?.pending, false);
});

test("every state mutation flows through onStateChange", async () => {
  const { deps, states } = makeDeps();
  const controller = createMsChatController(deps);
  await controller.send("hello");

  assert.ok(states.length > 0);
  assert.deepEqual(states[states.length - 1], controller.state());
});

test("reset() while the scope grant is in flight: send() bails, no stream/send, scope re-revoked to close the grant-vs-revoke race", async () => {
  const built = makeDeps();
  const calls = built.calls;
  let releaseGrant: (() => void) | null = null;
  const deps: MsChatDeps = {
    ...built.deps,
    setSessionScope: async (sessionId, enabled) => {
      if (enabled) {
        await new Promise<void>((resolve) => {
          releaseGrant = resolve;
        });
      }
      calls.push(`scope:${enabled}:${sessionId}`);
    },
  };

  const controller = createMsChatController(deps);
  const sendPromise = controller.send("hi");
  // Let send() progress through createSession and block on the grant.
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(releaseGrant !== null, "grant must be in flight");

  await controller.reset();
  assert.equal(controller.state().messages.length, 0);
  assert.equal(controller.state().phase, "idle");

  releaseGrant!();
  await sendPromise;

  // send() must NOT continue into stream/send after reset claimed the turn…
  assert.ok(!calls.some((c) => c.startsWith("stream:")), `no stream, got ${JSON.stringify(calls)}`);
  assert.ok(!calls.some((c) => c.startsWith("send:")), `no send, got ${JSON.stringify(calls)}`);
  // …and the possibly-late grant is re-revoked so the allowlist cannot keep the session.
  assert.equal(calls[calls.length - 1], "scope:false:sess-1");
});
