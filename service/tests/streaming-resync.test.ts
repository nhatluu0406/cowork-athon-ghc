/**
 * CGHC-014 — reconnect resync + EV5 progress (S6 convergence).
 *
 * After a dropped stream, a snapshot + resume-from-seq must converge the consumer to the
 * AUTHORITATIVE SessionView: no stale `waiting`/`completed`, no duplicate or lost terminal.
 * Also asserts EV5 long-running progress ticks on a slow run (virtual time — no real sleeps).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import {
  createSessionStream,
  initialSessionView,
  planResync,
  reduceEv,
  type SessionView,
} from "../src/execution/index.js";
import {
  createManualScheduler,
  createRecorder,
  idleFrame,
  STREAM_SID,
  tokenFrame,
  toolFrame,
} from "./streaming-fakes.js";

/** Fold a slice of received events into a consumer view (the renderer's local fold). */
function foldReceived(start: SessionView, events: readonly EvEvent[]): SessionView {
  let view = start;
  for (const event of events) view = reduceEv(view, event);
  return view;
}

test("a reconnecting client adopts the authoritative snapshot and never keeps a stale live view", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  let authoritative: SessionView = initialSessionView(STREAM_SID);
  const stream = createSessionStream({
    sessionId: STREAM_SID,
    emit: rec.emit,
    apply: (event) => (authoritative = reduceEv(authoritative, event)),
    scheduler,
    windowMs: 40,
    maxBatchTokens: 999,
  });

  // Client is connected for the first part of the run.
  stream.ingest(toolFrame("c1", "running"));
  stream.ingest(tokenFrame("hel"));
  scheduler.advance(40); // flush tokens to the (still connected) consumer
  let consumer = foldReceived(initialSessionView(STREAM_SID), rec.events.slice());
  assert.equal(consumer.status, "running", "mid-run the consumer view is honestly running");
  const clientCursorAtDrop = consumer.lastSeq;

  // ---- STREAM DROPS: the consumer stops receiving. The run keeps going server-side. ----
  const droppedAt = rec.events.length;
  stream.ingest(toolFrame("c1", "completed"));
  stream.ingest(tokenFrame("lo"));
  stream.ingest(idleFrame()); // authoritative run reaches a terminal the client never saw
  // (emissions after droppedAt represent frames the client missed on the wire.)

  // ---- RECONNECT: the client presents its last-seen seq and adopts the snapshot. ----
  const plan = stream.resync(clientCursorAtDrop);
  assert.equal(plan.replaced, true, "the stale cursor is behind the authoritative lastSeq");
  assert.equal(plan.resumeSeq, authoritative.lastSeq);
  // The client REPLACES its stale (running) view with the authoritative snapshot.
  consumer = plan.snapshot;
  assert.equal(consumer.status, "completed", "converged to the authoritative terminal state");
  assert.equal(consumer.terminal, "completed", "the missed terminal is not lost");
  assert.notEqual(consumer.status, "running", "no stale live view survives the resync");

  // Any live events the client resumes with are only those AFTER resumeSeq; a re-sent tail is
  // idempotently dropped, so the terminal is never duplicated.
  const resumedTail = rec.events.slice(droppedAt).filter((e) => e.seq > plan.resumeSeq);
  const afterResume = foldReceived(consumer, resumedTail);
  assert.equal(afterResume.terminal, "completed");
  assert.equal(afterResume.lastSeq, authoritative.lastSeq, "no double-count past the snapshot");
});

test("planResync converges a client that is impossibly AHEAD back to the server truth", () => {
  const view: SessionView = { ...initialSessionView(STREAM_SID), status: "completed", terminal: "completed", lastSeq: 5 };
  const plan = planResync(view, 99); // client claims a higher seq than the server ever emitted
  assert.equal(plan.resumeSeq, 5, "authoritative lastSeq wins");
  assert.equal(plan.replaced, true);
  assert.equal(plan.snapshot.status, "completed");
});

test("planResync on an exact-match cursor needs no replacement", () => {
  const view: SessionView = { ...initialSessionView(STREAM_SID), status: "running", lastSeq: 7 };
  const plan = planResync(view, 7);
  assert.equal(plan.replaced, false, "an up-to-date client keeps its view; resume where it left off");
  assert.equal(plan.resumeSeq, 7);
});

test("EV5 progress ticks on a slow run and stops at the terminal (no false 'still working')", () => {
  const scheduler = createManualScheduler();
  const rec = createRecorder();
  let authoritative: SessionView = initialSessionView(STREAM_SID);
  const stream = createSessionStream({
    sessionId: STREAM_SID,
    emit: rec.emit,
    apply: (event) => (authoritative = reduceEv(authoritative, event)),
    scheduler,
    windowMs: 40,
    maxBatchTokens: 999,
    progressIntervalMs: 100,
    progressLabel: "Working",
  });

  stream.ingest(toolFrame("c1", "running")); // activity starts -> ticker arms
  scheduler.advance(100);
  scheduler.advance(100);
  const progressCount = rec.events.filter((e) => e.kind === "progress").length;
  assert.ok(progressCount >= 2, `slow run conveyed progress (${progressCount} EV5 ticks)`);

  stream.ingest(idleFrame()); // terminal -> ticker stops
  const before = rec.events.filter((e) => e.kind === "progress").length;
  scheduler.advance(1000);
  const after = rec.events.filter((e) => e.kind === "progress").length;
  assert.equal(after, before, "no progress emitted after the run reaches a terminal");

  // Progress is a transient no-op for the fold: it never inflates seq nor changes stored state.
  let consumer: SessionView = initialSessionView(STREAM_SID);
  for (const event of rec.events) consumer = reduceEv(consumer, event);
  assert.equal(consumer.status, "completed");
});
