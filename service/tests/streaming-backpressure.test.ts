/**
 * CGHC-014 — backpressure (risk R7).
 *
 * A slow consumer must not cause unbounded buffering or lose a state-changing event.
 * Coalescing bounds the token load to a SINGLE accumulator regardless of burst size, and a
 * terminal is NEVER dropped. Virtual scheduler — NO real sleeps.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import { createStreamCoordinator, initialSessionView, reduceEv, type SessionView } from "../src/execution/index.js";
import {
  createManualScheduler,
  createRecorder,
  STREAM_AT,
  STREAM_SID,
  terminalEv,
  tokenEv,
} from "./streaming-fakes.js";

function stepEv(seq: number, id: string): EvEvent {
  return { sessionId: STREAM_SID, seq, at: STREAM_AT, kind: "step", stepId: id, label: "s", status: "running" };
}

test("a huge token burst stays bounded to one accumulator (no unbounded buffering)", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  // A slow consumer: model it as one that only drains on a window boundary. With a large count
  // cap, thousands of deltas between windows accumulate into ONE pending buffer, not a queue.
  const coord = createStreamCoordinator({ emit: rec.emit, scheduler, windowMs: 50, maxBatchTokens: 100_000 });

  const N = 5_000;
  for (let i = 1; i <= N; i += 1) coord.push(tokenEv(i, "a"));
  assert.equal(rec.events.length, 0, "no per-token emission while the consumer is slow");

  scheduler.advance(50);
  assert.equal(rec.events.length, 1, `${N} deltas coalesced into a single emission`);
  assert.equal((rec.events[0] as Extract<EvEvent, { kind: "token" }>).delta.length, N);
});

test("state-changing events are never dropped even when interleaved with token spam", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  const coord = createStreamCoordinator({ emit: rec.emit, scheduler, windowMs: 50, maxBatchTokens: 100_000 });

  let seq = 0;
  const next = () => (seq += 1);
  // Interleave: many tokens, a step, many tokens, another step, tokens, then a terminal.
  for (let i = 0; i < 500; i += 1) coord.push(tokenEv(next(), "x"));
  coord.push(stepEv(next(), "s1"));
  for (let i = 0; i < 500; i += 1) coord.push(tokenEv(next(), "x"));
  coord.push(stepEv(next(), "s2"));
  for (let i = 0; i < 500; i += 1) coord.push(tokenEv(next(), "x"));
  coord.push(terminalEv(next(), "completed"));

  const kinds = rec.kinds();
  assert.equal(kinds.filter((k) => k === "step").length, 2, "both step events survived");
  assert.equal(kinds.filter((k) => k === "terminal").length, 1, "the terminal was delivered");
  assert.equal(kinds[kinds.length - 1], "terminal", "the terminal is the final emission");
  // Ordering: the two steps and terminal appear in seq order among the coalesced tokens.
  const stateOrder = rec.events.filter((e) => e.kind !== "token").map((e) => e.seq);
  assert.deepEqual(stateOrder, [...stateOrder].sort((a, b) => a - b), "state events stay ordered");

  // The consumer's fold is correct and terminal despite the token flood.
  let consumer: SessionView = initialSessionView(STREAM_SID);
  for (const event of rec.events) consumer = reduceEv(consumer, event);
  assert.equal(consumer.status, "completed");
  assert.equal(consumer.steps.length, 2);
});

test("token emissions are bounded far below the token count (coalescing bounds the UI load)", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  const coord = createStreamCoordinator({ emit: rec.emit, scheduler, windowMs: 40, maxBatchTokens: 64 });

  const N = 2_000;
  for (let i = 1; i <= N; i += 1) coord.push(tokenEv(i, "z"));
  scheduler.advance(40);
  const tokenEmissions = rec.events.filter((e) => e.kind === "token").length;
  // Only count-cap flushes + one final window flush — orders of magnitude below N.
  assert.ok(tokenEmissions <= Math.ceil(N / 64) + 1, `bounded token emissions: ${tokenEmissions} for ${N} deltas`);
  assert.ok(tokenEmissions < N / 10, "far fewer emissions than deltas");
});
