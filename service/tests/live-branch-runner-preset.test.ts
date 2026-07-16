/**
 * D1 fix — the live branch runner binds a branch's `AgentDefinition.permissionPreset` to its
 * child session id BEFORE sending the prompt, and releases the binding on EVERY exit path
 * (completed / errored terminal, abort/cancel, create failure, prompt-dispatch failure, and a
 * bind failure itself) so no session id ever runs unbound-when-it-should-be-bound, or leaks a
 * stale binding into a later/other session. Fake seams only — no child, no network, no LLM.
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
  assert.deepEqual(calls, ["bindPreset", "sendPrompt", "releasePreset"], "bind before prompt, release after terminal");
});

test("releasePreset runs even when the terminal is a non-completed error", async () => {
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
  assert.deepEqual(released, ["s2"]);
});

test("releasePreset runs on abort/cancel mid-wait", async () => {
  const released: string[] = [];
  const controller = new AbortController();
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s3" }),
    sendPrompt: async () => undefined,
    terminal: () => null,
    cancelSession: async () => undefined,
    bindPreset: () => undefined,
    releasePreset: (sessionId) => released.push(sessionId),
    pollIntervalMs: 5,
  });
  const pending = runner(plan({}), controller.signal);
  setTimeout(() => controller.abort(), 10);
  await pending;
  assert.deepEqual(released, ["s3"]);
});

test("releasePreset runs even when sendPrompt throws (bind already happened)", async () => {
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
  assert.deepEqual(calls, ["bindPreset", "releasePreset"]);
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
