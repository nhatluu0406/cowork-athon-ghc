/**
 * `PermissionGate.denyByPolicy` — a SEPARATE, narrow boundary-policy deny path (D1 fix,
 * follow-up). Used ONLY by a boundary component that denies on its own authority (e.g.
 * `ToolPermissionProxy` auto-denying a tool an agent's `permissionPreset` forbids) — never by
 * the user-facing decision route. Unlike `resolve({decision:"deny"})`, this method:
 *  - is NOT reachable from `POST /v1/permission/decision` (that route only ever calls `resolve`,
 *    whose `ResolutionInput` has no `reason` field — the reason can never be caller-supplied);
 *  - records the audit reason as `"agent_preset"`, never `"user_decision"` — the reason a
 *    security reviewer sees must not misattribute a machine policy denial to a human;
 *  - skips the `pending` state and the fail-closed timer entirely (there is no one to wait for
 *    an answer from — the decision is already made);
 *  - keeps the SAME validation guarantees as `submit` (non-empty ids, duplicate-requestId
 *    rejection) and the SAME "never stranded" guarantee (deny reply forwarded, session driven
 *    terminal, audited) as any other gate deny.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionRequest } from "@cowork-ghc/contracts";
import {
  createInMemoryAuditSink,
  createPermissionGate,
  createPermissionRequest,
  type ResolutionInput,
} from "../src/permission/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

function req(requestId: string, sessionId = "sess-1"): PermissionRequest {
  return createPermissionRequest({
    requestId,
    sessionId,
    action: { kind: "file_edit", targetPath: "/ws/a.ts", description: "edit a.ts" },
    requestedAt: "2026-07-16T00:00:00.000Z",
  });
}

function gateWith() {
  const reply = recordingReplyPort();
  const audit = createInMemoryAuditSink();
  const denial = recordingDenialSink();
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply,
    audit,
    session: denial,
    scheduler: time.scheduler,
    timeoutMs: 30_000,
    now: time.now,
  });
  return { gate, reply, audit, denial, time };
}

test("denyByPolicy audits reason 'agent_preset', never 'user_decision'", async () => {
  const { gate, audit } = gateWith();
  await gate.denyByPolicy(req("p1"));

  assert.equal(audit.events().length, 1);
  assert.equal(audit.events()[0]?.decision, "deny");
  assert.equal(audit.events()[0]?.reason, "agent_preset");
  assert.notEqual(audit.events()[0]?.reason, "user_decision");
});

test("denyByPolicy blocks proceed and is never reflected as allowed", async () => {
  const { gate } = gateWith();
  await gate.denyByPolicy(req("p2"));

  assert.equal(gate.isAllowed("p2"), false);
  let ran = false;
  const result = gate.proceed("p2", () => (ran = true));
  assert.equal(result.performed, false);
  assert.equal(ran, false);
});

test("denyByPolicy forwards an explicit deny reply — the runtime is not stranded (P3)", async () => {
  const { gate, reply } = gateWith();
  await gate.denyByPolicy(req("p3"));
  assert.deepEqual(reply.replies, [{ requestId: "p3", decision: "deny" }]);
});

test("denyByPolicy drives the session to terminal denied (P3, no strand)", async () => {
  const { gate, denial } = gateWith();
  await gate.denyByPolicy(req("p4", "sess-branch"));
  assert.deepEqual(denial.denied, ["sess-branch"]);
});

test("denyByPolicy never leaves (or passes through) an observable pending state", async () => {
  const { gate } = gateWith();
  await gate.denyByPolicy(req("p5"));
  assert.equal(gate.pending().length, 0);
});

test("denyByPolicy rejects an empty requestId/sessionId — same guarantee as submit", async () => {
  const { gate } = gateWith();
  await assert.rejects(() => gate.denyByPolicy(req("")), /requestId/);
  await assert.rejects(() => gate.denyByPolicy(req("p6", "")), /sessionId/);
});

test("denyByPolicy rejects a duplicate requestId (already known to the gate)", async () => {
  const { gate } = gateWith();
  await gate.denyByPolicy(req("p7"));
  await assert.rejects(() => gate.denyByPolicy(req("p7")), /duplicate/);
});

test("denyByPolicy rejects a requestId already submitted via the ordinary ask path", async () => {
  const { gate } = gateWith();
  gate.submit(req("p8"));
  await assert.rejects(() => gate.denyByPolicy(req("p8")), /duplicate/);
});

test("the user-facing resolve() path can NEVER produce reason 'agent_preset', even with a smuggled field", async () => {
  const { gate, audit } = gateWith();
  gate.submit(req("p9"));
  // Simulate a malicious/buggy client trying to smuggle a `reason` through the public decision
  // input (which has no such field in its type — this cast proves the runtime ALSO ignores it).
  const forged = { requestId: "p9", decision: "deny", reason: "agent_preset" } as unknown as ResolutionInput;
  await gate.resolve(forged);
  assert.equal(audit.events()[0]?.reason, "user_decision", "resolve() always attributes its own deny to the user");
});
