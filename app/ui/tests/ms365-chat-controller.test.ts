import { test } from "node:test";
import assert from "node:assert/strict";
import { createMs365ChatController } from "../src/ms365-chat-controller.js";

function fakeDeps(overrides?: {
  setMs365SessionScope?: (calls: string[], sid: string, enabled: boolean) => Promise<{ allowed: boolean }>;
}) {
  const calls: string[] = [];
  let connected = true;
  const client = {
    createConversation: async (input: { surface?: string }) => { calls.push(`createConversation:${input.surface}`); return { id: "conv-1" } as never; },
    createSession: async () => { calls.push("createSession"); return { id: "sess-1" } as never; },
    setMs365SessionScope: overrides?.setMs365SessionScope
      ? (sid: string, enabled: boolean) => overrides.setMs365SessionScope!(calls, sid, enabled)
      : async (sid: string, enabled: boolean) => { calls.push(`scope:${sid}:${enabled}`); return { allowed: enabled }; },
    sendSessionMessage: async (sid: string, text: string) => { calls.push(`send:${sid}:${text}`); return { accepted: true, sessionId: sid }; },
  };
  const startStream = (sid: string) => { calls.push(`stream:${sid}`); return { stop() {}, done: Promise.resolve() }; };
  return {
    calls,
    setConnected: (v: boolean) => { connected = v; },
    controller: createMs365ChatController({
      getClient: () => client as never,
      isConnected: () => connected,
      workspacePath: () => "C:\\ws",
      startStream: startStream as never,
    }),
  };
}

test("not connected: send does nothing", async () => {
  const d = fakeDeps();
  d.setConnected(false);
  await d.controller.send("hi");
  assert.deepEqual(d.calls, []);
});

test("first send: create ms365 conversation + session + scope once + stream + send", async () => {
  const d = fakeDeps();
  await d.controller.send("hello");
  assert.deepEqual(d.calls, [
    "createConversation:ms365",
    "createSession",
    "scope:sess-1:true",
    "stream:sess-1",
    "send:sess-1:hello",
  ]);
});

test("second send reuses the session and does NOT re-scope", async () => {
  const d = fakeDeps();
  await d.controller.send("one");
  await d.controller.send("two");
  const scopeCalls = d.calls.filter((c) => c.startsWith("scope:"));
  assert.deepEqual(scopeCalls, ["scope:sess-1:true"]);
  assert.ok(d.calls.includes("send:sess-1:two"));
});

test("disconnect revokes scope and clears the session", async () => {
  const d = fakeDeps();
  await d.controller.send("one");
  await d.controller.disconnect();
  assert.ok(d.calls.includes("scope:sess-1:false"));
  await d.controller.send("again");
  // a fresh session/scope cycle happens again
  assert.equal(d.calls.filter((c) => c === "createSession").length, 2);
});

test("half-init: a failed scope-allow leaves sessionId null so the next send retries cleanly", async () => {
  let scopeShouldThrow = true;
  const d = fakeDeps({
    setMs365SessionScope: async (calls, sid, enabled) => {
      calls.push(`scope:${sid}:${enabled}`);
      if (scopeShouldThrow) throw new Error("scope service down");
      return { allowed: enabled };
    },
  });

  // First send: scope throws → send rejects, and NO prompt was sent to an un-scoped session.
  await assert.rejects(d.controller.send("one"));
  assert.equal(d.controller.runtimeSessionId, null, "sessionId must stay null after a failed allow");
  assert.ok(!d.calls.some((c) => c.startsWith("send:")), "must NOT send into an un-allowed session");
  assert.ok(!d.calls.includes("stream:sess-1"), "stream must not open when allow failed");

  // Second send: scope now succeeds → full ensureSession runs and the prompt is sent.
  scopeShouldThrow = false;
  await d.controller.send("two");
  assert.equal(d.controller.runtimeSessionId, "sess-1");
  assert.ok(d.calls.includes("scope:sess-1:true"));
  assert.ok(d.calls.includes("stream:sess-1"));
  assert.ok(d.calls.includes("send:sess-1:two"));
});

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

  await assert.rejects(controller.disconnect()); // revoke throws internally, re-thrown to caller
  assert.equal(controller.runtimeSessionId, null, "session cleared despite revoke throwing");
  assert.equal(stopped, true, "stream stopped despite revoke throwing");
});

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

test("adoptConversation sets conversationId + resets session; next send does NOT create a conversation", async () => {
  const calls: string[] = [];
  const client = {
    createConversation: async () => { calls.push("createConversation"); return { id: "conv-NEW" } as never; },
    createSession: async () => { calls.push("createSession"); return { id: "sess-1" } as never; },
    setMs365SessionScope: async (sid: string, enabled: boolean) => { calls.push(`scope:${sid}:${enabled}`); return { allowed: enabled }; },
    sendSessionMessage: async (sid: string, text: string) => { calls.push(`send:${sid}:${text}`); return { accepted: true, sessionId: sid }; },
  };
  const controller = createMs365ChatController({
    getClient: () => client as never, isConnected: () => true, workspacePath: () => "C:\\ws",
    startStream: ((sid: string) => { calls.push(`stream:${sid}`); return { stop() {}, done: Promise.resolve() }; }) as never,
  });
  controller.adoptConversation("conv-OLD");
  assert.equal(controller.conversationId, "conv-OLD");
  await controller.send("hi");
  assert.ok(!calls.includes("createConversation"), "must NOT create a new conversation when one was adopted");
  assert.ok(calls.includes("createSession") && calls.includes("scope:sess-1:true"), "new session + scope for continuation");
  assert.ok(calls.includes("send:sess-1:hi"));
});

test("resetConversation clears conversationId so the next send creates a fresh conversation", async () => {
  const calls: string[] = [];
  const client = {
    createConversation: async () => { calls.push("createConversation"); return { id: "conv-NEW" } as never; },
    createSession: async () => ({ id: "sess-1" } as never),
    setMs365SessionScope: async (_sid: string, enabled: boolean) => ({ allowed: enabled }),
    sendSessionMessage: async (sid: string) => ({ accepted: true, sessionId: sid }),
  };
  const controller = createMs365ChatController({
    getClient: () => client as never, isConnected: () => true, workspacePath: () => "C:\\ws",
    startStream: (() => ({ stop() {}, done: Promise.resolve() })) as never,
  });
  controller.adoptConversation("conv-OLD");
  controller.resetConversation();
  assert.equal(controller.conversationId, null);
  await controller.send("hi");
  assert.ok(calls.includes("createConversation"), "fresh conversation created after reset");
  assert.equal(controller.conversationId, "conv-NEW");
});
