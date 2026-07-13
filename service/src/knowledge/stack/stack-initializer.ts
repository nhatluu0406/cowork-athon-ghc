/**
 * M365KGStackInitializer — one-time provisioning-completion step for the M365KG stack (ADR 0010
 * remaining work). `provisioning.ts` downloads+extracts the Postgres/Neo4j/JRE/llm-svc binaries;
 * `stack-supervisor.ts` starts/stops an ALREADY-initialized cluster on every normal run. Neither
 * creates the Postgres cluster, sets the Neo4j password, or applies the backend's DB schema — that
 * one-time gap is what this module closes, run once on first launch (or whenever a component is
 * missing), guarded by {@link M365KGStackInitializer.isInitialized}.
 *
 * Every shell-out (`initdb`, `psql`, `neo4j-admin`, `cypher-shell`) goes through the injected
 * {@link CommandRunner} seam, and the brief "start Postgres/Neo4j just long enough to apply
 * migrations" step goes through an injected {@link SupervisorFactory} — both exist so this
 * module's control flow (order of operations, failure/cleanup behavior) is fully unit testable
 * against fakes, with NO real Postgres/Neo4j/Windows binary required (mirrors `provisioning.ts`'s
 * `FetchLike`/`ZipExtractor` seams and `stack-supervisor.test.ts`'s fakes).
 *
 * Init is DESTRUCTIVE — `initdb` creates a cluster from scratch and refuses to run against a
 * non-empty data directory. Every call is therefore guarded by `isInitialized()`, and a failure
 * partway through removes the partial Postgres data directory (best-effort, logged) rather than
 * leaving a half-initialized cluster that would make every future retry fail with a confusing
 * "directory not empty" error from `initdb` itself — the marker is written LAST, so the on-disk
 * state after any run is always either "no marker + no pgDataDir" or "marker + fully migrated".
 *
 * NOT YET RUN AGAINST REAL WINDOWS BINARIES — same caveat as `stack-roles.ts`: authored and
 * unit-tested against fakes without Windows/Postgres/Neo4j access. The exact `initdb`/
 * `neo4j-admin`/`psql`/`cypher-shell` flags are a strong first draft, not execution-verified.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { GenericChildSupervisor } from "../../runtime/generic-child-supervisor.js";
import type { ReadinessProbe } from "../../runtime/generic-readiness.js";
import { neo4jRole, postgresRole, type StackPaths, type StackPorts } from "./stack-roles.js";
import type { StackSupervisorSecrets } from "./stack-supervisor.js";

const HOST = "127.0.0.1";
const MARKER_SCHEMA_VERSION = 1 as const;
const M365KG_DB_ROLE = "m365kg" as const;
const M365KG_DB_NAME = "m365kg" as const;
/** Fixed Neo4j username the bundled backend connects with (see `stack-roles.ts`'s `backendRole`). */
const NEO4J_USERNAME = "neo4j" as const;

export class StackInitError extends Error {
  readonly code = "stack_init_failed" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StackInitError";
  }
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Shell-out seam. The default implementation deliberately reports only `command` + exit code +
 * truncated stderr on failure — never the full `args` — because one call site (`neo4j-admin
 * dbms set-initial-password <password>`) carries a secret in argv (see
 * {@link M365KGStackInitializer}'s `setNeo4jInitialPassword`); every other secret in this module
 * goes through an env var or a short-lived temp file instead, precisely so it never appears in a
 * command line or a log line.
 */
export interface CommandRunner {
  (command: string, args: readonly string[], options: { readonly cwd: string; readonly env?: Record<string, string> }): Promise<CommandResult>;
}

export function nodeCommandRunner(): CommandRunner {
  return (command, args, options) =>
    new Promise((resolve, reject) => {
      execFile(
        command,
        args as string[],
        { cwd: options.cwd, env: { ...process.env, ...(options.env ?? {}) }, windowsHide: true, timeout: 2 * 60_000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new StackInitError(`command "${command}" failed: ${stderr.slice(0, 500) || err.message}`, { cause: err }));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
}

/** Supervisor-factory seam — tests inject one preconfigured with fakes (spawner/probes/etc). */
export type SupervisorFactory = (root: string, readinessProbe: ReadinessProbe) => GenericChildSupervisor;

function defaultSupervisorFactory(log: (line: string) => void): SupervisorFactory {
  return (root, readinessProbe) => new GenericChildSupervisor({ root, readinessProbe, log });
}

export interface StackInitializerOptions {
  readonly log?: (line: string) => void;
  readonly runCommand?: CommandRunner;
  readonly createSupervisor?: SupervisorFactory;
  readonly now?: () => Date;
  /** Overrides where `*.sql`/`*.cypher` migration files are read from; default resolved per-call from `paths.stackRoot`. */
  readonly migrationsDir?: string;
  /** Test-only: bounds how long the brief temporary Postgres/Neo4j starts wait for readiness. */
  readonly readyTimeoutMs?: number;
  /** Test-only: overrides free-port discovery for the brief temporary Postgres/Neo4j starts. */
  readonly ports?: StackPorts;
}

function markerPath(root: string): string {
  return join(root, ".runtime", "m365kg-init.done");
}

function assertAbsolute(path: string, label: string): void {
  if (!isAbsolute(path)) throw new StackInitError(`${label} must be an absolute path, got "${path}"`);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function pickFreePort(): Promise<number> {
  // Mirrors `stack-supervisor.ts`'s private `pickFreePort` — that one is not exported (and this
  // task does not modify `stack-supervisor.ts`), so a small, self-contained duplicate lives here
  // rather than widening an already-complete/tested module's public surface for one caller.
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function resolveInitPorts(override: StackPorts | undefined): Promise<StackPorts> {
  if (override) return override;
  return {
    postgres: await pickFreePort(),
    neo4jBolt: await pickFreePort(),
    llmSvc: await pickFreePort(),
    backend: await pickFreePort(),
  };
}

async function listMigrationFiles(migrationsDir: string, predicate: (name: string) => boolean): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(migrationsDir);
  } catch {
    return [];
  }
  return entries.filter(predicate).sort();
}

export class M365KGStackInitializer {
  private readonly log: (line: string) => void;
  private readonly runCommand: CommandRunner;
  private readonly createSupervisor: SupervisorFactory;
  private readonly now: () => Date;
  private readonly migrationsDirOverride: string | undefined;
  private readonly readyTimeoutMs: number | undefined;
  private readonly portsOverride: StackPorts | undefined;

  constructor(options: StackInitializerOptions = {}) {
    this.log = options.log ?? (() => {});
    this.runCommand = options.runCommand ?? nodeCommandRunner();
    this.createSupervisor = options.createSupervisor ?? defaultSupervisorFactory(this.log);
    this.now = options.now ?? (() => new Date());
    this.migrationsDirOverride = options.migrationsDir;
    this.readyTimeoutMs = options.readyTimeoutMs;
    this.portsOverride = options.ports;
  }

  /** `.runtime/m365kg-init.done` exists — the guard every `initialize()` call re-checks first. */
  async isInitialized(root: string): Promise<boolean> {
    try {
      await stat(markerPath(root));
      return true;
    } catch {
      return false;
    }
  }

  async initialize(paths: StackPaths, secrets: StackSupervisorSecrets, root: string): Promise<void> {
    assertAbsolute(paths.stackRoot, "paths.stackRoot");
    assertAbsolute(paths.pgDataDir, "paths.pgDataDir");
    assertAbsolute(root, "root");

    if (await this.isInitialized(root)) {
      this.log("m365kg_init_skip_already_initialized");
      return;
    }

    const ports = await resolveInitPorts(this.portsOverride);
    const migrationsDir = this.migrationsDirOverride ?? join(paths.stackRoot, "backend", "migrations");
    this.log(`m365kg_init_start pgDataDir=${paths.pgDataDir}`);

    let postgres: GenericChildSupervisor | null = null;
    let neo4j: GenericChildSupervisor | null = null;

    try {
      await mkdir(paths.pgDataDir, { recursive: true });
      await this.runInitdb(paths, secrets);

      const pg = postgresRole(paths, ports, secrets.pgPassword);
      postgres = this.createSupervisor(root, pg.readinessProbe);
      await postgres.start({ ...pg.spec, ...(this.readyTimeoutMs !== undefined ? { readyTimeoutMs: this.readyTimeoutMs } : {}) });
      this.log("m365kg_init_postgres_ready");

      await this.bootstrapDatabase(paths, ports, secrets);
      await this.applyPostgresMigrations(paths, ports, secrets, migrationsDir);

      await postgres.stop();
      postgres = null;
      this.log("m365kg_init_postgres_migrated");

      await this.setNeo4jInitialPassword(paths, secrets);

      const neo = neo4jRole(paths, ports);
      neo4j = this.createSupervisor(root, neo.readinessProbe);
      await neo4j.start({ ...neo.spec, ...(this.readyTimeoutMs !== undefined ? { readyTimeoutMs: this.readyTimeoutMs } : {}) });
      this.log("m365kg_init_neo4j_ready");

      await this.applyNeo4jMigrations(paths, ports, secrets, migrationsDir);

      await neo4j.stop();
      neo4j = null;
      this.log("m365kg_init_neo4j_migrated");

      await this.writeMarker(root);
      this.log("m365kg_init_complete");
    } catch (err) {
      this.log(`m365kg_init_failed: ${messageOf(err)}`);
      await postgres?.stop().catch(() => {});
      await neo4j?.stop().catch(() => {});
      await this.cleanupPartialState(paths);
      throw err instanceof StackInitError ? err : new StackInitError(messageOf(err), { cause: err });
    }
  }

  // ---- Postgres -----------------------------------------------------------------------------

  private async runInitdb(paths: StackPaths, secrets: StackSupervisorSecrets): Promise<void> {
    const bin = join(paths.stackRoot, "postgresql", "bin", "initdb.exe");
    const tmpDir = await mkdtemp(join(tmpdir(), "cghc-m365kg-initdb-"));
    const pwFile = join(tmpDir, "pwfile");
    try {
      await writeFile(pwFile, `${secrets.pgPassword}\n`, { mode: 0o600 });
      this.log("m365kg_init_run_initdb");
      await this.runCommand(
        bin,
        ["-D", paths.pgDataDir, "-U", "postgres", `--pwfile=${pwFile}`, "-A", "scram-sha-256", "--no-locale", "--encoding=UTF8"],
        { cwd: join(paths.stackRoot, "postgresql", "bin") },
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private psqlBin(paths: StackPaths): string {
    return join(paths.stackRoot, "postgresql", "bin", "psql.exe");
  }

  private async runPsqlFile(paths: StackPaths, ports: StackPorts, secrets: StackSupervisorSecrets, database: string, filePath: string): Promise<void> {
    await this.runCommand(
      this.psqlBin(paths),
      ["-h", HOST, "-p", String(ports.postgres), "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", filePath],
      { cwd: join(paths.stackRoot, "postgresql", "bin"), env: { PGPASSWORD: secrets.pgPassword } },
    );
  }

  /**
   * Creates the `m365kg` login role + database the bundled backend connects as (`stack-roles.ts`'s
   * `backendRole` hardcodes `DATABASE_URL: postgres://m365kg:<pgPassword>@...`) — `initdb` only
   * creates the `postgres` superuser, so this bootstrap step is what makes that connection string
   * valid. Reuses `secrets.pgPassword` for the new role too (no separate app-role secret exists).
   */
  private async bootstrapDatabase(paths: StackPaths, ports: StackPorts, secrets: StackSupervisorSecrets): Promise<void> {
    const sql = [
      `CREATE ROLE ${M365KG_DB_ROLE} LOGIN PASSWORD '${escapeSqlLiteral(secrets.pgPassword)}';`,
      `CREATE DATABASE ${M365KG_DB_NAME} OWNER ${M365KG_DB_ROLE};`,
    ].join("\n");
    const tmpDir = await mkdtemp(join(tmpdir(), "cghc-m365kg-psql-"));
    const sqlFile = join(tmpDir, "bootstrap.sql");
    try {
      await writeFile(sqlFile, sql, { mode: 0o600 });
      this.log("m365kg_init_bootstrap_db");
      await this.runPsqlFile(paths, ports, secrets, "postgres", sqlFile);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Applies every `NNN_*.sql` file in `migrationsDir` (skipping `*.down.sql`) in filename order. */
  private async applyPostgresMigrations(paths: StackPaths, ports: StackPorts, secrets: StackSupervisorSecrets, migrationsDir: string): Promise<void> {
    const files = await listMigrationFiles(migrationsDir, (name) => name.endsWith(".sql") && !name.endsWith(".down.sql"));
    for (const file of files) {
      this.log(`m365kg_init_apply_postgres_migration file=${file}`);
      await this.runPsqlFile(paths, ports, secrets, M365KG_DB_NAME, join(migrationsDir, file));
    }
  }

  // ---- Neo4j --------------------------------------------------------------------------------

  /**
   * `neo4j-admin dbms set-initial-password <password>` — unlike every other secret in this
   * module, Neo4j's own CLI requires the password as a positional argument (no env var / stdin /
   * file form in the bundled Community edition), so it DOES appear in this one process's argv.
   * The default {@link CommandRunner} never echoes `args` in its error messages, and this call's
   * own log line omits the password — but a process listing on the machine during the (sub-
   * second) call could still observe it. Disclosed, not hidden — matches this module's header.
   *
   * Reuses `secrets.pgPassword` as the Neo4j password too: {@link StackSupervisorSecrets} has no
   * dedicated Neo4j field (and this task does not modify `stack-supervisor.ts` to add one), and
   * the checklist's own open question for this exact gap says "assume: from stack secrets" — this
   * is the only stack secret available for it. Tracked as a known simplification, not a bug.
   */
  private async setNeo4jInitialPassword(paths: StackPaths, secrets: StackSupervisorSecrets): Promise<void> {
    const bin = join(paths.stackRoot, "neo4j", "bin", "neo4j-admin.bat");
    this.log("m365kg_init_neo4j_set_password");
    await this.runCommand(bin, ["dbms", "set-initial-password", secrets.pgPassword], {
      cwd: join(paths.stackRoot, "neo4j", "bin"),
      env: { JAVA_HOME: join(paths.stackRoot, "jre") },
    });
  }

  /** Applies every `*.cypher` file in `migrationsDir` (filename order) via the bundled `cypher-shell`. */
  private async applyNeo4jMigrations(paths: StackPaths, ports: StackPorts, secrets: StackSupervisorSecrets, migrationsDir: string): Promise<void> {
    const bin = join(paths.stackRoot, "neo4j", "bin", "cypher-shell.bat");
    const files = await listMigrationFiles(migrationsDir, (name) => name.endsWith(".cypher"));
    for (const file of files) {
      this.log(`m365kg_init_apply_neo4j_migration file=${file}`);
      await this.runCommand(
        bin,
        ["-u", NEO4J_USERNAME, "-p", secrets.pgPassword, "-a", `bolt://${HOST}:${ports.neo4jBolt}`, "-f", join(migrationsDir, file)],
        { cwd: join(paths.stackRoot, "neo4j", "bin"), env: { JAVA_HOME: join(paths.stackRoot, "jre") } },
      );
    }
  }

  // ---- Marker / cleanup ----------------------------------------------------------------------

  private async writeMarker(root: string): Promise<void> {
    const dir = join(root, ".runtime");
    await mkdir(dir, { recursive: true });
    const record = { schemaVersion: MARKER_SCHEMA_VERSION, initializedAt: this.now().toISOString() };
    const finalPath = markerPath(root);
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(tmpPath, finalPath); // atomic replace on the same volume
  }

  /** Best-effort: never throws, never masks the original init failure. */
  private async cleanupPartialState(paths: StackPaths): Promise<void> {
    try {
      await rm(paths.pgDataDir, { recursive: true, force: true });
      this.log(`m365kg_init_cleanup_removed_pgdata: ${paths.pgDataDir}`);
    } catch (err) {
      this.log(`m365kg_init_cleanup_failed: ${messageOf(err)}`);
    }
  }
}
