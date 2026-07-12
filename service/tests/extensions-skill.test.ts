/**
 * CGHC-026 RE1/RE5 — skill registry test.
 *
 * Proves: list → enable → exercise the sample skill via a FAKE {@link SkillRunner}; exercising a
 * disabled/unknown skill is an honest typed error; a skill-runner FAILURE becomes a diagnostic
 * without crashing; the honest not-attached runner reports `unavailable` (no fabrication).
 *
 * No live process, no network: the runner is an in-memory fake.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExtensionState,
  createSkillRegistry,
  notAttachedSkillRunner,
  type SkillRunner,
} from "../src/extensions/index.js";

const FIXED_NOW = () => "2026-07-11T00:00:00.000Z";

/** A fake runner that echoes the input, or rejects when told to. */
function fakeRunner(opts: { rejects?: boolean } = {}): SkillRunner {
  return {
    run: (_skill, input) =>
      opts.rejects
        ? Promise.reject(new Error("skill sandbox crashed"))
        : Promise.resolve({ status: "ok", output: { echoed: input } }),
  };
}

test("list exposes the built-in sample skills, all enabled by default (RE1)", () => {
  const reg = createSkillRegistry({ runner: fakeRunner() });
  const list = reg.list();
  assert.ok(list.length >= 1, "at least one built-in skill");
  assert.ok(list.every((s) => s.status === "enabled"));
  assert.ok(list.some((s) => s.definition.id === "cowork.summarize"));
});

test("enable → exercise the sample skill through the runner (RE1)", async () => {
  const reg = createSkillRegistry({ runner: fakeRunner() });
  const enabled = reg.enable("cowork.summarize");
  assert.ok(enabled.ok);

  const run = await reg.exercise("cowork.summarize", { text: "hello world" });
  assert.ok(run.ok);
  assert.deepEqual(run.value, { echoed: { text: "hello world" } });
});

test("exercising an unknown skill is an honest typed error", async () => {
  const reg = createSkillRegistry({ runner: fakeRunner() });
  const run = await reg.exercise("nope", {});
  assert.equal(run.ok === false && run.error.code, "unknown_extension");
});

test("exercising a disabled skill is an honest typed error", async () => {
  const reg = createSkillRegistry({ runner: fakeRunner() });
  const disabled = reg.disable("cowork.summarize");
  assert.ok(disabled.ok);
  const run = await reg.exercise("cowork.summarize", { text: "x" });
  assert.equal(run.ok === false && run.error.code, "extension_disabled");
});

test("the not-attached default runner reports unavailable — no fabricated output", async () => {
  const reg = createSkillRegistry({ runner: notAttachedSkillRunner() });
  const run = await reg.exercise("cowork.summarize", { text: "x" });
  assert.equal(run.ok === false && run.error.code, "unavailable");
});

test("a skill-runner FAILURE becomes a diagnostic without crashing (RE5)", async () => {
  const state = createExtensionState({ now: FIXED_NOW });
  const reg = createSkillRegistry({ state, runner: fakeRunner({ rejects: true }) });

  const run = await reg.exercise("cowork.summarize", { text: "x" });
  assert.equal(run.ok === false && run.error.code, "extension_failed");

  const diags = reg.diagnostics();
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.kind, "skill");
  assert.equal(diags[0]?.name, "Summarize Selection");
  assert.match(diags[0]?.reason ?? "", /crashed/);
  assert.equal(state.status("skill", "cowork.summarize"), "failed");

  // Quarantined: exercising again is skipped, not retried into a crash loop.
  const retry = await reg.exercise("cowork.summarize", { text: "x" });
  assert.equal(retry.ok === false && retry.error.code, "quarantined");

  // The registry still works for other skills.
  const other = await reg.exercise("cowork.draft-reply", { message: "m", tone: "t" });
  // draft-reply uses the same failing runner, so it too fails — but the registry did not crash.
  assert.equal(other.ok, false);
});

test("quarantine is sticky: disable then enable must NOT resurrect a failed skill (FIX-1)", async () => {
  const reg = createSkillRegistry({ runner: fakeRunner({ rejects: true }) });

  // Trigger a failure → quarantine.
  const run = await reg.exercise("cowork.summarize", { text: "x" });
  assert.equal(run.ok === false && run.error.code, "extension_failed");

  // disable() must refuse (not overwrite `failed` with `disabled`).
  const disabled = reg.disable("cowork.summarize");
  assert.equal(disabled.ok === false && disabled.error.code, "quarantined");

  // enable() must still refuse — the skill was never un-quarantined behind our back.
  const reEnabled = reg.enable("cowork.summarize");
  assert.equal(reEnabled.ok === false && reEnabled.error.code, "quarantined");

  // The list still reports it as failed (RE5 invariant intact through the public API).
  const view = reg.list().find((s) => s.definition.id === "cowork.summarize");
  assert.equal(view?.status, "failed");
});

test("clearQuarantine is the one explicit un-quarantine route (FIX-1)", async () => {
  const reg = createSkillRegistry({ runner: fakeRunner({ rejects: true }) });
  await reg.exercise("cowork.summarize", { text: "x" }); // quarantine it

  // The deliberate clear resets to `disabled`, not straight to enabled.
  const cleared = reg.clearQuarantine("cowork.summarize");
  assert.ok(cleared.ok);
  assert.equal(cleared.ok && cleared.value.status, "disabled");

  // Now an explicit enable is allowed again.
  const enabled = reg.enable("cowork.summarize");
  assert.ok(enabled.ok);
  assert.equal(enabled.ok && enabled.value.status, "enabled");

  // clearQuarantine on an unknown id is a typed error; on a non-quarantined skill it is idempotent.
  const unknown = reg.clearQuarantine("nope");
  assert.equal(unknown.ok === false && unknown.error.code, "unknown_extension");
  const idempotent = reg.clearQuarantine("cowork.summarize");
  assert.ok(idempotent.ok);
  assert.equal(idempotent.ok && idempotent.value.status, "enabled");
});
