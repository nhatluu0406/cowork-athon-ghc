/**
 * CGHC-016 — Deny blocks the action AND drives the session to a terminal state (P3, no strand).
 *
 * Uses a REAL CGHC-013 session service as the denial target, so the assertion is end-to-end:
 * after a Deny, (1) the runtime gets an explicit deny reply (not stranded), (2) the mutation
 * never runs, and (3) the session reaches the honest terminal `denied` status (not left
 * hanging). "First terminal wins" means a Deny after a completed run cannot rewrite history.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionRequest } from "@cowork-ghc/contracts";
import { createSessionService } from "../src/session/index.js";
import {
  createInMemoryAuditSink,
  createPermissionGate,
  createPermissionRequest,
  createSessionDenialSink,
  type SessionDenialTarget,
} from "../src/permission/index.js";
import { createFakeTime, failingReplyPort, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";
import { fakeStore, aliveHealth, recordingCanceller, FIXED_NOW } from "./session-fakes.js";

function realSessionTarget(service: ReturnType<typeof createSessionService>): SessionDenialTarget {
  return {
    has: (id) => service.view(id) !== undefined,
    view: (id) => service.view(id),
    apply: (id, event) => service.apply(id, event),
  };
}

test("Deny leaves the action un-performed AND drives the real session to terminal `denied` (P3)", async () => {
  const service = createSessionService({
    store: fakeStore(),
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "Deny" });

  // A run is under way (the boundary is about to mutate a file, pending approval).
  service.apply(meta.id, {
    sessionId: meta.id,
    seq: 1,
    at: FIXED_NOW(),
    kind: "tool_call",
    callId: "c1",
    toolName: "delete",
    status: "running",
  });
  assert.equal(service.status(meta.id), "running");

  const reply = recordingReplyPort();
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply,
    audit: createInMemoryAuditSink(),
    session: createSessionDenialSink(realSessionTarget(service)),
    scheduler: time.scheduler,
    timeoutMs: 30_000,
    now: time.now,
  });

  const req: PermissionRequest = createPermissionRequest({
    requestId: "p1",
    sessionId: meta.id,
    action: { kind: "file_delete", targetPath: "/ws/victim.ts", description: "delete victim.ts" },
    requestedAt: FIXED_NOW(),
  });
  gate.submit(req);

  // The mutation site guards on `proceed` — before any decision it must NOT run.
  let mutated = false;
  const beforeDecision = gate.proceed("p1", () => (mutated = true));
  assert.equal(beforeDecision.performed, false);
  assert.equal(mutated, false, "no mutation before a decision");

  // User denies.
  const outcome = await gate.resolve({ requestId: "p1", decision: "deny" });
  assert.equal(outcome.status, "resolved");

  // (1) The runtime got an explicit deny reply — not stranded.
  assert.deepEqual(reply.replies, [{ requestId: "p1", decision: "deny" }]);
  // (2) The mutation still cannot run after a deny.
  const afterDeny = gate.proceed("p1", () => (mutated = true));
  assert.equal(afterDeny.performed, false);
  assert.equal(mutated, false, "deny actually blocks the mutation");
  // (3) The session reached the honest terminal `denied` status (no strand, actionable).
  assert.equal(service.status(meta.id), "denied");
  assert.equal(service.view(meta.id)?.terminal, "denied");
});

test("an explicit Deny with a throwing reply transport still resolves + stays enforced (FIX-3)", async () => {
  // FIX-3 (security LOW): the deny is recorded, audited, and drives the session terminal BEFORE
  // the reply is forwarded, so the server-side Deny is COMPLETE regardless of the outbound reply.
  // A throwing transport must therefore NOT surface as a rejected resolve()/500 to the UI — it is
  // reported (non-secret) and swallowed, exactly like the fail-closed-timeout path. The action
  // stays blocked and the runtime is denied on-record even though the outbound reply failed.
  const denial = recordingDenialSink();
  const audit = createInMemoryAuditSink();
  const time = createFakeTime();
  const replyErrors: string[] = [];
  const gate = createPermissionGate({
    reply: failingReplyPort(),
    audit,
    session: denial,
    scheduler: time.scheduler,
    timeoutMs: 30_000,
    now: time.now,
    onReplyError: (_error, requestId) => replyErrors.push(requestId),
  });
  gate.submit(
    createPermissionRequest({
      requestId: "d1",
      sessionId: "sess-1",
      action: { kind: "file_delete", targetPath: "/ws/a.ts", description: "rm" },
      requestedAt: time.now(),
    }),
  );

  // A successful Deny resolves cleanly — a failed reply transport is NOT surfaced to the caller.
  const outcome = await gate.resolve({ requestId: "d1", decision: "deny" });
  assert.equal(outcome.status, "resolved", "a good server-side Deny never rejects on a reply failure");
  // The transport failure is reported (non-secret), not swallowed silently.
  assert.deepEqual(replyErrors, ["d1"], "the reply transport error was routed to onReplyError");

  // Despite the failed reply: action blocked, session driven terminal, deny audited.
  assert.equal(gate.isAllowed("d1"), false);
  let ran = false;
  assert.equal(gate.proceed("d1", () => (ran = true)).performed, false, "deny still blocks");
  assert.equal(ran, false);
  assert.deepEqual(denial.denied, ["sess-1"], "session denied on-record even though reply failed");
  assert.equal(audit.events()[0]?.decision, "deny");
});

test("a Deny for an already-terminal session is a safe no-op (first terminal wins)", async () => {
  const service = createSessionService({
    store: fakeStore(),
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "Done" });
  // The run already completed.
  service.apply(meta.id, { sessionId: meta.id, seq: 1, at: FIXED_NOW(), kind: "terminal", state: "completed" });
  assert.equal(service.status(meta.id), "completed");

  const sink = createSessionDenialSink(realSessionTarget(service));
  sink.denySession(meta.id, "late", FIXED_NOW());
  assert.equal(service.status(meta.id), "completed", "a late deny cannot rewrite a completed terminal");
});
