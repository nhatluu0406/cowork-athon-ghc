/**
 * CGHC-013 — status truthfulness test (S6).
 *
 * Proves session status is DERIVED from real reduced EV state (never fabricated) and that
 * `runtime_down` surfaces when the supervision seam reports the child is dead. Terminal
 * runs keep their honest historical status even if the runtime later exits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import { createSessionService } from "../src/session/index.js";
import { fakeStore, aliveHealth, recordingCanceller, toggleHealth, FIXED_NOW } from "./session-fakes.js";

const AT = FIXED_NOW();

function ev(sessionId: string, seq: number, extra: Omit<EvEvent, "sessionId" | "seq" | "at">): EvEvent {
  return { sessionId, seq, at: AT, ...extra } as EvEvent;
}

test("status walks idle -> running -> completed strictly from reduced events (S6)", async () => {
  const service = createSessionService({
    store: fakeStore(),
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "Walk" });

  assert.equal(service.status(meta.id), "idle");
  service.apply(meta.id, ev(meta.id, 1, { kind: "step", stepId: "s1", label: "Start", status: "running" }));
  assert.equal(service.status(meta.id), "running");
  // No terminal yet — the service must NOT fabricate `completed`.
  assert.notEqual(service.status(meta.id), "completed");
  service.apply(meta.id, ev(meta.id, 2, { kind: "terminal", state: "completed" }));
  assert.equal(service.status(meta.id), "completed");
});

test("an errored terminal yields status errored, not completed (S6)", async () => {
  const service = createSessionService({
    store: fakeStore(),
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "Err" });
  service.apply(meta.id, ev(meta.id, 1, { kind: "error", message: "boom", recovery: { kind: "retry", label: "Retry" } }));
  // An EV6 error alone does not end the run — status stays running until a real terminal.
  assert.equal(service.status(meta.id), "running");
  service.apply(meta.id, ev(meta.id, 2, { kind: "terminal", state: "errored" }));
  assert.equal(service.status(meta.id), "errored");
});

test("runtime_down surfaces for a non-terminal session when the child is dead (S6)", async () => {
  const { health, setAlive } = toggleHealth(true);
  const service = createSessionService({
    store: fakeStore(),
    health,
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "Down" });
  service.apply(meta.id, ev(meta.id, 1, { kind: "step", stepId: "s1", label: "Go", status: "running" }));
  assert.equal(service.status(meta.id), "running");

  setAlive(false);
  assert.equal(service.status(meta.id), "runtime_down", "dead child overrides a live status");
});

test("a terminal run keeps its honest status even after the runtime exits (S6)", async () => {
  const { health, setAlive } = toggleHealth(true);
  const service = createSessionService({
    store: fakeStore(),
    health,
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "Done" });
  service.apply(meta.id, ev(meta.id, 1, { kind: "terminal", state: "completed" }));

  setAlive(false);
  assert.equal(service.status(meta.id), "completed", "a finished run stays completed");
});

test("list() reflects runtime_down honestly when the child is dead (S6)", async () => {
  const { health, setAlive } = toggleHealth(true);
  const service = createSessionService({
    store: fakeStore(),
    health,
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  await service.create({ workspaceId: "ws-1", title: "L" });
  setAlive(false);
  const list = await service.list();
  assert.equal(list[0]?.status, "runtime_down");
});
