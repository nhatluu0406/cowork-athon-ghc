/**
 * CGHC-014 — streaming lifecycle + coalescing/backpressure policy (risk R7).
 *
 * Asserts EV events flow runtime-mapper → coordinator → consumer; that high-frequency S2
 * tokens are COALESCED within the window while state-changing (tool/error/terminal) events
 * FLUSH PROMPTLY; that ordering is preserved; and that a burst of N token deltas does NOT
 * produce N unbatched emissions. Uses a virtual scheduler — NO real sleeps.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import {
  createSessionStream,
  createStreamCoordinator,
  initialSessionView,
  reduceEv,
  type SessionView,
} from "../src/execution/index.js";
import {
  createManualScheduler,
  createRecorder,
  idleFrame,
  STREAM_AT,
  STREAM_SID,
  terminalEv,
  tokenEv,
  tokenFrame,
  toolFrame,
} from "./streaming-fakes.js";

test("a burst of token deltas coalesces into ONE emission within the window", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  const coord = createStreamCoordinator({ emit: rec.emit, scheduler, windowMs: 40, maxBatchTokens: 999 });

  for (let i = 1; i <= 12; i += 1) coord.push(tokenEv(i, `t${i}`));
  assert.equal(rec.events.length, 0, "nothing emitted before the window fires");

  scheduler.advance(40); // window elapses
  assert.equal(rec.events.length, 1, "12 deltas -> 1 coalesced token emission");
  assert.equal(rec.events[0]?.kind, "token");
  assert.equal(rec.tokensText(), "t1t2t3t4t5t6t7t8t9t10t11t12");
  assert.equal(rec.events[0]?.seq, 12, "coalesced token carries the LAST seq");
});

test("count cap forces a flush before the window when a burst is large", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  const coord = createStreamCoordinator({ emit: rec.emit, scheduler, windowMs: 1000, maxBatchTokens: 4 });

  for (let i = 1; i <= 10; i += 1) coord.push(tokenEv(i, "x"));
  // 10 tokens, cap 4 -> two full batches flushed synchronously (8 tokens), 2 still pending.
  assert.equal(rec.events.length, 2, "count cap bounds burst latency without the timer");
  scheduler.advance(1000);
  assert.equal(rec.events.length, 3, "remaining 2 flush on the window");
  assert.equal(rec.tokensText(), "xxxxxxxxxx");
});

test("a state-changing event flushes pending tokens FIRST, then emits promptly (ordering)", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  const coord = createStreamCoordinator({ emit: rec.emit, scheduler, windowMs: 40, maxBatchTokens: 999 });

  coord.push(tokenEv(1, "Hel"));
  coord.push(tokenEv(2, "lo"));
  const tool: EvEvent = { sessionId: STREAM_SID, seq: 3, at: STREAM_AT, kind: "tool_call", callId: "c1", toolName: "write", status: "running" };
  coord.push(tool); // no time advance: tokens must flush immediately before the tool call

  assert.deepEqual(rec.kinds(), ["token", "tool_call"], "tokens flushed before the state event");
  assert.equal(rec.tokensText(), "Hello");
  assert.equal(scheduler.pending(), 0, "the token window timer was cancelled on the prompt flush");
});

test("a terminal flushes pending tokens then ends the stream; post-terminal noise is dropped", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  const coord = createStreamCoordinator({ emit: rec.emit, scheduler, windowMs: 40 });

  coord.push(tokenEv(1, "done "));
  coord.push(terminalEv(2, "completed"));
  assert.deepEqual(rec.kinds(), ["token", "terminal"]);
  assert.ok(coord.isTerminated());

  // Anything after the terminal is dropped (never fabricate/reorder past the honest end).
  coord.push(tokenEv(3, "late"));
  coord.push(terminalEv(4, "errored"));
  scheduler.advance(1000);
  assert.deepEqual(rec.kinds(), ["token", "terminal"], "no post-terminal emissions");
});

test("close() mid-window flushes pending tokens and leaves no armed timer (review LOW: no leak)", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  let authoritative: SessionView = initialSessionView(STREAM_SID);
  const stream = createSessionStream({
    sessionId: STREAM_SID,
    emit: rec.emit,
    apply: (event) => (authoritative = reduceEv(authoritative, event)),
    scheduler,
    now: () => STREAM_AT,
    windowMs: 40,
    maxBatchTokens: 999,
  });

  stream.ingest(tokenFrame("par"));
  stream.ingest(tokenFrame("tial"));
  assert.equal(rec.events.length, 0, "still inside the window — nothing emitted yet");

  stream.close(); // an idle-cut / disconnect mid-window must not strand or leak.
  assert.equal(rec.tokensText(), "partial", "close flushes the pending token buffer");
  assert.equal(scheduler.pending(), 0, "no armed window/progress timer leaks after close");
});

test("full lifecycle: raw frames -> session-stream -> consumer, coalesced, and the folded consumer view matches the authoritative snapshot", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  // Authoritative fold (stands in for the session task-registry).
  let authoritative: SessionView = initialSessionView(STREAM_SID);
  const stream = createSessionStream({
    sessionId: STREAM_SID,
    emit: rec.emit,
    apply: (event) => (authoritative = reduceEv(authoritative, event)),
    scheduler,
    now: () => STREAM_AT,
    windowMs: 40,
    maxBatchTokens: 999,
  });

  stream.ingest(tokenFrame("Hel"));
  stream.ingest(tokenFrame("lo "));
  stream.ingest(toolFrame("c1", "completed")); // state event -> flush tokens then tool_call
  stream.ingest(tokenFrame("world"));
  stream.ingest(idleFrame()); // terminal completed -> flush + end
  stream.flush();

  // Consumer folds exactly what it received off the wire.
  let consumer: SessionView = initialSessionView(STREAM_SID);
  for (const event of rec.events) consumer = reduceEv(consumer, event);

  assert.equal(consumer.text, "Hello world", "coalesced tokens still concatenate correctly");
  assert.equal(consumer.status, "completed");
  assert.equal(consumer.terminal, "completed");
  assert.equal(consumer.toolCalls.length, 1);
  // The consumer converges to the authoritative snapshot the service holds.
  assert.equal(consumer.text, stream.snapshot().text);
  assert.equal(consumer.status, stream.snapshot().status);
  assert.equal(consumer.lastSeq, stream.snapshot().lastSeq);
  // Coalescing really happened: far fewer emissions than the 4 token frames + 2 state events.
  const tokenEmissions = rec.events.filter((e) => e.kind === "token").length;
  assert.ok(tokenEmissions <= 2, `tokens coalesced (${tokenEmissions} token emissions)`);
});
