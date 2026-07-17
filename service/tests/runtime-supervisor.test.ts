/**
 * CGHC-028 Wave A1 — OpenCode child supervisor lifecycle + negative-path tests.
 *
 * The DEFAULT suite drives spawn → dirs-before-spawn → health-ready → identity + `.runtime/`
 * record → isAlive → stop (terminate + clear + idempotent + refuse double-start) against a FAKE
 * child, plus the bounded negatives (health timeout, spawn ENOENT, pin mismatch, port taken). No
 * real OpenCode / socket / PowerShell is touched. Spawning the REAL pinned binary is a bounded
 * Wave C live leg, not run here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENCODE_PIN, PinMismatchError } from "@cowork-ghc/runtime";
import { OpencodeSupervisor, type SupervisorStartSpec } from "../src/runtime/supervisor.js";
import { readRuntimeState } from "../src/runtime/runtime-state.js";
import {
  RuntimeHealthTimeoutError,
  RuntimePortInUseError,
  RuntimeSpawnError,
  RuntimeAlreadyStartedError,
} from "../src/runtime/errors.js";
import {
  FakeChild,
  recordingSpawner,
  toggleHealthProbe,
  neverReadyProbe,
  versionProbe,
  fixedTimesProbe,
  fixedPortChecker,
  fakeResolver,
} from "./runtime-supervisor-fakes.js";

const BIN = "C:\\opencode\\opencode.exe";
const PORT = 51900;
const KEY = { envVar: "OPENAI_API_KEY", value: "sk-fake-lifecycle-key" };

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cghc-sup-"));
}

function makeSpec(root: string, overrides: Partial<SupervisorStartSpec> = {}): SupervisorStartSpec {
  return {
    binPath: BIN,
    cwd: root,
    port: PORT,
    dataHome: join(root, "xdg", "data"),
    configDir: join(root, "config", "opencode"),
    injectionRequests: [],
    ...overrides,
  };
}

test("start: dirs made before spawn, key injected env-only, identity + .runtime record written", async () => {
  const root = tempRoot();
  const child = new FakeChild(4321);
  const { spawner, capture } = recordingSpawner(child);
  const logs: string[] = [];
  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([KEY]).resolve,
    spawner,
    healthProbe: toggleHealthProbe(OPENCODE_PIN).probe,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    log: (l) => logs.push(l),
    pollIntervalMs: 5,
  });

  try {
    const identity = await sup.start(makeSpec(root));

    // The CGHC-024 500-on-session bug: data/config dirs MUST exist before spawn.
    assert.equal(capture.dataHomeExistedAtSpawn, true, "XDG_DATA_HOME created before spawn");
    assert.equal(capture.configDirExistedAtSpawn, true, "OPENCODE_CONFIG_DIR created before spawn");
    assert.equal(capture.command, BIN);
    assert.ok(capture.args?.includes("serve"));
    assert.ok(capture.args?.includes(String(PORT)));

    // Provider key reached the CHILD ENV ONLY.
    assert.equal(capture.env?.["OPENAI_API_KEY"], KEY.value);

    // Identity + accessors.
    assert.equal(identity.pid, 4321);
    assert.equal(identity.port, PORT);
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.runtimeVersion, OPENCODE_PIN);
    assert.equal(sup.isAlive(), true);
    assert.equal(sup.baseUrl, `http://127.0.0.1:${PORT}`);
    assert.deepEqual(sup.identity, identity);

    // Durable .runtime record round-trips through process-identity.
    const persisted = readRuntimeState(root);
    assert.ok(persisted);
    assert.equal(persisted?.pid, 4321);
    assert.equal(persisted?.port, PORT);
    assert.equal(persisted?.runtimeVersion, OPENCODE_PIN);

    // No log line leaked the key value; the env snapshot is redacted.
    const joined = logs.join("\n");
    assert.ok(!joined.includes(KEY.value), "no log line contains the key value");
    assert.ok(joined.includes("<redacted>"), "env snapshot is redacted");
  } finally {
    await sup.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("stop: terminates the child, clears the record, is idempotent", async () => {
  const root = tempRoot();
  const child = new FakeChild(4321);
  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([KEY]).resolve,
    spawner: recordingSpawner(child).spawner,
    healthProbe: toggleHealthProbe(OPENCODE_PIN).probe,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    pollIntervalMs: 5,
  });
  try {
    await sup.start(makeSpec(root));
    await sup.stop();
    assert.equal(sup.isAlive(), false);
    assert.equal(child.killed, true, "child was terminated");
    assert.equal(readRuntimeState(root), null, ".runtime record cleared");
    // Idempotent: a second stop is a no-op and never throws.
    await sup.stop();
    assert.equal(sup.isAlive(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one owner: a second start() without stop() is refused", async () => {
  const root = tempRoot();
  // A real spawn yields a FRESH process each call — model that so restart-after-stop works.
  const freshSpawner = { spawn: () => new FakeChild() };
  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([KEY]).resolve,
    spawner: freshSpawner,
    healthProbe: toggleHealthProbe(OPENCODE_PIN).probe,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    pollIntervalMs: 5,
  });
  try {
    await sup.start(makeSpec(root));
    await assert.rejects(sup.start(makeSpec(root)), RuntimeAlreadyStartedError);
    // After a clean stop, starting again is allowed.
    await sup.stop();
    await sup.start(makeSpec(root));
    assert.equal(sup.isAlive(), true);
  } finally {
    await sup.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("negative: health that never becomes ready fails typed + bounded (no hang)", async () => {
  const root = tempRoot();
  const child = new FakeChild();
  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([KEY]).resolve,
    spawner: recordingSpawner(child).spawner,
    healthProbe: neverReadyProbe,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    pollIntervalMs: 10,
  });
  try {
    await assert.rejects(
      sup.start(makeSpec(root, { healthTimeoutMs: 120 })),
      RuntimeHealthTimeoutError,
    );
    assert.equal(sup.isAlive(), false);
    assert.equal(child.killed, true, "child killed after a failed start");
    assert.equal(readRuntimeState(root), null, "no record written on timeout");
  } finally {
    await sup.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("negative: spawn ENOENT maps to a typed RuntimeSpawnError", async () => {
  const root = tempRoot();
  const child = new FakeChild();
  const { spawner } = recordingSpawner(child, (c) => {
    // Emit the spawn error once the supervisor has attached its listeners.
    setImmediate(() => (c as FakeChild).emitError(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
  });
  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([KEY]).resolve,
    spawner,
    healthProbe: neverReadyProbe,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    pollIntervalMs: 10,
  });
  try {
    await assert.rejects(sup.start(makeSpec(root)), (err: unknown) => {
      assert.ok(err instanceof RuntimeSpawnError);
      assert.equal(err.osCode, "ENOENT");
      return true;
    });
    assert.equal(readRuntimeState(root), null);
  } finally {
    await sup.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("negative: a non-pinned reported version fails closed (PinMismatchError)", async () => {
  const root = tempRoot();
  const child = new FakeChild();
  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([KEY]).resolve,
    spawner: recordingSpawner(child).spawner,
    healthProbe: versionProbe("v9.9.9"),
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    pollIntervalMs: 5,
  });
  try {
    await assert.rejects(sup.start(makeSpec(root)), PinMismatchError);
    assert.equal(sup.isAlive(), false);
    assert.equal(child.killed, true, "child killed on pin mismatch");
    assert.equal(readRuntimeState(root), null, "no record for an unpinned binary");
  } finally {
    await sup.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("negative: a busy port fails typed before any spawn", async () => {
  const root = tempRoot();
  const { spawner, capture } = recordingSpawner(new FakeChild());
  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([KEY]).resolve,
    spawner,
    healthProbe: toggleHealthProbe(OPENCODE_PIN).probe,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(false),
    pollIntervalMs: 5,
  });
  try {
    await assert.rejects(sup.start(makeSpec(root)), RuntimePortInUseError);
    assert.equal(capture.count, 0, "no child is spawned when the port is taken");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readiness: the default fetch health probe drives a real /global/health server", async () => {
  const root = tempRoot();
  let server: Server | undefined;
  const child = new FakeChild(7777);
  try {
    const port = await new Promise<number>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === "/global/health") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ healthy: true, version: OPENCODE_PIN }));
          return;
        }
        res.writeHead(404).end();
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server?.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const sup = new OpencodeSupervisor({
      root,
      resolveInjections: fakeResolver([KEY]).resolve,
      spawner: recordingSpawner(child).spawner,
      // No healthProbe override: exercise the real fetchHealthProbe path.
      processTimesProbe: fixedTimesProbe(),
      portChecker: fixedPortChecker(true), // the stub server holds the port; the child is faked.
      pollIntervalMs: 10,
    });
    const identity = await sup.start(makeSpec(root, { port, healthTimeoutMs: 2000 }));
    assert.equal(identity.pid, 7777);
    assert.equal(sup.isAlive(), true);
    await sup.stop();
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
