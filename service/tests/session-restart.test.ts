/**
 * CGHC-013 — restart / resume test (S4, SHOULD).
 *
 * Proves history is restorable after a restart: a FRESH service instance (empty memory)
 * lists sessions from the store seam and rebuilds each session's authoritative view by
 * REPLAYING the OpenCode store's raw event frames through the CGHC-012 mapper + reducer —
 * not from any in-memory snapshot. Reconstruction is identical to the live path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import { createSessionService } from "../src/session/index.js";
import { fakeStore, aliveHealth, recordingCanceller, FIXED_NOW } from "./session-fakes.js";

/** Build a raw OpenCode `/event` frame attributed to a session (the store's replay shape). */
function frame(type: string, sessionId: string, extra: Record<string, unknown> = {}) {
  return { type, properties: { sessionID: sessionId, ...extra } };
}

test("a fresh service rebuilds session state from the store's replayed frames (S4)", async () => {
  const store = fakeStore();

  // First "process": create + populate the store with a completed run's event frames.
  const first = createSessionService({
    store,
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await first.create({ workspaceId: "ws-1", title: "Resumable" });
  store.seedFrames(meta.id, [
    frame("todo.updated", meta.id, { todos: [{ id: "t1", content: "Read", status: "completed" }] }),
    frame("message.part.delta", meta.id, { delta: "Hello" }),
    frame("session.idle", meta.id), // a real run-finished frame -> terminal completed
  ]);

  // Second "process" after restart: brand-new service, EMPTY memory, same store.
  const restarted = createSessionService({
    store,
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });

  // History is listable from the store, not memory.
  const list = await restarted.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, meta.id);
  // Before reopening, the restarted service has no in-memory view for the session.
  assert.equal(restarted.view(meta.id), undefined, "nothing in memory before reopen");

  // Reopen rebuilds the authoritative view purely from replayed store frames.
  const reopened = await restarted.continueSession(meta.id);
  assert.equal(reopened.view.status, "completed", "terminal reconstructed from session.idle");
  assert.equal(reopened.view.terminal, "completed");
  assert.equal(reopened.view.text, "Hello", "token delta reconstructed");
  assert.equal(reopened.view.todos.length, 1);
  assert.equal(restarted.status(meta.id), "completed");
});

test("reopening a LIVE non-terminal session preserves its in-flight stream handle (MEDIUM-2)", async () => {
  const canceller = recordingCanceller();
  const store = fakeStore();
  const service = createSessionService({ store, health: aliveHealth(), canceller, now: FIXED_NOW });
  const meta = await service.create({ workspaceId: "ws-1", title: "Live" });

  // A run is in flight: bind its stream + apply a live (non-terminal) frame. Nothing is seeded
  // into the store, so a rebuild-on-reopen would WRONGLY reset the view to empty and orphan the
  // handle (a later cancel could no longer abort the real stream).
  service.bindStream(meta.id, { id: "stream-live" });
  service.apply(meta.id, { sessionId: meta.id, seq: 1, at: FIXED_NOW(), kind: "token", delta: "partial" } as EvEvent);

  const reopened = await service.continueSession(meta.id);
  assert.equal(reopened.view.text, "partial", "reopen returns the LIVE in-memory view, not an empty rebuild");
  assert.equal(reopened.view.terminal, null);

  // The in-flight handle must still be bound — cancel aborts the exact live stream, not nothing.
  await service.cancel(meta.id);
  assert.deepEqual(canceller.cancelled, [{ id: "stream-live" }], "live handle preserved across reopen");
  assert.equal(service.status(meta.id), "cancelled");
});

test("reopening a session with no stored events yields an honest idle view (S4)", async () => {
  const store = fakeStore();
  const created = createSessionService({
    store,
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await created.create({ workspaceId: "ws-1", title: "Empty" });

  const restarted = createSessionService({
    store,
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const reopened = await restarted.continueSession(meta.id);
  assert.equal(reopened.view.status, "idle", "no fabricated completion for an empty history");
  assert.equal(reopened.view.terminal, null);
});
