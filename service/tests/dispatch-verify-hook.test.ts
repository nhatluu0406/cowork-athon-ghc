/**
 * Composition wiring: the retry_until_verified verification hook (compose-service.ts) reads
 * real disk evidence (dispatch-verify-hook-retry-until-verified). Hermetic — every state path
 * lives under a per-test temp dir, never the shared `.runtime/` tree.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createCoworkService, type CoworkServiceOptions } from "../src/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import type { TaskDefinition } from "@cowork-ghc/contracts";
import type { BranchRunner } from "../src/dispatchers/index.js";
import type { DnsResolver } from "../src/provider/index.js";

const nullResolver: DnsResolver = () => Promise.resolve([]);

function bootOptions(over: Partial<CoworkServiceOptions> = {}): CoworkServiceOptions {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "cowork-dispatch-verify-"));
  return {
    credentialStore: createMemoryStore(),
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    settingsFilePath: path.join(stateDir, "settings.json"),
    ...over,
  };
}

function task(over: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: "verify-task",
    name: "Verify task",
    source: "user_local",
    goal: "write the report",
    loop: { mode: "retry_until_verified", maxTurns: 3, maxDurationMs: 30_000 },
    agentId: "researcher", // built-in agent, always present in the catalog
    ...over,
  };
}

async function waitForTerminal(
  get: () => { status: string } | undefined,
  timeoutMs = 3_000,
): Promise<{ status: string }> {
  const start = Date.now();
  for (;;) {
    const view = get();
    if (view !== undefined && view.status !== "running") return view;
    if (Date.now() - start > timeoutMs) throw new Error("run did not terminate in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("retry_until_verified: a branch that really wrote its declared output ends completed+verified", async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "cowork-dispatch-verify-ws-"));
  const workspaceRoot = path.join(stateDir, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(path.join(workspaceRoot, "report.md"), "# done", "utf8");

  const branchRunner: BranchRunner = async () => ({
    status: "completed",
    mutatedPaths: ["report.md"],
  });

  const composed = await createCoworkService(bootOptions({ branchRunner }));
  await composed.deps.settingsStore.setActiveWorkspace(workspaceRoot);

  const started = composed.deps.dispatchRuns.start(task());
  const view = await waitForTerminal(() => composed.deps.dispatchRuns.get(started.runId));
  assert.equal(view.status, "completed");
  assert.equal((view as { verified: boolean }).verified, true);
  assert.equal((view as { attempts: number }).attempts, 1);
});

test("retry_until_verified: a claimed output never actually written ends honestly exhausted, never fabricated completed", async () => {
  const branchRunner: BranchRunner = async () => ({
    status: "completed",
    mutatedPaths: ["never-written.md"], // claimed, but no active workspace ⇒ can never be verified
  });

  const composed = await createCoworkService(bootOptions({ branchRunner }));
  // No active workspace configured — the hook cannot check disk, so it must never verify.

  const started = composed.deps.dispatchRuns.start(task({ id: "verify-task-2" }));
  const view = await waitForTerminal(() => composed.deps.dispatchRuns.get(started.runId));
  assert.equal(view.status, "exhausted");
  assert.equal((view as { verified: boolean }).verified, false);
  assert.equal((view as { attempts: number }).attempts, 3, "must burn exactly maxTurns attempts, never fewer/more");
});

test("run_once behavior is unchanged by the wired hook (no evidence required, no retries)", async () => {
  let calls = 0;
  const branchRunner: BranchRunner = async () => {
    calls += 1;
    return { status: "completed" }; // no evidencePaths at all
  };

  const composed = await createCoworkService(bootOptions({ branchRunner }));
  const started = composed.deps.dispatchRuns.start(
    task({ id: "verify-task-3", loop: { mode: "run_once", maxTurns: 5, maxDurationMs: 30_000 } }),
  );
  const view = await waitForTerminal(() => composed.deps.dispatchRuns.get(started.runId));
  assert.equal(view.status, "completed");
  assert.equal(calls, 1, "run_once must never retry regardless of the verification hook being wired");
});
