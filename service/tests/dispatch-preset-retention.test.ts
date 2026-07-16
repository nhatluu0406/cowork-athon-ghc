/**
 * D1 fix, follow-up finding 1 (independent security review, Task 6.3) — end-to-end repro: a
 * branch is aborted (loop `maxDurationMs` guardrail, or a paired-phone
 * `POST /v1/dispatch/runs/{id}/cancel`) while its child session is still alive. Proves the
 * preset binding SURVIVES the runner returning, so a tool-permission event that arrives from the
 * still-alive child AFTER the runner has already settled is still auto-denied at the boundary —
 * never surfaced as an ordinary Allow/Deny ask a human (or a paired phone) could approve.
 *
 * Wires the REAL `ToolPermissionProxy` + REAL `BranchPermissionBindings` + REAL
 * `createLiveBranchRunner` together (only the child-facing seams — createSession/sendPrompt/
 * terminal/cancelSession — are faked; no child, no network, no LLM).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceGuard, grantWorkspace } from "../src/workspace/index.js";
import { createBranchPermissionBindings, createInMemoryAuditSink, createPermissionGate } from "../src/permission/index.js";
import { ToolPermissionProxy } from "../src/files/index.js";
import { createLiveBranchRunner } from "../src/dispatchers/live-branch-runner.js";
import type { BranchPlan } from "../src/dispatchers/fanout.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

const PLAN: BranchPlan = {
  branchId: "b1",
  agentId: "reviewer",
  agentName: "Reviewer",
  systemPrompt: "review only",
  prompt: "review the change",
  preset: { bash: "deny" },
};

function makeStack(cancelSession: () => Promise<void>) {
  const bindings = createBranchPermissionBindings();
  const reply = recordingReplyPort();
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply,
    audit: createInMemoryAuditSink(),
    session: recordingDenialSink(),
    scheduler: time.scheduler,
    timeoutMs: 30_000,
    now: time.now,
  });
  // "bash" is a command_exec tool — never touches the workspace guard, so a real grant is enough.
  const guard = createWorkspaceGuard(grantWorkspace({ rootPath: process.cwd() }));
  const proxy = new ToolPermissionProxy({
    guard,
    gate,
    reply,
    now: () => "2026-07-16T00:00:00.000Z",
    branchPreset: (sessionId) => bindings.presetFor(sessionId),
  });
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "branch-sess-1" }),
    sendPrompt: async () => undefined,
    terminal: () => null, // never reaches a terminal on its own — only abort ends the wait
    cancelSession,
    bindPreset: (sessionId, preset) => bindings.bind(sessionId, preset),
    releasePreset: (sessionId) => bindings.release(sessionId),
    pollIntervalMs: 5,
  });
  return { proxy, gate, runner };
}

test("repro: a tool-permission event arriving AFTER an aborted branch's runner returns is still denied_by_preset", async () => {
  const { proxy, gate, runner } = makeStack(async () => undefined);
  const controller = new AbortController();

  const pending = runner(PLAN, controller.signal);
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.equal(result.status, "errored");

  // The child is still "alive" and raises a permission event for the SAME session AFTER the
  // runner has already settled.
  const outcome = await proxy.handle({
    requestId: "req-after",
    sessionId: "branch-sess-1",
    tool: "bash",
  });

  assert.equal(outcome.outcome, "denied_by_preset", "the binding must still be enforced post-abort");
  assert.equal(gate.pending().length, 0, "the late event must never surface as a pending Allow/Deny ask");
});

test("repro: the same guarantee holds when cancelSession REJECTS (not just when it succeeds)", async () => {
  const { proxy, gate, runner } = makeStack(async () => {
    throw new Error("child endpoint unreachable");
  });
  const controller = new AbortController();

  const pending = runner(PLAN, controller.signal);
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.equal(result.status, "errored");

  const outcome = await proxy.handle({
    requestId: "req-after-2",
    sessionId: "branch-sess-1",
    tool: "bash",
  });

  assert.equal(outcome.outcome, "denied_by_preset");
  assert.equal(gate.pending().length, 0);
});
