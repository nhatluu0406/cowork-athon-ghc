/**
 * CGHC-016 — permission round-trip + audit + approval-level enforcement (P4/P5).
 *
 * Proves the happy paths: a request resolved Allow forwards an allow reply (with scope) and
 * audits an allow; a request resolved Deny forwards an explicit deny reply and audits a deny.
 * Also proves the boundary — not the UI — decides the approval level (P4), and that the audit
 * record carries NO secret-shaped value (P5).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionAction, PermissionRequest } from "@cowork-ghc/contracts";
import {
  classifyApprovalLevel,
  createInMemoryAuditSink,
  createPermissionGate,
  createPermissionRequest,
  type PermissionGate,
} from "../src/permission/index.js";
import {
  createFakeTime,
  recordingDenialSink,
  recordingReplyPort,
  type RecordingDenialSink,
  type RecordingReplyPort,
} from "./permission-fakes.js";

const TIMEOUT_MS = 30_000;

interface Harness {
  gate: PermissionGate;
  reply: RecordingReplyPort;
  denial: RecordingDenialSink;
  audit: ReturnType<typeof createInMemoryAuditSink>;
  time: ReturnType<typeof createFakeTime>;
}

function harness(): Harness {
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
  return { gate, reply, denial, audit, time };
}

function request(
  requestId: string,
  action: PermissionAction,
  sessionId = "sess-1",
): PermissionRequest {
  return createPermissionRequest({ requestId, sessionId, action, requestedAt: "2026-07-11T00:00:00.000Z" });
}

test("round-trip: request -> allow yields an allow reply carrying scope, and audits an allow", async () => {
  const h = harness();
  h.gate.submit(request("r1", { kind: "file_edit", targetPath: "/ws/a.ts", description: "edit a" }));

  const outcome = await h.gate.resolve({ requestId: "r1", decision: "allow", scope: "always" });

  assert.equal(outcome.status, "resolved");
  assert.deepEqual(h.reply.replies, [{ requestId: "r1", decision: "allow", scope: "always" }]);
  assert.equal(h.gate.isAllowed("r1"), true);
  assert.equal(h.audit.size(), 1);
  assert.equal(h.audit.events()[0]?.decision, "allow");
  assert.equal(h.audit.events()[0]?.approvalLevel, "standard");
});

test("round-trip: request -> deny yields an explicit deny reply (no scope), and audits a deny", async () => {
  const h = harness();
  h.gate.submit(request("r2", { kind: "file_delete", targetPath: "/ws/a.ts", description: "delete a" }));

  const outcome = await h.gate.resolve({ requestId: "r2", decision: "deny" });

  assert.equal(outcome.status, "resolved");
  assert.deepEqual(h.reply.replies, [{ requestId: "r2", decision: "deny" }]);
  assert.equal(h.reply.replies[0]?.scope, undefined, "a deny reply carries no scope");
  assert.equal(h.gate.isAllowed("r2"), false);
  assert.deepEqual(h.denial.denied, ["sess-1"], "deny drove the session terminal (no strand)");
  assert.equal(h.audit.events()[0]?.decision, "deny");
});

test("P4: the BOUNDARY assigns the approval level; a client cannot downgrade it", async () => {
  // file_delete is elevated by classification.
  assert.equal(classifyApprovalLevel("file_delete"), "elevated");
  assert.equal(classifyApprovalLevel("command_exec"), "elevated");
  assert.equal(classifyApprovalLevel("file_move"), "elevated");
  assert.equal(classifyApprovalLevel("file_create"), "standard");
  assert.equal(classifyApprovalLevel("file_edit"), "standard");

  const h = harness();
  // A spoofed request claiming `standard` for a delete — the gate must recompute `elevated`.
  const spoofed: PermissionRequest = {
    requestId: "r3",
    sessionId: "sess-1",
    action: { kind: "file_delete", targetPath: "/ws/a.ts", description: "rm a" },
    approvalLevel: "standard",
    requestedAt: "2026-07-11T00:00:00.000Z",
  };
  h.gate.submit(spoofed);
  await h.gate.resolve({ requestId: "r3", decision: "allow" });
  assert.equal(h.audit.events()[0]?.approvalLevel, "elevated", "boundary re-derived elevated, ignoring the client");
});

test("P5: the audit record never contains a secret-shaped value from the description", async () => {
  const SECRET = "sk-live-DEADBEEF0123456789supersecretkey";
  const h = harness();
  // The free-form description carries a secret-shaped string; it must NOT reach the audit log.
  h.gate.submit(request("r4", { kind: "file_create", targetPath: "/ws/new.ts", description: `token ${SECRET}` }));
  await h.gate.resolve({ requestId: "r4", decision: "allow" });
  h.gate.submit(request("r5", { kind: "command_exec", description: `run with ${SECRET}` }, "sess-2"));
  await h.gate.resolve({ requestId: "r5", decision: "deny" });

  assert.equal(h.audit.size(), 2, "one audit record per Allow AND per Deny");
  const serialized = JSON.stringify(h.audit.events());
  assert.equal(serialized.includes(SECRET), false, "no secret-shaped value in the audit record");
});

test("a late decision cannot flip an already-resolved request", async () => {
  const h = harness();
  h.gate.submit(request("r6", { kind: "file_edit", targetPath: "/ws/a.ts", description: "edit" }));
  await h.gate.resolve({ requestId: "r6", decision: "deny" });

  const second = await h.gate.resolve({ requestId: "r6", decision: "allow" });
  assert.deepEqual(second, { status: "already_resolved", decision: "deny" });
  assert.equal(h.gate.isAllowed("r6"), false, "still denied — a late allow cannot override");
});

test("resolving an unknown request never allows it", async () => {
  const h = harness();
  const outcome = await h.gate.resolve({ requestId: "ghost", decision: "allow" });
  assert.deepEqual(outcome, { status: "unknown" });
  assert.equal(h.gate.isAllowed("ghost"), false);
  assert.equal(h.reply.replies.length, 0);
});
