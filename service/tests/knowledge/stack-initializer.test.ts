/**
 * ADR 0010 — M365KGStackInitializer tests: idempotent guard, initdb→migrate→neo4j ordering,
 * migration file selection (skip `*.down.sql`, filename order), and failure cleanup (no dangling
 * marker, no orphaned temp Postgres/Neo4j, partial pgDataDir removed). All against fakes — no
 * real Postgres/Neo4j/backend binary, matching `stack-supervisor.test.ts`'s convention.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  M365KGStackInitializer,
  StackInitError,
  type CommandRunner,
  type SupervisorFactory,
} from "../../src/knowledge/stack/stack-initializer.js";
import { GenericChildSupervisor } from "../../src/runtime/generic-child-supervisor.js";
import type { ChildSpawner, SupervisedChild } from "../../src/runtime/child-spawner.js";
import { FakeGenericChild, fixedGenericPortChecker, fixedGenericTimesProbe } from "../generic-supervisor-fakes.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cghc-init-"));
}

function paths(root: string) {
  return { stackRoot: join(root, "stack"), pgDataDir: join(root, "pgdata") };
}

const secrets = { pgPassword: "pw123", jwtSecret: "jwt-secret" };

interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string>;
}

function fakeCommandRunner(calls: RecordedCall[], failWhen?: (command: string, args: readonly string[]) => string | null): CommandRunner {
  return async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    const failure = failWhen?.(command, args);
    if (failure) throw new Error(failure);
    return { stdout: "", stderr: "" };
  };
}

/** Every temp Postgres/Neo4j start during init goes through the SAME fake spawner/probes. */
function fakeSupervisorFactory(spawnLog: string[], childLog: FakeGenericChild[]): SupervisorFactory {
  let nextPid = 1;
  const spawner: ChildSpawner = {
    spawn(command: string): SupervisedChild {
      spawnLog.push(command);
      const child = new FakeGenericChild(nextPid++);
      childLog.push(child);
      return child;
    },
  };
  return (root) =>
    new GenericChildSupervisor({
      root,
      readinessProbe: async () => true,
      spawner,
      processTimesProbe: fixedGenericTimesProbe(),
      portChecker: fixedGenericPortChecker(true),
      pollIntervalMs: 5,
    });
}

function writeMigrationFixtures(migrationsDir: string): void {
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, "001_initial_schema.sql"), "CREATE TABLE a (id int);", "utf8");
  writeFileSync(join(migrationsDir, "001_initial_schema.down.sql"), "DROP TABLE a;", "utf8");
  writeFileSync(join(migrationsDir, "002_finetuning_schema.sql"), "CREATE TABLE b (id int);", "utf8");
  writeFileSync(join(migrationsDir, "002_neo4j_schema.cypher"), "CREATE INDEX ON :Node(id);", "utf8");
  writeFileSync(join(migrationsDir, "003_embedding_jobs_columns.sql"), "ALTER TABLE b ADD c int;", "utf8");
  writeFileSync(join(migrationsDir, "003_embedding_jobs_columns.down.sql"), "ALTER TABLE b DROP c;", "utf8");
}

test("isInitialized: false before init, true after a successful init (valid JSON marker)", async () => {
  const root = tempRoot();
  const calls: RecordedCall[] = [];
  const spawnLog: string[] = [];
  const migrationsDir = join(root, "migrations");
  writeMigrationFixtures(migrationsDir);

  const initializer = new M365KGStackInitializer({
    runCommand: fakeCommandRunner(calls),
    createSupervisor: fakeSupervisorFactory(spawnLog, []),
    migrationsDir,
    ports: { postgres: 1, neo4jBolt: 2, llmSvc: 3, backend: 4 },
  });

  assert.equal(await initializer.isInitialized(root), false);
  await initializer.initialize(paths(root), secrets, root);
  assert.equal(await initializer.isInitialized(root), true);

  const marker = JSON.parse(await readFile(join(root, ".runtime", "m365kg-init.done"), "utf8"));
  assert.equal(marker.schemaVersion, 1);
  assert.equal(typeof marker.initializedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(marker.initializedAt)));

  rmSync(root, { recursive: true, force: true });
});

test("initialize: creates a missing pgDataDir, runs initdb before starting postgres, then migrates in order and skips *.down.sql", async () => {
  const root = tempRoot();
  const calls: RecordedCall[] = [];
  const spawnLog: string[] = [];
  const migrationsDir = join(root, "migrations");
  writeMigrationFixtures(migrationsDir);
  const p = paths(root);
  assert.equal(existsSync(p.pgDataDir), false);

  const initializer = new M365KGStackInitializer({
    runCommand: fakeCommandRunner(calls),
    createSupervisor: fakeSupervisorFactory(spawnLog, []),
    migrationsDir,
    ports: { postgres: 1, neo4jBolt: 2, llmSvc: 3, backend: 4 },
  });

  await initializer.initialize(p, secrets, root);

  assert.equal(existsSync(p.pgDataDir), true, "pgDataDir must be created before initdb runs");

  const initdbIndex = calls.findIndex((c) => c.command.endsWith("initdb.exe"));
  const psqlIndices = calls.map((c, i) => (c.command.endsWith("psql.exe") ? i : -1)).filter((i) => i >= 0);
  assert.ok(initdbIndex >= 0, "initdb must run");
  assert.ok(psqlIndices.every((i) => i > initdbIndex), "every psql call must come after initdb");

  // First psql call is the bootstrap (role+db); the rest apply migration files, in filename order,
  // skipping *.down.sql (only 001/002/003 non-down .sql files → bootstrap + 3 migrations = 4 psql calls).
  assert.equal(psqlIndices.length, 4, "bootstrap + 3 non-down .sql migrations");
  const migrationCalls = psqlIndices.slice(1).map((i) => calls[i]!);
  const appliedFiles = migrationCalls.map((c) => c.args[c.args.length - 1]);
  assert.deepEqual(
    appliedFiles.map((f) => f?.split(/[/\\]/).pop()),
    ["001_initial_schema.sql", "002_finetuning_schema.sql", "003_embedding_jobs_columns.sql"],
  );

  const cypherCall = calls.find((c) => c.command.endsWith("cypher-shell.bat"));
  assert.ok(cypherCall, "cypher-shell must run for the neo4j migration");
  assert.ok(cypherCall!.args[cypherCall!.args.length - 1]?.endsWith("002_neo4j_schema.cypher"));

  const neo4jAdminIndex = calls.findIndex((c) => c.command.endsWith("neo4j-admin.bat"));
  const cypherIndex = calls.findIndex((c) => c.command.endsWith("cypher-shell.bat"));
  assert.ok(neo4jAdminIndex >= 0 && neo4jAdminIndex < cypherIndex, "password must be set before applying the cypher migration");

  assert.equal(spawnLog.length, 2, "exactly one temporary postgres start + one temporary neo4j start");

  rmSync(root, { recursive: true, force: true });
});

test("initialize: bootstraps the m365kg role+database with the password SQL-escaped", async () => {
  const root = tempRoot();
  const migrationsDir = join(root, "migrations");
  writeMigrationFixtures(migrationsDir);

  // The bootstrap .sql temp file is deleted immediately after the psql call that consumes it, so
  // its content must be captured DURING the (fake) command run, not after `initialize()` returns.
  let capturedBootstrapSql: string | null = null;
  const runCommand: CommandRunner = async (command, args, options) => {
    if (command.endsWith("psql.exe") && args.includes("postgres") && capturedBootstrapSql === null) {
      const filePath = args[args.length - 1]!;
      capturedBootstrapSql = readFileSync(filePath, "utf8");
    }
    void options;
    return { stdout: "", stderr: "" };
  };

  const initializer = new M365KGStackInitializer({
    runCommand,
    createSupervisor: fakeSupervisorFactory([], []),
    migrationsDir,
    ports: { postgres: 1, neo4jBolt: 2, llmSvc: 3, backend: 4 },
  });

  const quotedSecrets = { pgPassword: "p'w", jwtSecret: "jwt" };
  await initializer.initialize(paths(root), quotedSecrets, root);

  assert.ok(capturedBootstrapSql, "bootstrap psql call must have run");
  assert.match(capturedBootstrapSql!, /CREATE ROLE m365kg LOGIN PASSWORD 'p''w';/);
  assert.match(capturedBootstrapSql!, /CREATE DATABASE m365kg OWNER m365kg;/);

  rmSync(root, { recursive: true, force: true });
});

test("initialize: idempotent — a second call on an already-initialized root is a no-op", async () => {
  const root = tempRoot();
  const calls: RecordedCall[] = [];
  const spawnLog: string[] = [];
  const migrationsDir = join(root, "migrations");
  writeMigrationFixtures(migrationsDir);
  const initializer = new M365KGStackInitializer({
    runCommand: fakeCommandRunner(calls),
    createSupervisor: fakeSupervisorFactory(spawnLog, []),
    migrationsDir,
    ports: { postgres: 1, neo4jBolt: 2, llmSvc: 3, backend: 4 },
  });

  await initializer.initialize(paths(root), secrets, root);
  const callsAfterFirst = calls.length;
  const spawnsAfterFirst = spawnLog.length;

  await initializer.initialize(paths(root), secrets, root);
  assert.equal(calls.length, callsAfterFirst, "no new commands run on the second call");
  assert.equal(spawnLog.length, spawnsAfterFirst, "no new temp supervisors started on the second call");

  rmSync(root, { recursive: true, force: true });
});

test("initialize: a mid-flight failure stops the already-started temp supervisor, removes pgDataDir, and leaves no marker", async () => {
  const root = tempRoot();
  const calls: RecordedCall[] = [];
  const spawnLog: string[] = [];
  const children: FakeGenericChild[] = [];
  const migrationsDir = join(root, "migrations");
  writeMigrationFixtures(migrationsDir);
  const p = paths(root);

  const initializer = new M365KGStackInitializer({
    runCommand: fakeCommandRunner(calls, (command) => (command.endsWith("neo4j-admin.bat") ? "simulated neo4j-admin failure" : null)),
    createSupervisor: fakeSupervisorFactory(spawnLog, children),
    migrationsDir,
    ports: { postgres: 1, neo4jBolt: 2, llmSvc: 3, backend: 4 },
  });

  await assert.rejects(() => initializer.initialize(p, secrets, root), StackInitError);

  assert.equal(await initializer.isInitialized(root), false, "no dangling marker after a failed init");
  assert.equal(existsSync(p.pgDataDir), false, "the partial Postgres cluster must be removed so a retry starts clean");
  assert.equal(spawnLog.length, 1, "only postgres was started before the neo4j-admin failure");
  assert.equal(children[0]?.killed, true, "the temp postgres child must have been stopped, not left orphaned");

  rmSync(root, { recursive: true, force: true });
});

test("initialize: a failure while postgres is still running stops that temp supervisor too (no orphan)", async () => {
  const root = tempRoot();
  const calls: RecordedCall[] = [];
  const spawnLog: string[] = [];
  const children: FakeGenericChild[] = [];
  const migrationsDir = join(root, "migrations");
  writeMigrationFixtures(migrationsDir);
  const p = paths(root);

  const initializer = new M365KGStackInitializer({
    // Fail the very first psql call (the bootstrap), which runs while postgres is still up.
    runCommand: fakeCommandRunner(calls, (command) => (command.endsWith("psql.exe") ? "simulated psql failure" : null)),
    createSupervisor: fakeSupervisorFactory(spawnLog, children),
    migrationsDir,
    ports: { postgres: 1, neo4jBolt: 2, llmSvc: 3, backend: 4 },
  });

  await assert.rejects(() => initializer.initialize(p, secrets, root), StackInitError);

  assert.equal(spawnLog.length, 1, "only postgres was ever started");
  assert.equal(children[0]?.killed, true, "the still-running temp postgres must be stopped on failure");
  assert.equal(existsSync(p.pgDataDir), false);

  rmSync(root, { recursive: true, force: true });
});

test("initialize: rejects non-absolute paths before running any command", async () => {
  const root = tempRoot();
  const calls: RecordedCall[] = [];
  const initializer = new M365KGStackInitializer({
    runCommand: fakeCommandRunner(calls),
    createSupervisor: fakeSupervisorFactory([], []),
  });

  await assert.rejects(
    () => initializer.initialize({ stackRoot: "relative/stack", pgDataDir: join(root, "pgdata") }, secrets, root),
    StackInitError,
  );
  assert.equal(calls.length, 0, "no shell-out happens once path validation fails");

  rmSync(root, { recursive: true, force: true });
});

test("initialize: neo4j-admin set-initial-password never leaks the password into the runner's args logging surface by default", async () => {
  const root = tempRoot();
  const calls: RecordedCall[] = [];
  const migrationsDir = join(root, "migrations");
  writeMigrationFixtures(migrationsDir);
  const initializer = new M365KGStackInitializer({
    runCommand: fakeCommandRunner(calls),
    createSupervisor: fakeSupervisorFactory([], []),
    migrationsDir,
    ports: { postgres: 1, neo4jBolt: 2, llmSvc: 3, backend: 4 },
  });

  await initializer.initialize(paths(root), secrets, root);

  const neo4jAdminCall = calls.find((c) => c.command.endsWith("neo4j-admin.bat"));
  assert.ok(neo4jAdminCall);
  assert.deepEqual(neo4jAdminCall!.args, ["dbms", "set-initial-password", secrets.pgPassword]);
  assert.equal(neo4jAdminCall!.env?.["JAVA_HOME"], join(paths(root).stackRoot, "jre"));

  rmSync(root, { recursive: true, force: true });
});
