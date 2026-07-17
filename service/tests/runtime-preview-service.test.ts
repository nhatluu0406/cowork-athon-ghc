/**
 * PreviewService lifecycle + security tests. No real process/port/taskkill: a FakePreviewChild
 * is driven by the test and a recording spawner captures the exact command/args/env/cwd. The
 * permission layer is the REAL preview gate, so "a Deny never spawns" and "start runs only
 * after Allow" are enforced by production code, not by the test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimePreviewProjectInfo } from "@cowork-ghc/contracts";
import { createPreviewService, type PreviewServiceDeps } from "../src/runtime-preview/preview-service.js";
import { createPreviewGate } from "../src/runtime-preview/preview-gate.js";
import { createInMemoryAuditSink } from "../src/permission/audit.js";
import { createNodeScheduler } from "../src/permission/timer.js";
import { createSecretScrubber } from "../src/diagnostics/secret-scrubber.js";
import type { PreviewChild, PreviewSpawner } from "../src/runtime-preview/preview-spawner.js";
import { FakePreviewChild, recordingPreviewSpawner, manualPoll, type SpawnCapture } from "./runtime-preview-fakes.js";

const DEV_INFO: RuntimePreviewProjectInfo = {
  kind: "dev-server",
  hasStaticIndex: false,
  hasPackageJson: true,
  packageJsonMalformed: false,
  devScripts: ["dev", "start"],
  packageManager: "npm",
};

interface Harness {
  service: ReturnType<typeof createPreviewService>;
  capture: SpawnCapture;
  child: FakePreviewChild;
  audit: ReturnType<typeof createInMemoryAuditSink>;
  poll: ReturnType<typeof manualPoll>;
}

function makeHarness(overrides: Partial<PreviewServiceDeps> = {}, child = new FakePreviewChild()): Harness {
  const audit = createInMemoryAuditSink();
  const gate = createPreviewGate({ audit, scheduler: createNodeScheduler(), now: () => "T", timeoutMs: 60_000 });
  const scrubber = createSecretScrubber();
  const { spawner, capture } = recordingPreviewSpawner(child);
  const poll = manualPoll();
  let counter = 0;
  const service = createPreviewService({
    getActiveRoot: () => "C:\\ws",
    gate,
    scrubber,
    spawner,
    detect: async () => DEV_INFO,
    confineCwd: async (root) => root,
    allocatePort: async () => 4173,
    probePort: async () => false,
    parentEnv: { PATH: "C:\\bin", OPENAI_API_KEY: "sk-secret" },
    now: () => `t${(counter += 1)}`,
    nowMs: () => counter,
    setPoll: poll.setPoll,
    startupTimeoutMs: 100,
    gracefulStopMs: 10,
    ...overrides,
  });
  return { service, capture, child, audit, poll };
}

async function approveLaunch(h: Harness): Promise<void> {
  const { requestId } = await h.service.requestLaunch({ kind: "dev-server", script: "dev" });
  await h.service.resolveLaunch(requestId, "allow");
}

test("deny never spawns and is audited", async () => {
  const h = makeHarness();
  const { requestId } = await h.service.requestLaunch({ kind: "dev-server", script: "dev" });
  const state = await h.service.resolveLaunch(requestId, "deny");
  assert.equal(h.capture.command, undefined, "no process spawned on deny");
  assert.notEqual(state.status, "running");
  assert.notEqual(state.status, "starting");
  const denies = h.audit.events().filter((e) => e.decision === "deny");
  assert.ok(denies.length >= 1, "deny recorded to audit");
});

test("allow spawns cmd.exe run <script> and reaches running when the URL is printed", async () => {
  const h = makeHarness();
  await approveLaunch(h);
  assert.ok(h.capture.command?.toLowerCase().includes("cmd"));
  assert.deepEqual([...(h.capture.args ?? [])], ["/d", "/s", "/c", "npm", "run", "dev"]);
  assert.equal(h.service.state().status, "starting");
  h.child.emitData("stdout", "  ➜  Local:   http://localhost:5173/\n");
  const state = h.service.state();
  assert.equal(state.status, "running");
  assert.equal(state.url, "http://127.0.0.1:5173");
  assert.equal(state.command, "npm run dev");
});

test("launched env is the curated allowlist — no provider secret, cwd confined", async () => {
  const h = makeHarness();
  await approveLaunch(h);
  const env = h.capture.options?.env ?? {};
  assert.equal(env["PATH"], "C:\\bin");
  assert.equal(env["OPENAI_API_KEY"], undefined);
  assert.equal(env["BROWSER"], "none");
  assert.equal(h.capture.options?.cwd, "C:\\ws");
});

test("a cwd that escapes the workspace refuses to spawn", async () => {
  const h = makeHarness({
    confineCwd: async () => {
      throw new Error("symlink_escape");
    },
  });
  // Confinement is checked at request time → the launch is refused before any permission/spawn.
  await assert.rejects(h.service.requestLaunch({ kind: "dev-server", script: "dev" }));
  assert.equal(h.capture.command, undefined, "no spawn when cwd cannot be confined");
});

test("duplicate start is rejected while a preview is running", async () => {
  const h = makeHarness();
  await approveLaunch(h);
  h.child.emitData("stdout", "Local: http://localhost:5173/\n");
  await assert.rejects(h.service.requestLaunch({ kind: "dev-server", script: "dev" }));
  await assert.rejects(h.service.startStaticPreview());
});

test("startup timeout fails and force-kills the tree", async () => {
  const child = new FakePreviewChild(4321, { gracefulOnKill: false });
  // startupTimeoutMs < 0 → the deadline is already in the past on the first poll tick.
  const h = makeHarness({ startupTimeoutMs: -1 }, child);
  await approveLaunch(h);
  assert.equal(h.service.state().status, "starting");
  h.poll.step();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.service.state().status, "failed");
  assert.ok(child.killTreeCalls >= 1, "tree force-killed on timeout");
});

test("an unexpected exit while running is reported as a crash", async () => {
  const h = makeHarness();
  await approveLaunch(h);
  h.child.emitData("stdout", "Local: http://localhost:5173/\n");
  assert.equal(h.service.state().status, "running");
  h.child.emitExit(1);
  assert.equal(h.service.state().status, "failed");
});

test("a spawn error (missing executable) fails cleanly", async () => {
  const h = makeHarness();
  await approveLaunch(h);
  h.child.emitError(new Error("spawn cmd.exe ENOENT"));
  const state = h.service.state();
  assert.equal(state.status, "failed");
  assert.ok(state.error && state.error.length > 0);
});

test("graceful stop does not force-kill; stubborn stop escalates to tree-kill", async () => {
  const graceful = new FakePreviewChild(1, { gracefulOnKill: true });
  const h1 = makeHarness({}, graceful);
  await approveLaunch(h1);
  h1.child.emitData("stdout", "Local: http://localhost:3000/\n");
  await h1.service.stop("user");
  assert.equal(graceful.killCalls, 1);
  assert.equal(graceful.killTreeCalls, 0);
  assert.equal(h1.service.state().status, "stopped");

  const stubborn = new FakePreviewChild(2, { gracefulOnKill: false });
  const h2 = makeHarness({ gracefulStopMs: 10 }, stubborn);
  await approveLaunch(h2);
  h2.child.emitData("stdout", "Local: http://localhost:3000/\n");
  await h2.service.stop("user");
  assert.ok(stubborn.killTreeCalls >= 1, "escalates to tree-kill when graceful fails");
});

test("static preview needs no permission and reaches running", async () => {
  const h = makeHarness({
    detect: async () => ({
      kind: "static",
      hasStaticIndex: true,
      hasPackageJson: false,
      packageJsonMalformed: false,
      devScripts: [],
      packageManager: null,
    }),
    startStatic: async (_root, port) => ({ url: `http://127.0.0.1:${port}`, port, close: async () => undefined }),
  });
  const state = await h.service.startStaticPreview();
  assert.equal(state.status, "running");
  assert.equal(state.kind, "static");
  assert.equal(state.command, null, "static preview runs no command");
});

test("workspace change disposes the process and resets to idle", async () => {
  const h = makeHarness();
  await approveLaunch(h);
  h.child.emitData("stdout", "Local: http://localhost:5173/\n");
  await h.service.dispose("workspace_changed");
  assert.ok(h.child.killCalls + h.child.killTreeCalls >= 1, "process torn down");
  assert.equal(h.service.state().status, "idle");
  assert.equal(h.service.state().url, null);
});

test("restart re-uses the approved launch (a second spawn) without re-prompting", async () => {
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
  await approveLaunch(h);
  children[0]!.emitData("stdout", "Local: http://localhost:5173/\n");
  assert.equal(h.service.state().status, "running");
  await h.service.restart();
  assert.equal(captures.length, 2, "restart spawned a second process without a new permission");
  assert.equal(h.service.state().status, "starting");
});

test("detect with no active workspace is unsupported", async () => {
  const h = makeHarness({ getActiveRoot: () => undefined });
  const info = await h.service.detect();
  assert.equal(info.kind, "unsupported");
});
