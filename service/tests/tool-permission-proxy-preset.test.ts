/**
 * D1 fix — `ToolPermissionProxy` enforces a bound branch `AgentDefinition.permissionPreset` as a
 * NARROWING input to the ONE `PermissionGate`: a tool the preset denies is auto-denied at this
 * execution boundary and NEVER surfaces to the user as an Allow/Deny ask. The preset is looked up
 * via `BranchPermissionBindings`, written by the live branch runner and read here — no second
 * permission authority, no leak to sessions that were never bound.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceGuard, grantWorkspace } from "../src/workspace/index.js";
import {
  createBranchPermissionBindings,
  createInMemoryAuditSink,
  createPermissionGate,
  type BranchPermissionBindings,
  type InMemoryAuditSink,
  type PermissionGate,
} from "../src/permission/index.js";
import { ToolPermissionProxy } from "../src/files/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

const NOW = () => "2026-07-16T00:00:00.000Z";

interface Fixture {
  readonly proxy: ToolPermissionProxy;
  readonly gate: PermissionGate;
  readonly bindings: BranchPermissionBindings;
  readonly reply: ReturnType<typeof recordingReplyPort>;
  readonly permissionAudit: InMemoryAuditSink;
  readonly denied: readonly string[];
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cghc-preset-proxy-"));
  await mkdir(root, { recursive: true });
  const guard = createWorkspaceGuard(grantWorkspace({ rootPath: root }));
  const reply = recordingReplyPort();
  const time = createFakeTime();
  const permissionAudit = createInMemoryAuditSink();
  const denialSink = recordingDenialSink();
  const gate = createPermissionGate({
    reply,
    audit: permissionAudit,
    session: denialSink,
    scheduler: time.scheduler,
    timeoutMs: 30_000,
    now: time.now,
  });
  const bindings = createBranchPermissionBindings();
  const proxy = new ToolPermissionProxy({
    guard,
    gate,
    reply,
    now: NOW,
    branchPreset: (sessionId) => bindings.presetFor(sessionId),
  });
  return { proxy, gate, bindings, reply, permissionAudit, denied: denialSink.denied };
}

test("a branch preset denying edit blocks the write at the boundary — never a user prompt", async () => {
  const fx = await makeFixture();
  fx.bindings.bind("branch-1", { edit: "deny" });

  const outcome = await fx.proxy.handle({
    requestId: "req-1",
    sessionId: "branch-1",
    tool: "write",
    path: "new.ts",
  });

  assert.deepEqual(outcome, { outcome: "denied_by_preset", requestId: "req-1", actionKind: "file_create" });
  // Never appeared as a pending ask — the gate never had a chance to surface it to a UI.
  assert.equal(fx.gate.pending().length, 0);
  assert.equal(fx.gate.isAllowed("req-1"), false);
  // The runtime is not stranded: an explicit deny reply went back through the SAME port.
  assert.deepEqual(fx.reply.replies, [{ requestId: "req-1", decision: "deny" }]);
  // The deny is audited (P5) exactly like any other gate deny.
  const events = fx.permissionAudit.events();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.decision, "deny");
  assert.equal(events[0]?.requestId, "req-1");
  // The audit reason honestly records a POLICY auto-deny — never misattributed to the user.
  assert.equal(events[0]?.reason, "agent_preset");
  assert.notEqual(events[0]?.reason, "user_decision");
  // The session was driven terminal, same guarantee as an explicit user deny (P3).
  assert.deepEqual(fx.denied, ["branch-1"]);
});

test("the same tool on a NON-branch (interactive) session still asks — no preset leak", async () => {
  const fx = await makeFixture();
  fx.bindings.bind("branch-1", { edit: "deny" });

  // "interactive-1" was never bound — an ordinary session is unaffected by another session's preset.
  const outcome = await fx.proxy.handle({
    requestId: "req-2",
    sessionId: "interactive-1",
    tool: "write",
    path: "new.ts",
  });

  assert.deepEqual(outcome, { outcome: "submitted", requestId: "req-2", actionKind: "file_create" });
  assert.equal(fx.gate.pending().length, 1);
});

test("a preset looser than the base policy (allow) never auto-widens at runtime", async () => {
  const fx = await makeFixture();
  // Simulates a preset that slipped past `isNarrowingPreset` validation (defense-in-depth) —
  // the proxy only ever reads a `deny` level; any other value is inert here, so a request still
  // requires the normal gate ask (never auto-allowed).
  fx.bindings.bind("branch-2", { edit: "allow" });

  const outcome = await fx.proxy.handle({
    requestId: "req-3",
    sessionId: "branch-2",
    tool: "write",
    path: "new.ts",
  });

  assert.equal(outcome.outcome, "submitted");
  assert.equal(fx.gate.pending().length, 1, "still requires an ordinary ask, never auto-allowed");
  assert.equal(fx.gate.isAllowed("req-3"), false);
});

test("releasing a binding after a branch terminal frees the session id for later use", async () => {
  const fx = await makeFixture();
  fx.bindings.bind("branch-3", { edit: "deny" });
  fx.bindings.release("branch-3");

  const outcome = await fx.proxy.handle({
    requestId: "req-4",
    sessionId: "branch-3",
    tool: "write",
    path: "new.ts",
  });

  assert.equal(outcome.outcome, "submitted", "an unbound (released) session id behaves like any other session");
  assert.equal(fx.gate.pending().length, 1);
});

test("an empty preset ({}) — e.g. the built-in implementer — is byte-for-byte unchanged", async () => {
  const fx = await makeFixture();
  fx.bindings.bind("branch-4", {});

  const outcome = await fx.proxy.handle({
    requestId: "req-5",
    sessionId: "branch-4",
    tool: "write",
    path: "new.ts",
  });

  assert.deepEqual(outcome, { outcome: "submitted", requestId: "req-5", actionKind: "file_create" });
  assert.equal(fx.gate.pending().length, 1);
});

test("command_exec is governed by the preset's `bash` key", async () => {
  const fx = await makeFixture();
  fx.bindings.bind("branch-5", { bash: "deny" });

  const outcome = await fx.proxy.handle({ requestId: "req-6", sessionId: "branch-5", tool: "bash" });

  assert.deepEqual(outcome, { outcome: "denied_by_preset", requestId: "req-6", actionKind: "command_exec" });
  assert.equal(fx.gate.pending().length, 0);
});

test("delete/move narrow through the same `edit` preset key as create/edit", async () => {
  const fx = await makeFixture();
  fx.bindings.bind("branch-6", { edit: "deny" });

  const del = await fx.proxy.handle({ requestId: "req-7", sessionId: "branch-6", tool: "delete", path: "a.ts" });
  assert.equal(del.outcome, "denied_by_preset");
  assert.equal(fx.gate.pending().length, 0);
});
