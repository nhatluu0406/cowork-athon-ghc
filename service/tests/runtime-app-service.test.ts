/**
 * AppService lifecycle + security + permission tests (Slice 2). No real process/taskkill: a
 * FakePreviewChild is driven by the test, a recording spawner captures the exact command/args/
 * env/cwd, and a manual readiness timer controls the starting→running transition. The permission
 * layer is the REAL preview-style gate, so "a Deny never spawns" and "start runs only after
 * Allow" are enforced by production code, not the test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeAppProjectInfo } from "@cowork-ghc/contracts";
import { createAppService, type AppServiceDeps } from "../src/runtime-app/app-service.js";
import { createPreviewGate } from "../src/runtime-preview/preview-gate.js";
import { createInMemoryAuditSink } from "../src/permission/audit.js";
import { createNodeScheduler } from "../src/permission/timer.js";
import { createSecretScrubber } from "../src/diagnostics/secret-scrubber.js";
import type { PreviewChild, PreviewSpawner } from "../src/runtime-preview/preview-spawner.js";
import { FakePreviewChild, recordingPreviewSpawner, type SpawnCapture } from "./runtime-preview-fakes.js";

const APP_INFO: RuntimeAppProjectInfo = {
  kind: "electron",
  hasPackageJson: true,
  packageJsonMalformed: false,
  hasElectronDependency: true,
  runScripts: ["start", "dev"],
  buildScripts: ["build"],
  packageManager: "npm",
};

function manualTimer(): {
  setTimer: (fn: () => void, ms: number) => { cancel: () => void };
  fire: () => void;
} {
  let current: (() => void) | null = null;
  return {
    setTimer: (fn) => {
      current = fn;
      return { cancel: () => (current = null) };
    },
    fire: () => {
      const fn = current;
      current = null;
      fn?.();
    },
  };
}

interface Harness {
  service: ReturnType<typeof createAppService>;
  capture: SpawnCapture;
  child: FakePreviewChild;
  audit: ReturnType<typeof createInMemoryAuditSink>;
  timer: ReturnType<typeof manualTimer>;
}

function makeHarness(overrides: Partial<AppServiceDeps> = {}, child = new FakePreviewChild()): Harness {
  const audit = createInMemoryAuditSink();
  const gate = createPreviewGate({ audit, scheduler: createNodeScheduler(), now: () => "T", timeoutMs: 60_000 });
  const scrubber = createSecretScrubber();
  const { spawner, capture } = recordingPreviewSpawner(child);
  const timer = manualTimer();
  let counter = 0;
  const service = createAppService({
    getActiveRoot: () => "C:\\ws",
    gate,
    scrubber,
    spawner,
    detect: async () => APP_INFO,
    confineCwd: async (root) => root,
    parentEnv: { PATH: "C:\\bin", OPENAI_API_KEY: "sk-secret", COWORK_VAULT_SECRET: "vault" },
    now: () => `t${(counter += 1)}`,
    setTimer: timer.setTimer,
    gracefulStopMs: 10,
    ...overrides,
  });
  return { service, capture, child, audit, timer };
}

async function approveRun(h: Harness, script = "start"): Promise<void> {
  const { requestId } = await h.service.requestLaunch({ action: "run", script });
  await h.service.resolveLaunch(requestId, "allow");
}

test("deny never spawns and is audited", async () => {
  const h = makeHarness();
  const { requestId } = await h.service.requestLaunch({ action: "run", script: "start" });
  const state = await h.service.resolveLaunch(requestId, "deny");
  assert.equal(h.capture.command, undefined, "no process spawned on deny");
  assert.equal(state.status, "stopped");
  assert.ok(h.audit.events().some((e) => e.decision === "deny"), "deny recorded");
});

test("allow run spawns cmd.exe run <script>, reaches running after readiness", async () => {
  const h = makeHarness();
  await approveRun(h);
  assert.ok(h.capture.command?.toLowerCase().includes("cmd"));
  assert.deepEqual([...(h.capture.args ?? [])], ["/d", "/s", "/c", "npm", "run", "start"]);
  assert.equal(h.service.state().status, "starting");
  h.timer.fire();
  const state = h.service.state();
  assert.equal(state.status, "running");
  assert.equal(state.command, "npm run start");
  assert.equal(state.action, "run");
});

test("curated env drops provider/vault secret; cwd confined", async () => {
  const h = makeHarness();
  await approveRun(h);
  const env = h.capture.options?.env ?? {};
  assert.equal(env["PATH"], "C:\\bin");
  assert.equal(env["OPENAI_API_KEY"], undefined);
  assert.equal(env["COWORK_VAULT_SECRET"], undefined);
  assert.equal(h.capture.options?.cwd, "C:\\ws");
});

test("a cwd that escapes the workspace refuses to spawn", async () => {
  const h = makeHarness({
    confineCwd: async () => {
      throw new Error("symlink_escape");
    },
  });
  await assert.rejects(h.service.requestLaunch({ action: "run", script: "start" }));
  assert.equal(h.capture.command, undefined);
});

test("an invalid script (not in the detected list) is rejected before any permission/spawn", async () => {
  const h = makeHarness();
  await assert.rejects(h.service.requestLaunch({ action: "run", script: "rm -rf" }));
  assert.equal(h.capture.command, undefined);
});

test("duplicate start is rejected while running", async () => {
  const h = makeHarness();
  await approveRun(h);
  h.timer.fire();
  await assert.rejects(h.service.requestLaunch({ action: "run", script: "start" }));
});

test("run process crash before readiness → failed", async () => {
  const h = makeHarness();
  await approveRun(h);
  assert.equal(h.service.state().status, "starting");
  h.child.emitExit(1);
  const s = h.service.state();
  assert.equal(s.status, "failed");
  assert.equal(s.exitCode, 1);
});

test("running app that exits cleanly → stopped", async () => {
  const h = makeHarness();
  await approveRun(h);
  h.timer.fire();
  assert.equal(h.service.state().status, "running");
  h.child.emitExit(0);
  assert.equal(h.service.state().status, "stopped");
});

test("a spawn error (missing executable) fails cleanly", async () => {
  const h = makeHarness();
  await approveRun(h);
  h.child.emitError(new Error("spawn cmd.exe ENOENT"));
  const s = h.service.state();
  assert.equal(s.status, "failed");
  assert.ok(s.error && s.error.length > 0);
});

test("stop terminates the whole tree (no orphan) and reaches stopped", async () => {
  const h = makeHarness();
  await approveRun(h);
  h.timer.fire();
  await h.service.stop("user");
  assert.ok(h.child.killTreeCalls >= 1, "tree-killed on stop");
  assert.equal(h.service.state().status, "stopped");
});

test("build action: exit 0 → stopped (build ok); exit != 0 → failed", async () => {
  const ok = makeHarness();
  {
    const { requestId } = await ok.service.requestLaunch({ action: "build", script: "build" });
    await ok.service.resolveLaunch(requestId, "allow");
    assert.equal(ok.service.state().status, "building");
    assert.deepEqual([...(ok.capture.args ?? [])], ["/d", "/s", "/c", "npm", "run", "build"]);
    ok.child.emitExit(0);
    assert.equal(ok.service.state().status, "stopped");
  }
  const bad = makeHarness();
  {
    const { requestId } = await bad.service.requestLaunch({ action: "build", script: "build" });
    await bad.service.resolveLaunch(requestId, "allow");
    bad.child.emitExit(2);
    assert.equal(bad.service.state().status, "failed");
  }
});

test("build requested but the project has no build script → rejected", async () => {
  const h = makeHarness({ detect: async () => ({ ...APP_INFO, buildScripts: [] }) });
  await assert.rejects(h.service.requestLaunch({ action: "build" }));
});

test("restart re-uses the approved run (a second spawn) without re-prompting", async () => {
  const children = [new FakePreviewChild(1), new FakePreviewChild(2)];
  let i = 0;
  const captures: SpawnCapture[] = [];
  const spawner: PreviewSpawner = {
    spawn(command, args, options): PreviewChild {
      captures.push({ command, args, options });
      return children[i++]!;
    },
  };
  const h = makeHarness({ spawner });
  await approveRun(h);
  h.timer.fire();
  assert.equal(h.service.state().status, "running");
  await h.service.restart();
  assert.equal(captures.length, 2, "restart spawned a second process without a new permission");
  assert.equal(h.service.state().status, "starting");
});

test("workspace change disposes the process and resets to stopped", async () => {
  const h = makeHarness();
  await approveRun(h);
  h.timer.fire();
  await h.service.dispose("workspace_changed");
  assert.ok(h.child.killCalls + h.child.killTreeCalls >= 1, "process torn down");
  const s = h.service.state();
  assert.equal(s.status, "stopped");
  assert.equal(s.command, null);
});

test("detect with no active workspace is unsupported", async () => {
  const h = makeHarness({ getActiveRoot: () => undefined });
  const info = await h.service.detect();
  assert.equal(info.kind, "unsupported");
});
