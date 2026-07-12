/**
 * CGHC-015 — live EV SSE stream, end-to-end over a REAL loopback socket.
 *
 * A real `createService` server (via `startService`) mounts the live `createSessionStreamRouter`
 * and is driven over an actual TCP socket to `EV_STREAM_PATH`, proving the socket-level guarantees
 * the in-memory coordinator tests cannot: fail-closed token guard, coalescing under a slow consumer,
 * terminal-once-and-last, resume-from-seq dedupe, already-terminal fast close, and disconnect
 * teardown. NO real multi-second sleeps — injected heartbeat + virtual scheduler + bounded awaits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import { startService } from "../src/index.js";
import { createStreamCoordinator, decodeEvSseChunk, initialSessionView, reduceEv, type SessionView } from "../src/execution/index.js";
import { createSessionStreamRouter, EV_STREAM_PATH, type IntervalScheduler } from "../src/server/session-stream-route.js";
import type { EvListener, SessionEventSource } from "../src/server/session-stream-hub.js";
import { createManualScheduler, STREAM_AT, STREAM_SID, terminalEv, tokenEv } from "./streaming-fakes.js";

const SID = STREAM_SID;
const BURST = 300; // modest burst: fast, cannot hang, still orders of magnitude over the coalesced count.

// --- bounded-await helpers (STALL AVOIDANCE: every socket read has a hard deadline) ------------
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    t.unref?.();
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`${what} not satisfied within ${timeoutMs}ms`);
    await sleep(10);
  }
}

/** Read the whole SSE body until the server closes it (or timeout). Heartbeat comment frames carry
 *  no `data:` line, so `decodeEvSseChunk` drops them — only real EV frames are returned. */
async function readAll(res: Response, timeoutMs: number): Promise<{ events: readonly EvEvent[]; done: boolean }> {
  const body = res.body;
  if (!body) return { events: [], done: true };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buf = "";
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { events: decodeEvSseChunk(buf), done: false };
      const chunk = await withTimeout(reader.read(), remaining, "socket read");
      if (chunk.done) return { events: decodeEvSseChunk(buf), done: true };
      buf += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function openStream(baseUrl: string, query: string, token: string, ms = 3000): Promise<{ res: Response; ac: AbortController }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("connect timeout")), ms);
  try {
    const res = await fetch(`${baseUrl}${EV_STREAM_PATH}${query}`, { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
    return { res, ac };
  } finally {
    clearTimeout(timer);
  }
}

// --- controllable fakes -----------------------------------------------------------------------
interface FakeIntervals extends IntervalScheduler {
  setCount(): number;
  clearCount(): number;
}
function makeIntervals(): FakeIntervals {
  let sets = 0;
  let clears = 0;
  return { set: () => (sets += 1, () => void (clears += 1)), setCount: () => sets, clearCount: () => clears };
}

interface Controllable {
  source: SessionEventSource;
  emit(event: EvEvent): void;
  unsubscribeCount(): number;
}
/** A hand-driven `SessionEventSource`: `view()` reports the given snapshot; `emit` drives listeners. */
function makeControllable(viewFn: () => SessionView | undefined): Controllable {
  const listeners = new Set<EvListener>();
  let unsub = 0;
  const source: SessionEventSource = {
    view: (id) => (id === SID ? viewFn() : undefined),
    subscribe: (id, listener) => {
      if (id !== SID) return undefined;
      listeners.add(listener);
      return { close: () => void (unsub += 1, listeners.delete(listener)) };
    },
  };
  return { source, emit: (event) => { for (const l of [...listeners]) l(event); }, unsubscribeCount: () => unsub };
}

const HEARTBEAT = { heartbeatMs: 10_000 } as const;
const liveView = (): SessionView => initialSessionView(SID);
const terminalView = (): SessionView =>
  reduceEv(initialSessionView(SID), { sessionId: SID, seq: 1, at: STREAM_AT, kind: "terminal", state: "completed" });
const planEv = (seq: number): EvEvent => ({ sessionId: SID, seq, at: STREAM_AT, kind: "plan", todos: [{ id: "t1", title: "do", status: "pending" }] });
const toolEv = (seq: number): EvEvent => ({ sessionId: SID, seq, at: STREAM_AT, kind: "tool_call", callId: "c1", toolName: "write", status: "running" });
// --- R1: token guard fail-closed --------------------------------------------------------------
test("R1 token guard fail-closed: no/invalid token → no SSE; valid token → stream opens", { timeout: 6000 }, async () => {
  const running = await startService({ routers: [createSessionStreamRouter(makeControllable(liveView).source, { intervals: makeIntervals(), ...HEARTBEAT })] });
  try {
    const url = `${running.baseUrl}${EV_STREAM_PATH}?sessionId=${SID}`;
    const noTok = await withTimeout(fetch(url), 3000, "no-token fetch");
    assert.equal(noTok.status, 401, "no token is rejected before any stream opens");
    assert.ok(!(noTok.headers.get("content-type") ?? "").startsWith("text/event-stream"), "no SSE body on 401");
    assert.equal(((await noTok.json()) as { error: { code: string } }).error.code, "unauthorized");

    const badTok = await withTimeout(fetch(url, { headers: { authorization: "Bearer invalidtokeninvalidtokeninvalid00" } }), 3000, "bad-token fetch");
    assert.equal(badTok.status, 403, "an invalid token is forbidden");
    assert.equal(((await badTok.json()) as { error: { code: string } }).error.code, "forbidden");

    const { res, ac } = await openStream(running.baseUrl, `?sessionId=${SID}`, running.clientToken);
    try {
      assert.equal(res.status, 200, "a valid token opens the stream");
      assert.ok((res.headers.get("content-type") ?? "").startsWith("text/event-stream"), "SSE content-type");
    } finally {
      ac.abort();
      await res.body?.cancel().catch(() => undefined);
    }
  } finally {
    await running.service.stop();
  }
});
// --- R7: slow consumer / backpressure via the real coalescing coordinator ----------------------
test("R7 slow consumer: a token burst coalesces to a few frames; no state event is dropped", { timeout: 6000 }, async () => {
  const scheduler = createManualScheduler();
  const listeners = new Set<EvListener>();
  let view: SessionView = initialSessionView(SID);
  const coord = createStreamCoordinator({
    emit: (event) => { view = reduceEv(view, event); for (const l of [...listeners]) l(event); },
    scheduler, windowMs: 50, maxBatchTokens: 100_000,
  });
  const source: SessionEventSource = {
    view: (id) => (id === SID ? view : undefined),
    subscribe: (id, listener) => { if (id !== SID) return undefined; listeners.add(listener); return { close: () => void listeners.delete(listener) }; },
  };
  const running = await startService({ routers: [createSessionStreamRouter(source, { intervals: makeIntervals(), ...HEARTBEAT })] });
  const { res, ac } = await openStream(running.baseUrl, `?sessionId=${SID}`, running.clientToken);
  try {
    assert.equal(res.status, 200);
    let seq = 0;
    const next = (): number => (seq += 1);
    // Drive a burst to a deliberately unread (slow) socket: state events flush pending tokens.
    for (let i = 0; i < BURST; i += 1) coord.push(tokenEv(next(), "a"));
    coord.push(planEv(next()));
    for (let i = 0; i < BURST; i += 1) coord.push(tokenEv(next(), "b"));
    coord.push(toolEv(next()));
    coord.push(terminalEv(next(), "completed")); // flushes remaining tokens, then terminal → route ends the stream
    const { events, done } = await readAll(res, 3000);
    assert.ok(done, "the server closed the socket on the terminal (bounded, not hung)");
    const tokenFrames = events.filter((e) => e.kind === "token").length;
    assert.ok(tokenFrames < (2 * BURST) / 10, `token frames coalesced far below the burst: ${tokenFrames} << ${2 * BURST}`);
    assert.equal(events.filter((e) => e.kind === "plan").length, 1, "the plan (state event) survived the flood");
    assert.equal(events.filter((e) => e.kind === "tool_call").length, 1, "the tool_call survived the flood");
    assert.equal(events.filter((e) => e.kind === "terminal").length, 1, "exactly one terminal");
  } finally {
    ac.abort();
    await running.service.stop();
  }
});
// --- R2: terminal delivered exactly once, and LAST; server closes the socket --------------------
test("R2 terminal is delivered exactly once, is the final frame, and closes the socket", { timeout: 6000 }, async () => {
  const src = makeControllable(liveView);
  const running = await startService({ routers: [createSessionStreamRouter(src.source, { intervals: makeIntervals(), ...HEARTBEAT })] });
  const { res, ac } = await openStream(running.baseUrl, `?sessionId=${SID}`, running.clientToken);
  try {
    assert.equal(res.status, 200);
    src.emit(tokenEv(1, "hello"));
    src.emit(terminalEv(2, "completed"));
    src.emit(tokenEv(3, "post-terminal-noise")); // must NOT reach the client (listener torn down on end)
    const { events, done } = await readAll(res, 3000);
    assert.ok(done, "the socket ended after the terminal");
    assert.equal(events.filter((e) => e.kind === "terminal").length, 1, "the terminal is delivered exactly once");
    assert.equal(events.at(-1)?.kind, "terminal", "the terminal is the final frame");
    assert.ok(!events.some((e) => e.kind === "token" && e.delta === "post-terminal-noise"), "no post-terminal noise");
  } finally {
    ac.abort();
    await running.service.stop();
  }
});
// --- R3: resume-from-seq dedupe ---------------------------------------------------------------
test("R3 resume-from-seq: events with seq <= sinceSeq are not re-delivered; seq > sinceSeq are", { timeout: 6000 }, async () => {
  const src = makeControllable(liveView);
  const running = await startService({ routers: [createSessionStreamRouter(src.source, { intervals: makeIntervals(), ...HEARTBEAT })] });
  const { res, ac } = await openStream(running.baseUrl, `?sessionId=${SID}&sinceSeq=5`, running.clientToken);
  try {
    assert.equal(res.status, 200);
    src.emit(tokenEv(3, "already-had-3")); // seq < 5 → dropped (the snapshot already carried it)
    src.emit(tokenEv(5, "already-had-5")); // seq == 5 → dropped
    src.emit(tokenEv(6, "fresh-6")); // seq > 5 → delivered
    src.emit(terminalEv(7, "completed"));
    const { events, done } = await readAll(res, 3000);
    assert.ok(done);
    assert.deepEqual(events.filter((e) => e.kind === "token").map((e) => e.delta), ["fresh-6"], "only the post-cursor token is delivered");
    assert.equal(events.at(-1)?.kind, "terminal");
  } finally {
    ac.abort();
    await running.service.stop();
  }
});
// --- R4: already-terminal at connect ----------------------------------------------------------
test("R4 already-terminal at connect: the stream opens then closes immediately, no heartbeat armed", { timeout: 6000 }, async () => {
  const intervals = makeIntervals();
  const running = await startService({ routers: [createSessionStreamRouter(makeControllable(terminalView).source, { intervals, ...HEARTBEAT })] });
  const { res, ac } = await openStream(running.baseUrl, `?sessionId=${SID}`, running.clientToken);
  try {
    assert.equal(res.status, 200, "the stream still opens (headers), then ends");
    const { events, done } = await readAll(res, 3000);
    assert.ok(done, "the socket closed immediately for a finished run");
    assert.equal(events.length, 0, "no live EV frames for an already-terminal run");
    assert.equal(intervals.setCount(), 0, "no fake keep-alive heartbeat is armed on a finished run");
  } finally {
    ac.abort();
    await running.service.stop();
  }
});
// --- R5: disconnect teardown ------------------------------------------------------------------
test("R5 disconnect teardown: aborting mid-stream unsubscribes the source and clears the heartbeat", { timeout: 6000 }, async () => {
  const intervals = makeIntervals();
  const src = makeControllable(liveView);
  const running = await startService({ routers: [createSessionStreamRouter(src.source, { intervals, ...HEARTBEAT })] });
  const { res, ac } = await openStream(running.baseUrl, `?sessionId=${SID}`, running.clientToken);
  try {
    assert.equal(res.status, 200);
    assert.equal(intervals.setCount(), 1, "a heartbeat is armed for a live run");
    assert.equal(src.unsubscribeCount(), 0, "still subscribed while connected");
    ac.abort(); // client vanishes mid-stream (window closed / network cut)
    await res.body?.cancel().catch(() => undefined);
    await waitUntil(() => src.unsubscribeCount() === 1 && intervals.clearCount() === 1, 3000, "teardown");
    assert.equal(src.unsubscribeCount(), 1, "the source subscription was closed on disconnect");
    assert.equal(intervals.clearCount(), 1, "the heartbeat interval was cleared on disconnect");
  } finally {
    await running.service.stop();
  }
});
