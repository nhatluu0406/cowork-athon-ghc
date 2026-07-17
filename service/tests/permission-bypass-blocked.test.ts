/**
 * CGHC-016 — bypass is blocked at the execution boundary (P3).
 *
 * The load-bearing invariant: an action cannot proceed WITHOUT a recorded Allow. Proves that
 * `proceed` refuses to run the mutation for an unknown request, a still-pending request, an
 * expired (fail-closed) request, and a denied request — and that an `once` Allow is consumed
 * so it cannot be replayed. A decision object is never itself authorization.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryAuditSink,
  createPermissionGate,
  createPermissionRequest,
  type PermissionGate,
} from "../src/permission/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

const TIMEOUT_MS = 10_000;

function gateWith(time = createFakeTime()): { gate: PermissionGate; time: ReturnType<typeof createFakeTime> } {
  const gate = createPermissionGate({
    reply: recordingReplyPort(),
    audit: createInMemoryAuditSink(),
    session: recordingDenialSink(),
    scheduler: time.scheduler,
    timeoutMs: TIMEOUT_MS,
    now: time.now,
  });
  return { gate, time };
}

function submit(gate: PermissionGate, requestId: string, now: () => string): void {
  gate.submit(
    createPermissionRequest({
      requestId,
      sessionId: "sess-1",
      action: { kind: "file_create", targetPath: "/ws/a.ts", description: "create" },
      requestedAt: now(),
    }),
  );
}

test("bypass blocked: proceed refuses an UNKNOWN request", () => {
  const { gate } = gateWith();
  let ran = false;
  const result = gate.proceed("never-submitted", () => (ran = true));
  assert.deepEqual(result, { performed: false, reason: "not_allowed" });
  assert.equal(ran, false);
});

test("bypass blocked: proceed refuses a still-PENDING request (no decision yet)", () => {
  const { gate, time } = gateWith();
  submit(gate, "b1", time.now);
  let ran = false;
  assert.equal(gate.proceed("b1", () => (ran = true)).performed, false);
  assert.equal(ran, false, "cannot proceed on a pending request");
});

test("bypass blocked: proceed refuses an EXPIRED (fail-closed) request", () => {
  const { gate, time } = gateWith();
  submit(gate, "b2", time.now);
  time.advance(TIMEOUT_MS); // fail-closed fires -> denied
  let ran = false;
  assert.equal(gate.proceed("b2", () => (ran = true)).performed, false);
  assert.equal(ran, false, "an expired request is denied and blocked");
});

test("bypass blocked: proceed refuses a DENIED request", async () => {
  const { gate, time } = gateWith();
  submit(gate, "b3", time.now);
  await gate.resolve({ requestId: "b3", decision: "deny" });
  let ran = false;
  assert.equal(gate.proceed("b3", () => (ran = true)).performed, false);
  assert.equal(ran, false);
});

test("with a recorded Allow, proceed runs the mutation exactly once (once-scope is consumed)", async () => {
  const { gate, time } = gateWith();
  submit(gate, "b4", time.now);
  await gate.resolve({ requestId: "b4", decision: "allow", scope: "once" });

  let runs = 0;
  const first = gate.proceed("b4", () => ++runs);
  assert.deepEqual(first, { performed: true, result: 1 });
  // A second attempt on the same once-scoped allow must be refused (allowance consumed).
  const second = gate.proceed("b4", () => ++runs);
  assert.equal(second.performed, false, "once-scope allow cannot be replayed");
  assert.equal(runs, 1, "the mutation ran exactly once");
  assert.equal(gate.isAllowed("b4"), false, "consumed allow is no longer allowed");
});

test("an `always`-scope Allow lets proceed run more than once", async () => {
  const { gate, time } = gateWith();
  submit(gate, "b5", time.now);
  await gate.resolve({ requestId: "b5", decision: "allow", scope: "always" });

  let runs = 0;
  assert.equal(gate.proceed("b5", () => ++runs).performed, true);
  assert.equal(gate.proceed("b5", () => ++runs).performed, true);
  assert.equal(runs, 2, "an always allow is not consumed");
  assert.equal(gate.isAllowed("b5"), true);
});
