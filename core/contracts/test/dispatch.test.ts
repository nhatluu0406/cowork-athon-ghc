import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateLoopPolicy,
  validateAgentDefinition,
  validateTaskDefinition,
  isNarrowingPreset,
  effectiveConcurrency,
  FANOUT_HARD_CAP,
  type TaskDefinition,
} from "../src/dispatch.js";

// Mirror of the live session policy (opencode-config.ts) enough for the narrowing check.
const BASE_POLICY: Record<string, string> = {
  read: "allow",
  edit: "ask",
  bash: "deny",
  task: "deny",
};

test("loop policy validates modes, caps, and scheduled interval", () => {
  assert.equal(validateLoopPolicy({ mode: "run_once", maxTurns: 5, maxDurationMs: 60_000 }).ok, true);
  assert.equal(validateLoopPolicy({ mode: "bogus", maxTurns: 5, maxDurationMs: 60_000 }).ok, false);
  assert.equal(validateLoopPolicy({ mode: "run_once", maxTurns: 0, maxDurationMs: 60_000 }).ok, false);
  assert.equal(validateLoopPolicy({ mode: "run_once", maxTurns: 5, maxDurationMs: 100 }).ok, false);
  // scheduled requires intervalMs
  assert.equal(validateLoopPolicy({ mode: "scheduled", maxTurns: 5, maxDurationMs: 60_000 }).ok, false);
  const ok = validateLoopPolicy({ mode: "scheduled", maxTurns: 5, maxDurationMs: 60_000, intervalMs: 30_000 });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.intervalMs, 30_000);
});

test("narrowing preset accepts more-restrictive and rejects looser overrides", () => {
  // edit ask -> deny is narrowing (ok); read allow -> ask is narrowing (ok)
  assert.equal(isNarrowingPreset({ edit: "deny", read: "ask" }, BASE_POLICY), true);
  // bash deny -> allow is LOOSER (reject) — an agent cannot re-enable a denied tool
  assert.equal(isNarrowingPreset({ bash: "allow" }, BASE_POLICY), false);
  // edit ask -> allow is looser (reject)
  assert.equal(isNarrowingPreset({ edit: "allow" }, BASE_POLICY), false);
  // unknown level rejected
  assert.equal(isNarrowingPreset({ edit: "yolo" as never }, BASE_POLICY), false);
});

test("agent definition rejects a preset that loosens the policy", () => {
  const bad = validateAgentDefinition(
    {
      id: "rogue",
      name: "Rogue",
      systemPrompt: "do things",
      skillIds: [],
      permissionPreset: { bash: "allow" },
    },
    BASE_POLICY,
  );
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /narrow/);

  const good = validateAgentDefinition(
    {
      id: "impl",
      name: "Implementer",
      systemPrompt: "write code",
      skillIds: ["a", "b"],
      permissionPreset: { edit: "ask" },
      model: { providerID: "deepseek", modelID: "deepseek-chat" },
    },
    BASE_POLICY,
  );
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.source, "user_local");
    assert.equal(good.value.model?.modelID, "deepseek-chat");
  }
});

test("agent definition rejects an unenforceable preset key even though it 'narrows' (D1 finding 2)", () => {
  // "*" is the most natural way a user would try to say "this agent must not act at all" — it
  // passes isNarrowingPreset (an unknown key defaults its base rank to "ask", so "deny" always
  // narrows) but the boundary never actually looks up "*"; only "edit"/"bash" are enforced.
  const wildcard = validateAgentDefinition(
    { id: "locked", name: "Locked", systemPrompt: "x", skillIds: [], permissionPreset: { "*": "deny" } },
    BASE_POLICY,
  );
  assert.equal(wildcard.ok, false);
  if (!wildcard.ok) {
    assert.match(wildcard.error, /unenforceable/);
    // The error names the keys that ARE actually enforceable, so the fix is discoverable.
    assert.match(wildcard.error, /edit/);
    assert.match(wildcard.error, /bash/);
  }

  const deleteKey = validateAgentDefinition(
    { id: "locked2", name: "Locked2", systemPrompt: "x", skillIds: [], permissionPreset: { delete: "deny" } },
    BASE_POLICY,
  );
  assert.equal(deleteKey.ok, false);

  // The enforceable keys still validate fine.
  const ok = validateAgentDefinition(
    { id: "fine", name: "Fine", systemPrompt: "x", skillIds: [], permissionPreset: { edit: "deny", bash: "deny" } },
    BASE_POLICY,
  );
  assert.equal(ok.ok, true);
});

test("task requires an agent or a branch and validates references", () => {
  const known = new Set(["impl", "review"]);
  const noTarget = validateTaskDefinition(
    { id: "t1", name: "T", goal: "do", loop: { mode: "run_once", maxTurns: 3, maxDurationMs: 60_000 } },
    known,
  );
  assert.equal(noTarget.ok, false);

  const unknownAgent = validateTaskDefinition(
    {
      id: "t1",
      name: "T",
      goal: "do",
      loop: { mode: "run_once", maxTurns: 3, maxDurationMs: 60_000 },
      agentId: "ghost",
    },
    known,
  );
  assert.equal(unknownAgent.ok, false);

  const fanout = validateTaskDefinition(
    {
      id: "t-fan",
      name: "Fan",
      goal: "review from two angles",
      loop: { mode: "run_once", maxTurns: 6, maxDurationMs: 120_000 },
      branches: [{ agentId: "impl", focus: "correctness" }, { agentId: "review" }],
      maxConcurrency: 9,
    },
    known,
  );
  assert.equal(fanout.ok, true);
  if (fanout.ok) {
    assert.equal(fanout.value.branches?.length, 2);
    // maxConcurrency is clamped to the hard cap.
    assert.equal(fanout.value.maxConcurrency, FANOUT_HARD_CAP);
  }
});

test("effectiveConcurrency defaults to 3 and clamps to the hard cap", () => {
  const base: TaskDefinition = {
    id: "t",
    name: "T",
    source: "user_local",
    goal: "g",
    loop: { mode: "run_once", maxTurns: 3, maxDurationMs: 60_000 },
    agentId: "impl",
  };
  assert.equal(effectiveConcurrency(base), 3);
  assert.equal(effectiveConcurrency({ ...base, maxConcurrency: 1 }), 1);
  assert.equal(effectiveConcurrency({ ...base, maxConcurrency: 99 }), FANOUT_HARD_CAP);
});

test("no secret-bearing field is accepted (definitions are secret-free by shape)", () => {
  const res = validateAgentDefinition(
    {
      id: "a1",
      name: "A",
      systemPrompt: "p",
      skillIds: [],
      permissionPreset: {},
      // an attacker-supplied apiKey is simply not part of the shape and is dropped
      apiKey: "sk-should-not-survive",
    },
    BASE_POLICY,
  );
  assert.equal(res.ok, true);
  if (res.ok) assert.equal((res.value as unknown as Record<string, unknown>)["apiKey"], undefined);
});
