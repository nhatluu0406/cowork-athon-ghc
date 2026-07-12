/**
 * CGHC-028 FIX-3 — the session-stream hub must not LEAK an empty lazily-created run.
 *
 * `subscribe` lazy-creates a live run for a known non-terminal session so the renderer can attach
 * BEFORE the first `/event` frame. If that client disconnects before any frame (and the pump never
 * claims the run via `open`), the run must be EVICTED from the hub's registry — otherwise it leaks
 * forever (the pump only reaps runs IT opened). These tests pin the eviction condition (zero
 * listeners AND no ingested frame AND not pump-claimed) and prove it never drops an active/ingested/
 * pump-owned run and never fabricates a run for an unknown/terminal session.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent, SessionId } from "@cowork-ghc/contracts";
import { createSessionStreamHub } from "../src/server/session-stream-hub.js";
import { initialSessionView, reduceEv, type SessionView } from "../src/execution/index.js";
import { createManualScheduler, STREAM_AT, STREAM_SID, tokenFrame } from "./streaming-fakes.js";

const SID = STREAM_SID;

/** A live, non-terminal authoritative view for `SID`; unknown ids resolve to `undefined`. */
function liveViewStore(): {
  view: (id: SessionId) => SessionView | undefined;
  apply: (id: SessionId, event: EvEvent) => SessionView;
} {
  let view: SessionView = initialSessionView(SID);
  return {
    view: (id) => (id === SID ? view : undefined),
    apply: (id, event) => {
      if (id === SID) view = reduceEv(view, event);
      return view;
    },
  };
}

test("FIX-3 an empty lazily-created run is EVICTED when the subscriber leaves before any frame", () => {
  const store = liveViewStore();
  const hub = createSessionStreamHub({ apply: store.apply, view: store.view, scheduler: createManualScheduler() });
  assert.equal(hub.hasRun(SID), false, "no run before anyone subscribes");

  const sub = hub.subscribe(SID, () => undefined);
  assert.ok(sub, "a live non-terminal session lazily attaches a run for the subscriber");
  assert.equal(hub.hasRun(SID), true, "the run exists while subscribed");

  sub.close();
  assert.equal(hub.hasRun(SID), false, "closing the only listener BEFORE any frame evicts the empty run (no leak)");
});

test("FIX-3 a run that ingested a frame is NOT evicted when one listener leaves", () => {
  const store = liveViewStore();
  const hub = createSessionStreamHub({ apply: store.apply, view: store.view, scheduler: createManualScheduler() });
  const ctrl = hub.open(SID); // the pump claims the run
  const received: EvEvent[] = [];
  const sub = hub.subscribe(SID, (e) => received.push(e));
  assert.ok(sub);

  ctrl.ingest(tokenFrame("hello")); // real folded activity
  ctrl.flush(); // flush coalesced tokens to the listener
  assert.ok(received.some((e) => e.kind === "token"), "the ingested token reached the subscriber");

  sub.close();
  assert.equal(hub.hasRun(SID), true, "a run with ingested frames survives one listener leaving (never evicted)");
});

test("FIX-3 a pump-claimed run (opened, no frame yet) is NOT evicted; open() reuses the SAME run", () => {
  const store = liveViewStore();
  const hub = createSessionStreamHub({ apply: store.apply, view: store.view, scheduler: createManualScheduler() });
  const ctrl = hub.open(SID); // claimed by the pump; no frame yet
  const received: EvEvent[] = [];

  const sub = hub.subscribe(SID, (e) => received.push(e));
  assert.ok(sub);
  sub.close(); // subscriber leaves before any frame — but the pump owns this run
  assert.equal(hub.hasRun(SID), true, "the pump owns teardown of an opened run; the hub must not evict it");

  // No double-open regression: the SAME run is reused, so a later frame the pump ingests still
  // reaches a fresh subscriber (not a split-brain second run that would miss/duplicate a terminal).
  const sub2 = hub.subscribe(SID, (e) => received.push(e));
  assert.ok(sub2);
  ctrl.ingest(tokenFrame("world"));
  ctrl.flush();
  assert.ok(
    received.some((e) => e.kind === "token" && e.delta === "world"),
    "the re-subscriber sees the pump's frame on the SAME run (ensureRun reuses)",
  );
  sub2.close();
});

test("FIX-3 an unknown or already-terminal session never gets a lazily-created run", () => {
  const store = liveViewStore();
  const hub = createSessionStreamHub({ apply: store.apply, view: store.view, scheduler: createManualScheduler() });

  assert.equal(hub.subscribe("other", () => undefined), undefined, "unknown session → no subscription, no run");
  assert.equal(hub.hasRun("other"), false, "no run fabricated for an unknown session");

  // Drive SID to a REAL terminal, then a subscribe must refuse — the eviction path never fabricates.
  store.apply(SID, { sessionId: SID, seq: 1, at: STREAM_AT, kind: "terminal", state: "completed" });
  assert.equal(hub.subscribe(SID, () => undefined), undefined, "a terminal session → no lazily-created run");
  assert.equal(hub.hasRun(SID), false, "no run fabricated for a finished session");
});
