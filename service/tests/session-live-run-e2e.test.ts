/**
 * CGHC-028 live-run wiring — the WHOLE live chat path over the COMPOSED boundary, against the fake
 * OpenCode HTTP+SSE server (NO real OpenCode). Proves the product wire that Wave C found missing:
 *   UI → POST /v1/session → POST /v1/session/{id}/message → child /event → pump → hub → SSE →
 *   GET /v1/session/stream → UI, ending in a REAL `completed` terminal (EV7, never fabricated).
 * Also proves live cancel reaches the runtime abort, and a planted secret in a `session.error`
 * frame is value-redacted end-to-end. All awaits are bounded; servers close in `finally`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import { captureIdentity, type RuntimeProcessIdentity } from "@cowork-ghc/runtime";
import { startLiveCoworkService, type LiveRuntimeSupervisor, type LiveCoworkService } from "../src/composition/index.js";
import type { SupervisorStartSpec } from "../src/runtime/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import type { SettingsFs } from "../src/diagnostics/index.js";
import { decodeEvSseChunk } from "../src/execution/index.js";
import { EV_STREAM_PATH } from "../src/server/session-stream-route.js";
import { startFakeOpencodeServer, type FakeOpencodeServer, type OnPromptHook } from "./opencode-fake-server.js";

const WS = "C:/ws/live-run";
const NOW = (): string => "2026-07-12T00:00:00.000Z";
const PLANTED_KEY = "WoodenSpoon-Endpoint-Token-42"; // shape the sanitizer would MISS → value-scrub only
const START_SPEC: SupervisorStartSpec = {
  binPath: "C:/opencode/opencode.exe", cwd: WS, port: 65001,
  dataHome: "C:/tmp/data", configDir: "C:/tmp/config", injectionRequests: [],
};

function fakeSupervisor(fake: FakeOpencodeServer): LiveRuntimeSupervisor {
  let up = false;
  const identity: RuntimeProcessIdentity = captureIdentity({
    pid: 4321, startTime: NOW(), exePath: START_SPEC.binPath, port: 65001, host: "127.0.0.1",
  });
  return {
    isAlive: () => up,
    get baseUrl(): string | null { return up ? fake.baseUrl : null; },
    start: async (): Promise<RuntimeProcessIdentity> => { up = true; return identity; },
    stop: async (): Promise<void> => { up = false; },
  };
}

function memorySettingsFs(): SettingsFs {
  let data: string | undefined;
  return { read: () => Promise.resolve(data), write: (d) => { data = d; return Promise.resolve(); } };
}

async function startLive(onPrompt?: OnPromptHook): Promise<{ live: LiveCoworkService; fake: FakeOpencodeServer }> {
  const fake = await startFakeOpencodeServer();
  if (onPrompt) fake.setOnPrompt(onPrompt);
  const live = await startLiveCoworkService({
    supervisor: fakeSupervisor(fake), startSpec: START_SPEC, workspaceId: WS, now: NOW,
    service: { credentialStore: createMemoryStore(), settingsFs: memorySettingsFs() },
    seedScrubber: (scrubber) => scrubber.register(PLANTED_KEY),
  });
  return { live, fake };
}

const auth = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error(`${what} within ${ms}ms`); await sleep(5); }
}

async function createSession(base: string, token: string): Promise<string> {
  const res = await fetch(`${base}/v1/session`, {
    method: "POST", headers: { ...auth(token), "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: WS, title: "Live" }),
  });
  assert.equal(res.status, 201, "create session → 201");
  const body = (await res.json()) as { data: { session: { id: string } } };
  return body.data.session.id;
}

/** Open the SSE stream and read EV frames until a terminal arrives (or the bounded deadline). */
async function readEvents(base: string, token: string, sessionId: string, ms: number): Promise<readonly EvEvent[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  timer.unref?.();
  const res = await fetch(`${base}${EV_STREAM_PATH}?sessionId=${sessionId}`, { headers: auth(token), signal: ac.signal });
  assert.equal(res.status, 200, "SSE stream opens with a valid token");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: EvEvent[] = [];
  let buf = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      for (const ev of decodeEvSseChunk(buf)) events.push(ev);
      buf = "";
      if (events.some((e) => e.kind === "terminal")) break;
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
  return events;
}

const tool = (id: string, callId: string, status: string, input?: unknown): unknown => ({
  type: "message.part.updated",
  properties: { sessionID: id, part: { type: "tool", sessionID: id, callID: callId, tool: "write", state: { status, ...(input ? { input } : {}) } } },
});
const deltaFrame = (id: string, text: string): unknown => ({ type: "message.part.delta", properties: { sessionID: id, delta: text } });
const idleFrame = (id: string): unknown => ({ type: "session.idle", properties: { sessionID: id } });

test("live create → prompt → SSE EV stream → real completed terminal, over the composed boundary", { timeout: 15000 }, async () => {
  const { live, fake } = await startLive((id, _b, emit) => {
    emit(deltaFrame(id, "Hello "));
    emit(deltaFrame(id, "world"));
    emit(tool(id, "c1", "running"));
    emit(tool(id, "c1", "completed", { filePath: "C:/ws/live-run/out.txt" }));
    emit(idleFrame(id));
  });
  const base = live.running.baseUrl;
  const token = live.running.clientToken;
  try {
    const id = await createSession(base, token);
    await waitUntil(() => fake.eventClientCount() >= 1, 3000, "pump connected to /event");

    // Connect the SSE client FIRST (subscribes to the live run), THEN send the prompt.
    const streamP = readEvents(base, token, id, 8000);
    await sleep(50); // let the subscription attach before the prompt scripts frames
    const sent = await fetch(`${base}/v1/session/${id}/message`, {
      method: "POST", headers: { ...auth(token), "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(sent.status, 202, "the prompt is accepted (202); the response streams over SSE");

    const events = await streamP;
    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.includes("token"), "assistant tokens streamed");
    assert.ok(kinds.includes("tool_call"), "a tool_call streamed");
    assert.ok(kinds.includes("file_mutation"), "a file mutation streamed from the completed write");
    const terminal = events.at(-1);
    assert.equal(terminal?.kind, "terminal", "the terminal is the FINAL frame");
    assert.equal(terminal && terminal.kind === "terminal" ? terminal.state : "", "completed", "EV7: a REAL completed terminal (not fabricated)");
    // Ordering: token < tool_call < file_mutation < terminal.
    assert.ok(kinds.indexOf("token") < kinds.indexOf("tool_call"), "token before tool_call");
    assert.ok(kinds.indexOf("tool_call") <= kinds.lastIndexOf("file_mutation"), "tool_call before file_mutation");
    assert.ok(fake.requests.some((r) => r.method === "POST" && r.path === `/session/${id}/message`), "the prompt POST reached the live child");
  } finally {
    await live.stop();
    await fake.close();
  }
});

test("live cancel reaches the runtime abort over the composed boundary", { timeout: 15000 }, async () => {
  const { live, fake } = await startLive(() => undefined);
  const base = live.running.baseUrl;
  const token = live.running.clientToken;
  try {
    const id = await createSession(base, token);
    await waitUntil(() => fake.eventClientCount() >= 1, 3000, "pump connected");
    // Send a prompt so a stream handle is bound (cancel aborts at the source).
    await fetch(`${base}/v1/session/${id}/message`, {
      method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({ text: "go" }),
    });
    const cancelled = await fetch(`${base}/v1/session/${id}/cancel`, { method: "POST", headers: auth(token) });
    assert.equal(cancelled.status, 200, "cancel is accepted");
    await waitUntil(
      () => fake.requests.some((r) => r.method === "POST" && r.path === `/session/${id}/abort`),
      3000,
      "cancel reached the runtime abort",
    );
  } finally {
    await live.stop();
    await fake.close();
  }
});

test("a planted secret in a session.error frame is value-redacted end-to-end through the SSE stream", { timeout: 15000 }, async () => {
  const { live, fake } = await startLive((id, _b, emit) => {
    emit({ type: "session.error", properties: { sessionID: id, error: { name: "APIError", data: { message: `auth failed using key ${PLANTED_KEY} at endpoint` } } } });
  });
  const base = live.running.baseUrl;
  const token = live.running.clientToken;
  try {
    const id = await createSession(base, token);
    await waitUntil(() => fake.eventClientCount() >= 1, 3000, "pump connected");
    const streamP = readEvents(base, token, id, 8000);
    await sleep(50);
    await fetch(`${base}/v1/session/${id}/message`, {
      method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({ text: "boom" }),
    });
    const events = await streamP;
    const errorEv = events.find((e) => e.kind === "error");
    assert.ok(errorEv && errorEv.kind === "error", "the live path produced an EV error event");
    const msg = errorEv.kind === "error" ? errorEv.message : "";
    assert.equal(msg.includes(PLANTED_KEY), false, "the planted key VALUE is redacted on the live SSE path");
    assert.ok(msg.includes("[REDACTED]"), "the value scrubber placeholder is present");
    assert.equal(events.at(-1)?.kind, "terminal", "the error run ends in a real terminal");
  } finally {
    await live.stop();
    await fake.close();
  }
});
