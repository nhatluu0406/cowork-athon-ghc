/**
 * D1 fix, incl. follow-up finding 1 — the live branch runner binds a branch's
 * `AgentDefinition.permissionPreset` to its child session id BEFORE sending the prompt.
 *
 * Release is DELIBERATELY ASYMMETRIC with bind: a released binding is fail-OPEN (the next
 * tool-permission event for that session id becomes an ordinary Allow/Deny ask), while a binding
 * that outlives its branch is, at worst, an inert leak (OpenCode always hands a new branch a new
 * session id). So the binding is released ONLY when the runner has genuine confirmation — a real
 * terminal observed via ORDINARY polling, never having asked the child to stop. It is
 * deliberately RETAINED (never released) on abort/cancel (even when `cancelSession` succeeds —
 * success proves nothing about whether the real child actually stopped), on a `sendPrompt`
 * failure, and when the session "disappears" mid-poll. Fake seams only — no child, no network,
 * no LLM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionPreset } from "@cowork-ghc/contracts";
import { createLiveBranchRunner } from "../src/dispatchers/live-branch-runner.js";
import type { BranchPlan } from "../src/dispatchers/fanout.js";

function plan(preset: PermissionPreset): BranchPlan {
  return { branchId: "b1", agentId: "reviewer", agentName: "Reviewer", systemPrompt: "review", prompt: "check it", preset };
}

test("bindPreset is called with the branch's preset BEFORE sendPrompt, keyed on the created session id", async () => {
  const calls: string[] = [];
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s1" }),
    sendPrompt: async () => {
      calls.push("sendPrompt");
    },
    terminal: () => ({ state: "completed" }),
    cancelSession: async () => undefined,
    bindPreset: (sessionId, preset) => {
      assert.equal(sessionId, "s1");
      assert.deepEqual(preset, { edit: "deny" });
      calls.push("bindPreset");
    },
    releasePreset: () => calls.push("releasePreset"),
    pollIntervalMs: 1,
  });

  const result = await runner(plan({ edit: "deny" }), new AbortController().signal);
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["bindPreset", "sendPrompt", "releasePreset"], "bind before prompt, release after a REAL terminal");
});

test("releasePreset runs on a non-completed terminal reached via ORDINARY polling (never aborted)", async () => {
  const released: string[] = [];
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s2" }),
    sendPrompt: async () => undefined,
    terminal: () => ({ state: "errored" }),
    cancelSession: async () => undefined,
    bindPreset: () => undefined,
    releasePreset: (sessionId) => released.push(sessionId),
    pollIntervalMs: 1,
  });

  const result = await runner(plan({}), new AbortController().signal);
  assert.equal(result.status, "errored");
  assert.deepEqual(released, ["s2"], "a REAL terminal from ordinary polling is genuine confirmation — safe to release");
});

test("D1 finding 1: releasePreset is NOT called on abort/cancel — the binding is RETAINED", async () => {
  const released: string[] = [];
  const controller = new AbortController();
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s3" }),
    sendPrompt: async () => undefined,
    terminal: () => null, // never reaches a real terminal on its own
    cancelSession: async () => undefined, // cancel "succeeds" — still not proof the child stopped
    bindPreset: () => undefined,
    releasePreset: (sessionId) => released.push(sessionId),
    pollIntervalMs: 5,
  });
  const pending = runner(plan({}), controller.signal);
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.equal(result.status, "errored");
  assert.deepEqual(released, [], "a successful cancelSession is NOT proof the real child stopped — never release here");
});

test("D1 finding 1: releasePreset is NOT called on abort/cancel even when cancelSession REJECTS", async () => {
  const released: string[] = [];
  const controller = new AbortController();
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s3b" }),
    sendPrompt: async () => undefined,
    terminal: () => null,
    cancelSession: async () => {
      throw new Error("child endpoint unreachable");
    },
    bindPreset: () => undefined,
    releasePreset: (sessionId) => released.push(sessionId),
    pollIntervalMs: 5,
  });
  const pending = runner(plan({}), controller.signal);
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.equal(result.status, "errored");
  assert.deepEqual(released, [], "a FAILED cancelSession must not be silently treated as 'child is gone'");
});

test("D1 finding 1: releasePreset is NOT called when sendPrompt throws (delivery is ambiguous)", async () => {
  const calls: string[] = [];
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s4" }),
    sendPrompt: async () => {
      throw new Error("dispatch failed");
    },
    terminal: () => null,
    cancelSession: async () => undefined,
    bindPreset: () => calls.push("bindPreset"),
    releasePreset: () => calls.push("releasePreset"),
  });

  const result = await runner(plan({}), new AbortController().signal);
  assert.equal(result.status, "errored");
  assert.deepEqual(calls, ["bindPreset"], "the binding is retained — a send failure does not prove no turn ever started");
});

test("D1 finding 1: releasePreset is NOT called when the session disappears mid-poll", async () => {
  const calls: string[] = [];
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s6" }),
    sendPrompt: async () => undefined,
    terminal: () => undefined, // "session unknown" — not confirmed dead
    cancelSession: async () => undefined,
    bindPreset: () => calls.push("bindPreset"),
    releasePreset: () => calls.push("releasePreset"),
    pollIntervalMs: 1,
  });

  const result = await runner(plan({}), new AbortController().signal);
  assert.equal(result.status, "errored");
  assert.deepEqual(calls, ["bindPreset"]);
});

test("a session-create failure never calls bindPreset or releasePreset (no session to bind)", async () => {
  const calls: string[] = [];
  const runner = createLiveBranchRunner({
    createSession: async () => {
      throw new Error("no runtime");
    },
    sendPrompt: async () => undefined,
    terminal: () => null,
    cancelSession: async () => undefined,
    bindPreset: () => calls.push("bindPreset"),
    releasePreset: () => calls.push("releasePreset"),
  });

  const result = await runner(plan({}), new AbortController().signal);
  assert.equal(result.status, "errored");
  assert.deepEqual(calls, []);
});

test("honest failure: if binding the preset itself fails, the branch errors and NEVER sends the prompt", async () => {
  const calls: string[] = [];
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s5" }),
    sendPrompt: async () => {
      calls.push("sendPrompt");
    },
    terminal: () => ({ state: "completed" }),
    cancelSession: async () => undefined,
    bindPreset: () => {
      throw new Error("binding registry unavailable");
    },
    releasePreset: () => calls.push("releasePreset"),
  });

  const result = await runner(plan({ edit: "deny" }), new AbortController().signal);
  assert.equal(result.status, "errored");
  assert.deepEqual(calls, [], "no prompt was ever sent with an unenforced preset, and nothing to release");
});
