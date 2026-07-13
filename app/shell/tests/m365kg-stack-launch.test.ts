/**
 * ADR 0010 remaining work — M365KG stack launch orchestration. Covers the honest-degrade policy
 * this module exists for: `start()` NEVER rejects (a failure here must never crash the shell or
 * block the primary Cowork/OpenCode chat experience), it skips cleanly when the stack binaries
 * are not provisioned, and `stop()` always tears down whatever was actually started.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";

import { createM365KGStackLaunch } from "../src/service/m365kg-stack-launch.js";
import type { M365KGStackPaths } from "../src/service/m365kg-stack-paths.js";

function fakePaths(root: string): M365KGStackPaths {
  const stackRoot = join(root, "stack");
  return {
    stack: { stackRoot, pgDataDir: join(stackRoot, "pgdata") },
    stackRoot,
    migrationsDir: join(root, "migrations"),
    runtimeRoot: root,
  };
}

test("start(): skips cleanly (no throw) when the stack is not provisioned, and starts nothing", async () => {
  const logs: string[] = [];
  const launch = createM365KGStackLaunch({
    paths: fakePaths("/tmp/unused"),
    log: (line) => logs.push(line),
    isProvisioned: async () => false,
  });

  await launch.start();
  assert.ok(logs.some((l) => l.includes("skip_not_provisioned")));

  // stop() with nothing started must also be a safe no-op.
  await launch.stop();
});

test("start(): when provisioned, initializes once (if needed) then starts the supervisor; stop() stops it", async () => {
  const logs: string[] = [];
  let initializeCalls = 0;
  let isInitializedCalls = 0;
  let supervisorStartCalls = 0;
  let supervisorStopCalls = 0;

  const fakeInitializer = {
    isInitialized: async () => {
      isInitializedCalls += 1;
      return false;
    },
    initialize: async () => {
      initializeCalls += 1;
    },
  };
  const fakeSupervisor = {
    start: async () => {
      supervisorStartCalls += 1;
      return {} as never;
    },
    stop: async () => {
      supervisorStopCalls += 1;
    },
  };

  const launch = createM365KGStackLaunch({
    paths: fakePaths("/tmp/unused"),
    log: (line) => logs.push(line),
    isProvisioned: async () => true,
    loadSecrets: async () => ({ pgPassword: "pw", jwtSecret: "jwt" }),
    createInitializer: () => fakeInitializer as never,
    createSupervisor: () => fakeSupervisor as never,
  });

  await launch.start();
  assert.equal(isInitializedCalls, 1);
  assert.equal(initializeCalls, 1);
  assert.equal(supervisorStartCalls, 1);
  assert.ok(logs.includes("m365kg_stack_started"));

  await launch.stop();
  assert.equal(supervisorStopCalls, 1);
});

test("start(): skips initialize() when already initialized, but still starts the supervisor", async () => {
  let initializeCalls = 0;
  const fakeInitializer = { isInitialized: async () => true, initialize: async () => { initializeCalls += 1; } };
  let supervisorStartCalls = 0;
  const fakeSupervisor = { start: async () => { supervisorStartCalls += 1; }, stop: async () => {} };

  const launch = createM365KGStackLaunch({
    paths: fakePaths("/tmp/unused"),
    isProvisioned: async () => true,
    loadSecrets: async () => ({ pgPassword: "pw", jwtSecret: "jwt" }),
    createInitializer: () => fakeInitializer as never,
    createSupervisor: () => fakeSupervisor as never,
  });

  await launch.start();
  assert.equal(initializeCalls, 0);
  assert.equal(supervisorStartCalls, 1);
});

test("start(): a rejecting initialize() is caught and logged — start() itself never rejects", async () => {
  const logs: string[] = [];
  const fakeInitializer = {
    isInitialized: async () => false,
    initialize: async () => {
      throw new Error("simulated initdb failure");
    },
  };

  const launch = createM365KGStackLaunch({
    paths: fakePaths("/tmp/unused"),
    log: (line) => logs.push(line),
    isProvisioned: async () => true,
    loadSecrets: async () => ({ pgPassword: "pw", jwtSecret: "jwt" }),
    createInitializer: () => fakeInitializer as never,
    createSupervisor: () => ({ start: async () => {}, stop: async () => {} }) as never,
  });

  await assert.doesNotReject(() => launch.start());
  assert.ok(logs.some((l) => l.includes("m365kg_stack_start_failed")));
});

test("start(): concurrent calls share one in-flight attempt (no double-start)", async () => {
  let starts = 0;
  const fakeSupervisor = {
    start: async () => {
      starts += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    stop: async () => {},
  };
  const launch = createM365KGStackLaunch({
    paths: fakePaths("/tmp/unused"),
    isProvisioned: async () => true,
    loadSecrets: async () => ({ pgPassword: "pw", jwtSecret: "jwt" }),
    createInitializer: () => ({ isInitialized: async () => true, initialize: async () => {} }) as never,
    createSupervisor: () => fakeSupervisor as never,
  });

  await Promise.all([launch.start(), launch.start()]);
  assert.equal(starts, 1);
});

test("stop(): a rejecting supervisor.stop() is caught and logged, never thrown", async () => {
  const logs: string[] = [];
  const launch = createM365KGStackLaunch({
    paths: fakePaths("/tmp/unused"),
    log: (line) => logs.push(line),
    isProvisioned: async () => true,
    loadSecrets: async () => ({ pgPassword: "pw", jwtSecret: "jwt" }),
    createInitializer: () => ({ isInitialized: async () => true, initialize: async () => {} }) as never,
    createSupervisor: () =>
      ({
        start: async () => {},
        stop: async () => {
          throw new Error("simulated stop failure");
        },
      }) as never,
  });

  await launch.start();
  await assert.doesNotReject(() => launch.stop());
  assert.ok(logs.some((l) => l.includes("m365kg_stack_stop_error")));
});
