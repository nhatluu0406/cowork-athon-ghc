import { test } from "node:test";
import assert from "node:assert/strict";
import type { LoopPolicy } from "@cowork-ghc/contracts";
import { startLoopRun, type AttemptResult } from "../src/tasks/loop-runner.js";

function policy(over: Partial<LoopPolicy> = {}): LoopPolicy {
  return { mode: "run_once", maxTurns: 5, maxDurationMs: 60_000, ...over };
}

const completed = (summary?: string): AttemptResult => ({
  status: "completed",
  ...(summary !== undefined ? { summary } : {}),
});
const errored = (summary?: string): AttemptResult => ({
  status: "errored",
  ...(summary !== undefined ? { summary } : {}),
});

test("run_once: a completed attempt ends the loop completed after exactly one attempt", async () => {
  const run = startLoopRun(policy(), { execute: async () => completed("done") });
  const out = await run.done;
  assert.equal(out.status, "completed");
  assert.equal(out.attempts, 1);
  assert.equal(out.lastSummary, "done");
  assert.equal(run.status(), "completed");
});

test("run_once: a failed attempt is errored — never retried, never a fake success", async () => {
  let calls = 0;
  const run = startLoopRun(policy(), {
    execute: async () => {
      calls += 1;
      return errored("boom");
    },
  });
  const out = await run.done;
  assert.equal(out.status, "errored");
  assert.equal(calls, 1);
});

test("run_once: a throwing executor is an errored attempt, not an unhandled rejection", async () => {
  const run = startLoopRun(policy(), {
    execute: async () => {
      throw new Error("crash");
    },
  });
  const out = await run.done;
  assert.equal(out.status, "errored");
  assert.equal(out.lastSummary, "crash");
});

test("run_once + requireVerifiedEvidence: completed without evidence is exhausted, not completed", async () => {
  const run = startLoopRun(policy({ requireVerifiedEvidence: true }), {
    execute: async () => completed(),
    verify: async () => ({ verified: false }),
  });
  const out = await run.done;
  assert.equal(out.status, "exhausted");
  assert.equal(out.verified, false);
});

test("run_once + requireVerifiedEvidence without a hook errors immediately", async () => {
  const run = startLoopRun(policy({ requireVerifiedEvidence: true }), {
    execute: async () => completed(),
  });
  const out = await run.done;
  assert.equal(out.status, "errored");
  assert.match(out.reason, /verification hook/);
});

test("retry_until_verified: retries until the hook confirms evidence, then reports verified", async () => {
  let attempts = 0;
  const run = startLoopRun(policy({ mode: "retry_until_verified" }), {
    execute: async () => {
      attempts += 1;
      return completed(`attempt ${attempts}`);
    },
    verify: async (attempt) => (attempt >= 3 ? { verified: true, evidence: "file on disk" } : { verified: false }),
  });
  const out = await run.done;
  assert.equal(out.status, "completed");
  assert.equal(out.verified, true);
  assert.equal(out.attempts, 3);
  assert.equal(out.evidence, "file on disk");
});

test("retry_until_verified: an errored attempt is retried (that is the mode's point)", async () => {
  let attempts = 0;
  const run = startLoopRun(policy({ mode: "retry_until_verified" }), {
    execute: async () => {
      attempts += 1;
      return attempts < 2 ? errored() : completed();
    },
    verify: async () => ({ verified: true }),
  });
  const out = await run.done;
  assert.equal(out.status, "completed");
  assert.equal(out.attempts, 2);
});

test("retry_until_verified: maxTurns guardrail exhausts honestly, never fabricates success", async () => {
  let attempts = 0;
  const run = startLoopRun(policy({ mode: "retry_until_verified", maxTurns: 3 }), {
    execute: async () => {
      attempts += 1;
      return completed();
    },
    verify: async () => ({ verified: false }),
  });
  const out = await run.done;
  assert.equal(out.status, "exhausted");
  assert.equal(out.verified, false);
  assert.equal(attempts, 3);
  assert.match(out.reason, /maxTurns/);
});

test("retry_until_verified without a verification hook errors immediately, burning no turns", async () => {
  let attempts = 0;
  const run = startLoopRun(policy({ mode: "retry_until_verified" }), {
    execute: async () => {
      attempts += 1;
      return completed();
    },
  });
  const out = await run.done;
  assert.equal(out.status, "errored");
  assert.equal(attempts, 0);
});

test("maxDurationMs guardrail: an in-flight attempt is aborted and the loop is exhausted", async () => {
  let sawAbort = false;
  const run = startLoopRun(policy({ mode: "retry_until_verified", maxDurationMs: 1_000 }), {
    execute: (_attempt, signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          sawAbort = true;
          resolve(errored("aborted"));
        });
      }),
    verify: async () => ({ verified: false }),
    now: (() => {
      // Deterministic clock: the run starts at 0; every later look at the clock is past the cap.
      let calls = 0;
      return () => (calls++ === 0 ? 0 : 5_000);
    })(),
  });
  // The real deadline timer would also fire at 1s; the clock guardrail ends it first.
  const out = await run.done;
  assert.equal(out.status, "exhausted");
  assert.match(out.reason, /maxDurationMs/);
  assert.equal(out.verified, false);
  assert.equal(sawAbort || out.attempts <= 1, true);
});

test("cancel: aborts the in-flight attempt and ends the loop as cancelled", async () => {
  const run = startLoopRun(policy({ mode: "retry_until_verified" }), {
    execute: (_attempt, signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(errored("aborted")));
      }),
    verify: async () => ({ verified: false }),
  });
  assert.equal(run.status(), "running");
  run.cancel();
  const out = await run.done;
  assert.equal(out.status, "cancelled");
  assert.equal(run.status(), "cancelled");
});

test("scheduled: runs an attempt per interval until maxTurns, all completed → completed", async () => {
  let attempts = 0;
  const run = startLoopRun(policy({ mode: "scheduled", maxTurns: 3, intervalMs: 5 }), {
    execute: async () => {
      attempts += 1;
      return completed();
    },
  });
  const out = await run.done;
  assert.equal(out.status, "completed");
  assert.equal(out.attempts, 3);
  assert.equal(attempts, 3);
});

test("scheduled: mixed attempt outcomes end as an honest partial", async () => {
  let attempts = 0;
  const run = startLoopRun(policy({ mode: "scheduled", maxTurns: 2, intervalMs: 5 }), {
    execute: async () => {
      attempts += 1;
      return attempts === 1 ? completed() : errored();
    },
  });
  const out = await run.done;
  assert.equal(out.status, "partial");
});

test("scheduled: all attempts failing end as errored", async () => {
  const run = startLoopRun(policy({ mode: "scheduled", maxTurns: 2, intervalMs: 5 }), {
    execute: async () => errored(),
  });
  const out = await run.done;
  assert.equal(out.status, "errored");
});

test("scheduled: cancel between intervals stops the loop as cancelled", async () => {
  let attempts = 0;
  const run = startLoopRun(policy({ mode: "scheduled", maxTurns: 50, intervalMs: 60_000 }), {
    execute: async () => {
      attempts += 1;
      return completed();
    },
  });
  // Let the first attempt land, then cancel during the (long) sleep.
  await new Promise((r) => setTimeout(r, 20));
  run.cancel();
  const out = await run.done;
  assert.equal(out.status, "cancelled");
  assert.equal(attempts, 1);
});
