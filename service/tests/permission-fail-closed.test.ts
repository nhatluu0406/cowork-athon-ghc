/**
 * CGHC-016 — fail-closed on timeout (P6).
 *
 * A request that is never answered must AUTO-DENY when the timeout elapses: it blocks the
 * action, forwards an explicit deny reply (runtime not stranded), drives the session
 * terminal, and audits a `fail_closed_timeout` deny. Time is virtual (injectable clock +
 * scheduler) — no real wall-clock sleep.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryAuditSink,
  createPermissionGate,
  createPermissionRequest,
} from "../src/permission/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

const TIMEOUT_MS = 30_000;

test("P6: no decision within the timeout auto-denies, blocks the action, and replies deny", async () => {
  const reply = recordingReplyPort();
  const denial = recordingDenialSink();
  const audit = createInMemoryAuditSink();
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply,
    audit,
    session: denial,
    scheduler: time.scheduler,
    timeoutMs: TIMEOUT_MS,
    now: time.now,
  });

  gate.submit(
    createPermissionRequest({
      requestId: "t1",
      sessionId: "sess-1",
      action: { kind: "command_exec", description: "rm -rf" },
      requestedAt: time.now(),
    }),
  );

  // Just before the deadline: still pending, action still blocked, no reply yet.
  time.advance(TIMEOUT_MS - 1);
  assert.equal(gate.isAllowed("t1"), false);
  assert.equal(reply.replies.length, 0, "no premature reply");
  let ran = false;
  assert.equal(gate.proceed("t1", () => (ran = true)).performed, false);
  assert.equal(ran, false);

  // Cross the deadline: fail-closed fires.
  time.advance(1);
  assert.equal(gate.isAllowed("t1"), false, "auto-denied, never allowed");
  assert.deepEqual(reply.replies, [{ requestId: "t1", decision: "deny" }], "explicit deny reply, runtime not stranded");
  assert.deepEqual(denial.denied, ["sess-1"], "session driven terminal on fail-closed");
  assert.equal(gate.proceed("t1", () => (ran = true)).performed, false, "action still blocked");
  assert.equal(ran, false);
  assert.equal(audit.events()[0]?.reason, "fail_closed_timeout");
  assert.equal(audit.events()[0]?.decision, "deny");
});

test("a decision BEFORE the timeout disarms the fail-closed timer (no double reply)", async () => {
  const reply = recordingReplyPort();
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply,
    audit: createInMemoryAuditSink(),
    session: recordingDenialSink(),
    scheduler: time.scheduler,
    timeoutMs: TIMEOUT_MS,
    now: time.now,
  });
  gate.submit(
    createPermissionRequest({
      requestId: "t2",
      sessionId: "sess-1",
      action: { kind: "file_edit", targetPath: "/ws/a.ts", description: "edit" },
      requestedAt: time.now(),
    }),
  );

  await gate.resolve({ requestId: "t2", decision: "allow", scope: "once" });
  assert.equal(gate.isAllowed("t2"), true);

  // Advancing past the deadline must NOT fire a second (deny) reply — the timer was cancelled.
  time.advance(TIMEOUT_MS * 2);
  assert.deepEqual(reply.replies, [{ requestId: "t2", decision: "allow", scope: "once" }]);
  assert.equal(gate.isAllowed("t2"), true, "still allowed; fail-closed did not override the allow");
});

test("fail-closed stays denied even if the runtime reply transport fails (never re-opens)", async () => {
  const denial = recordingDenialSink();
  const audit = createInMemoryAuditSink();
  const time = createFakeTime();
  const errors: string[] = [];
  const gate = createPermissionGate({
    reply: { async reply() { throw new Error("transport down"); } },
    audit,
    session: denial,
    scheduler: time.scheduler,
    timeoutMs: TIMEOUT_MS,
    now: time.now,
    onReplyError: (_error, requestId) => errors.push(requestId),
  });
  gate.submit(
    createPermissionRequest({
      requestId: "t3",
      sessionId: "sess-1",
      action: { kind: "file_delete", targetPath: "/ws/a.ts", description: "rm" },
      requestedAt: time.now(),
    }),
  );

  time.advance(TIMEOUT_MS);
  // The state is denied regardless of the transport failure (fail-closed).
  assert.equal(gate.isAllowed("t3"), false);
  assert.equal(audit.events()[0]?.reason, "fail_closed_timeout");
  assert.deepEqual(denial.denied, ["sess-1"]);
  // Let the rejected reply promise settle so its routed error is observed (not swallowed).
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(errors, ["t3"], "the transport error was routed, not swallowed");
});
