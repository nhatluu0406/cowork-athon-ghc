/**
 * ADR 0010 — GenericChildSupervisor lifecycle + negative-path tests. Mirrors
 * `runtime-supervisor.test.ts`'s conventions for the OpenCode-specific supervisor, against a FAKE
 * child (no real Postgres/Neo4j/backend/llm-svc binary or socket touched).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenericChildSupervisor, type GenericStartSpec } from "../src/runtime/generic-child-supervisor.js";
import { readGenericRuntimeState } from "../src/runtime/generic-runtime-state.js";
import {
  GenericChildAlreadyStartedError,
  GenericChildHealthTimeoutError,
  GenericChildPortInUseError,
} from "../src/runtime/generic-supervisor-errors.js";
import {
  FakeGenericChild,
  recordingGenericSpawner,
  toggleReadinessProbe,
  neverReadyGenericProbe,
  fixedGenericTimesProbe,
  fixedGenericPortChecker,
} from "./generic-supervisor-fakes.js";

const ROLE = "m365kg-postgres";
const PPID_ROLE = "m365kg-stack-supervisor";
const HOST = "127.0.0.1";
const PORT = 55432;

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cghc-gensup-"));
}

function makeSpec(root: string, overrides: Partial<GenericStartSpec> = {}): GenericStartSpec {
  return {
    role: ROLE,
    ppidRole: PPID_ROLE,
    command: "C:\\m365kg\\postgres\\bin\\postgres.exe",
    args: ["-D", join(root, "pgdata")],
    cwd: root,
    env: {},
    host: HOST,
    port: PORT,
    ...overrides,
  };
}

test("start: identity captured, .runtime record written, isAlive true", async () => {
  const root = tempRoot();
  const child = new FakeGenericChild(9001);
  const { spawner, capture } = recordingGenericSpawner(child);
  const logs: string[] = [];
  const sup = new GenericChildSupervisor({
    root,
    readinessProbe: toggleReadinessProbe().probe,
    spawner,
    processTimesProbe: fixedGenericTimesProbe(),
    portChecker: fixedGenericPortChecker(true),
    log: (l) => logs.push(l),
    pollIntervalMs: 5,
  });

  try {
    const identity = await sup.start(makeSpec(root));
    assert.equal(capture.count, 1);
    assert.equal(identity.pid, 9001);
    assert.equal(identity.port, PORT);
    assert.equal(sup.isAlive(), true);

    const persisted = readGenericRuntimeState(root, ROLE);
    assert.ok(persisted, "expected a persisted .runtime record");
    assert.equal(persisted?.pid, 9001);
    assert.ok(logs.some((l) => l.includes("child_ready")));
  } finally {
    await sup.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("stop: kills child, clears .runtime record, idempotent on double-stop", async () => {
  const root = tempRoot();
  const child = new FakeGenericChild(9002);
  const { spawner } = recordingGenericSpawner(child);
  const sup = new GenericChildSupervisor({
    root,
    readinessProbe: toggleReadinessProbe().probe,
    spawner,
    processTimesProbe: fixedGenericTimesProbe(),
    portChecker: fixedGenericPortChecker(true),
    pollIntervalMs: 5,
  });

  await sup.start(makeSpec(root));
  await sup.stop();
  assert.equal(sup.isAlive(), false);
  assert.equal(readGenericRuntimeState(root, ROLE), null);
  assert.equal(child.killed, true);

  await sup.stop(); // idempotent — must not throw
  rmSync(root, { recursive: true, force: true });
});

test("start: refuses a second start before stop()", async () => {
  const root = tempRoot();
  const child = new FakeGenericChild(9003);
  const { spawner } = recordingGenericSpawner(child);
  const sup = new GenericChildSupervisor({
    root,
    readinessProbe: toggleReadinessProbe().probe,
    spawner,
    processTimesProbe: fixedGenericTimesProbe(),
    portChecker: fixedGenericPortChecker(true),
    pollIntervalMs: 5,
  });

  await sup.start(makeSpec(root));
  await assert.rejects(() => sup.start(makeSpec(root)), GenericChildAlreadyStartedError);
  await sup.stop();
  rmSync(root, { recursive: true, force: true });
});

test("start: port already in use -> GenericChildPortInUseError, no .runtime record left", async () => {
  const root = tempRoot();
  const child = new FakeGenericChild(9004);
  const { spawner } = recordingGenericSpawner(child);
  const sup = new GenericChildSupervisor({
    root,
    readinessProbe: toggleReadinessProbe().probe,
    spawner,
    processTimesProbe: fixedGenericTimesProbe(),
    portChecker: fixedGenericPortChecker(false),
    pollIntervalMs: 5,
  });

  await assert.rejects(() => sup.start(makeSpec(root)), GenericChildPortInUseError);
  assert.equal(readGenericRuntimeState(root, ROLE), null);
  rmSync(root, { recursive: true, force: true });
});

test("start: readiness never true -> GenericChildHealthTimeoutError, child killed on abort", async () => {
  const root = tempRoot();
  const child = new FakeGenericChild(9005);
  const { spawner } = recordingGenericSpawner(child);
  const sup = new GenericChildSupervisor({
    root,
    readinessProbe: neverReadyGenericProbe,
    spawner,
    processTimesProbe: fixedGenericTimesProbe(),
    portChecker: fixedGenericPortChecker(true),
    pollIntervalMs: 5,
  });

  await assert.rejects(
    () => sup.start(makeSpec(root, { readyTimeoutMs: 40 })),
    GenericChildHealthTimeoutError,
  );
  assert.equal(child.killed, true, "expected the never-ready child to be killed on abort");
  assert.equal(readGenericRuntimeState(root, ROLE), null);
  rmSync(root, { recursive: true, force: true });
});
