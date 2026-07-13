/**
 * ADR 0010 — M365KGStackSupervisor sequencing tests: Postgres/Neo4j/llm-svc start concurrently,
 * the backend starts only after all three are ready, stop happens in exact reverse order, and a
 * partial-start failure leaves no orphaned sibling running. All against fakes — no real binary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { M365KGStackSupervisor } from "../../src/knowledge/stack/stack-supervisor.js";
import type { ChildSpawner, SupervisedChild } from "../../src/runtime/child-spawner.js";
import { GenericChildAlreadyStartedError } from "../../src/runtime/generic-supervisor-errors.js";
import { FakeGenericChild, fixedGenericPortChecker, fixedGenericTimesProbe } from "../generic-supervisor-fakes.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cghc-stack-"));
}

function orderTrackingSpawner(order: string[]): ChildSpawner {
  let nextPid = 1;
  return {
    spawn(command: string): SupervisedChild {
      // The role name is baked into every launch spec's args/cwd; command path is enough to tag it.
      order.push(command);
      return new FakeGenericChild(nextPid++);
    },
  };
}

function ports() {
  return { postgres: 55001, neo4jBolt: 55002, llmSvc: 55003, backend: 55004 };
}

function paths(root: string) {
  return { stackRoot: join(root, "stack"), pgDataDir: join(root, "pgdata") };
}

test("start: postgres/neo4j/llm-svc spawn before backend; all 4 identities returned", async () => {
  const root = tempRoot();
  const order: string[] = [];
  const sup = new M365KGStackSupervisor({
    root,
    paths: paths(root),
    secrets: { pgPassword: "pw", jwtSecret: "jwt" },
    ports: ports(),
    supervisorOptionsOverride: {
      spawner: orderTrackingSpawner(order),
      readinessProbe: async () => true,
      processTimesProbe: fixedGenericTimesProbe(),
      portChecker: fixedGenericPortChecker(true),
      pollIntervalMs: 5,
    },
  });

  const identities = await sup.start();
  assert.ok(identities.postgres && identities.neo4j && identities.llmSvc && identities.backend);
  assert.equal(order.length, 4);
  const backendIndex = order.findIndex((c) => c.includes("m365-knowledge-graph.exe"));
  assert.equal(backendIndex, 3, "backend must be the LAST of the 4 to spawn");
  assert.equal(sup.isAlive(), true);

  await sup.stop();
  rmSync(root, { recursive: true, force: true });
});

test("stop: backend stops before the other three", async () => {
  const root = tempRoot();
  const stopOrder: string[] = [];
  let pidCounter = 1;
  const spawner: ChildSpawner = {
    spawn(command: string): SupervisedChild {
      const child = new FakeGenericChild(pidCounter++);
      const originalKill = child.kill.bind(child);
      child.kill = ((signal?: NodeJS.Signals | number) => {
        stopOrder.push(command);
        return originalKill(signal);
      }) as typeof child.kill;
      return child;
    },
  };
  const sup = new M365KGStackSupervisor({
    root,
    paths: paths(root),
    secrets: { pgPassword: "pw", jwtSecret: "jwt" },
    ports: ports(),
    supervisorOptionsOverride: {
      spawner,
      readinessProbe: async () => true,
      processTimesProbe: fixedGenericTimesProbe(),
      portChecker: fixedGenericPortChecker(true),
      pollIntervalMs: 5,
    },
  });

  await sup.start();
  await sup.stop();

  const backendStopIndex = stopOrder.findIndex((c) => c.includes("m365-knowledge-graph.exe"));
  assert.equal(backendStopIndex, 0, "backend must be the FIRST to be signalled on stop");
  rmSync(root, { recursive: true, force: true });
});

test("start: backend failure stops the 3 already-started siblings (no orphan)", async () => {
  const root = tempRoot();
  let callCount = 0;
  const spawner: ChildSpawner = {
    spawn(command: string): SupervisedChild {
      callCount += 1;
      return new FakeGenericChild(callCount);
    },
  };
  const sup = new M365KGStackSupervisor({
    root,
    paths: paths(root),
    secrets: { pgPassword: "pw", jwtSecret: "jwt" },
    ports: ports(),
    readyTimeoutMs: 40, // the 4th spawn (backend) never becomes ready -> must fail fast, not in 30s
    supervisorOptionsOverride: {
      spawner,
      readinessProbe: async () => callCount < 4,
      processTimesProbe: fixedGenericTimesProbe(),
      portChecker: fixedGenericPortChecker(true),
      pollIntervalMs: 5,
    },
  });

  await assert.rejects(() => sup.start());
  assert.equal(sup.isAlive(), false, "no partially-started sibling should be left alive");
  rmSync(root, { recursive: true, force: true });
});

test("start: refuses to be called on an already-live supervisor's role (defense in depth)", async () => {
  const root = tempRoot();
  const sup = new M365KGStackSupervisor({
    root,
    paths: paths(root),
    secrets: { pgPassword: "pw", jwtSecret: "jwt" },
    ports: ports(),
    supervisorOptionsOverride: {
      spawner: orderTrackingSpawner([]),
      readinessProbe: async () => true,
      processTimesProbe: fixedGenericTimesProbe(),
      portChecker: fixedGenericPortChecker(true),
      pollIntervalMs: 5,
    },
  });

  await sup.start();
  await assert.rejects(() => sup.start(), GenericChildAlreadyStartedError);
  await sup.stop();
  rmSync(root, { recursive: true, force: true });
});
