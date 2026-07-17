/**
 * GenericChildSupervisor — the reusable one-child lifecycle owner for the bundled M365KG stack
 * (ADR 0010), the role-neutral sibling of the OpenCode-specific {@link OpencodeSupervisor}. It
 * spawns ONE child from an explicit {@link GenericStartSpec}, polls an injected
 * {@link ReadinessProbe} until the child is reachable (bounded by the spec's `readyTimeoutMs`),
 * captures its OS identity, and stops it gracefully-then-forcefully. `M365KGStackSupervisor`
 * composes four of these; `M365KGStackInitializer` uses one at a time for the migration bring-up.
 *
 * Every side-effecting dependency (spawn, readiness, OS process-times, port free-check) is an
 * injected seam so the stack tests drive the full spawn → ready → stop lifecycle against fakes,
 * with no real Postgres/Neo4j/backend binary. Mirrors `supervisor.ts` in structure: an
 * `idle→starting→ready→stopping` state machine, a bounded readiness poll that races an early
 * exit/spawn error, and a graceful `kill()` → bounded wait → `SIGKILL` stop.
 *
 * SECURITY: the child env carries plaintext secrets (e.g. `PGPASSWORD`, `JWT_SECRET`) ONLY in the
 * spawn env — never a file, never a log line. The identity record is secret-free.
 */

import { mkdirSync } from "node:fs";
import { captureIdentity, type RuntimeProcessIdentity } from "@cowork-ghc/runtime";
import { nodeChildSpawner, type ChildSpawner, type SupervisedChild } from "./child-spawner.js";
import { netPortChecker, win32ProcessTimesProbe, type PortChecker, type ProcessTimesProbe } from "./probes.js";
import type { ReadinessProbe, ReadinessTarget } from "./generic-readiness.js";
import {
  GenericChildAlreadyStartedError,
  GenericChildIdentityCaptureError,
  GenericChildPortInUseError,
  GenericChildReadinessTimeoutError,
  GenericChildSpawnError,
  genericSpawnErrorFrom,
} from "./generic-supervisor-errors.js";

/** The launch specification for one generic child. `stack-roles.ts` builds these per role. */
export interface GenericStartSpec {
  /** Role tag for identity/logs/errors (e.g. "m365kg-postgres"). */
  readonly role: string;
  /** Parent role that owns this child (e.g. "m365kg-stack-supervisor"). */
  readonly ppidRole: string;
  /** Absolute path to the child binary. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Loopback host the readiness probe + identity use. */
  readonly host: string;
  /** Loopback port the readiness probe + identity use. */
  readonly port: number;
  /** Dirs to create (recursive) before spawn — e.g. the Postgres data dir. */
  readonly ensureDirs?: readonly string[];
  /** Extra child env layered over the inherited environment (carries secrets; never logged). */
  readonly env?: Record<string, string>;
  /** Readiness bound; defaults to {@link DEFAULT_READY_TIMEOUT_MS}. */
  readonly readyTimeoutMs?: number;
}

/** Constructor options. Only `root` + `readinessProbe` are always supplied; the rest default. */
export interface GenericChildSupervisorOptions {
  /** Project/runtime root (reserved for parity with the OpenCode supervisor; not persisted here). */
  readonly root: string;
  readonly readinessProbe: ReadinessProbe;
  readonly log?: (line: string) => void;
  readonly spawner?: ChildSpawner;
  readonly processTimesProbe?: ProcessTimesProbe;
  readonly portChecker?: PortChecker;
  readonly pollIntervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

type State = "idle" | "starting" | "ready" | "stopping";
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 150;
const GRACEFUL_STOP_MS = 5_000;
const PROBE_ABORT_MS = 2_000;

const noop = (): void => {};

export class GenericChildSupervisor {
  private readonly root: string;
  private readonly readinessProbe: ReadinessProbe;
  private readonly spawner: ChildSpawner;
  private readonly processTimesProbe: ProcessTimesProbe;
  private readonly portChecker: PortChecker;
  private readonly log: (line: string) => void;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private state: State = "idle";
  private role = "generic-child";
  private child: SupervisedChild | null = null;
  private childAlive = false;
  private capturedIdentity: RuntimeProcessIdentity | null = null;
  private readonly onChildExit = (): void => {
    this.childAlive = false;
  };

  constructor(options: GenericChildSupervisorOptions) {
    this.root = options.root;
    this.readinessProbe = options.readinessProbe;
    this.spawner = options.spawner ?? nodeChildSpawner();
    this.processTimesProbe = options.processTimesProbe ?? win32ProcessTimesProbe();
    this.portChecker = options.portChecker ?? netPortChecker();
    this.log = options.log ?? noop;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** The captured OS identity of the running child, or `null` before ready / after stop. */
  get identity(): RuntimeProcessIdentity | null {
    return this.capturedIdentity;
  }

  /** Honest liveness: true only while a started child is live and un-killed. */
  isAlive(): boolean {
    return this.state === "ready" && this.childAlive && this.child !== null && !this.child.killed;
  }

  /** Spawn + await readiness + capture identity. Refuses a second start without a stop(). */
  async start(spec: GenericStartSpec): Promise<RuntimeProcessIdentity> {
    if (this.state !== "idle") throw new GenericChildAlreadyStartedError(spec.role);
    this.state = "starting";
    this.role = spec.role;
    try {
      for (const dir of spec.ensureDirs ?? []) mkdirSync(dir, { recursive: true });

      if (!(await this.portChecker(spec.host, spec.port))) {
        throw new GenericChildPortInUseError(spec.role, spec.host, spec.port);
      }

      const env = this.buildChildEnv(spec.env);
      const child = this.spawner.spawn(spec.command, [...spec.args], { cwd: spec.cwd, env });
      this.child = child;
      this.childAlive = true;
      child.on("exit", this.onChildExit);
      // Log-safe: role + port only; the secret-bearing env is never serialized.
      this.log(`generic_child_spawn role=${spec.role} port=${spec.port}`);

      await this.awaitReady(child, { host: spec.host, port: spec.port }, spec.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);

      const pid = child.pid;
      if (pid === undefined) throw new GenericChildSpawnError(spec.role, "child has no pid after spawn");
      const times = await this.processTimesProbe(pid);
      if (times === null) throw new GenericChildIdentityCaptureError(spec.role, pid);

      const identity = captureIdentity({
        pid,
        startTime: times.startTime,
        exePath: times.exePath.trim() || spec.command,
        port: spec.port,
        host: spec.host,
        // No health/version endpoint for these generic children; the role is the honest label.
        runtimeVersion: spec.role,
      });

      this.capturedIdentity = identity;
      this.state = "ready";
      this.log(`generic_child_ready role=${spec.role} pid=${identity.pid} port=${identity.port}`);
      return identity;
    } catch (err) {
      await this.abortStart();
      throw err;
    }
  }

  /** Graceful terminate → bounded wait → force. Idempotent; safe when never started. */
  async stop(): Promise<void> {
    const child = this.child;
    if (child === null) {
      this.reset();
      return;
    }
    this.state = "stopping";
    try {
      if (!child.killed) {
        const exited = waitForExit(child, GRACEFUL_STOP_MS);
        child.kill();
        const didExit = await exited;
        if (!didExit && !child.killed) child.kill("SIGKILL");
      }
    } finally {
      this.reset();
    }
  }

  /** Cleanup after a failed start: kill any spawned child, return to idle. */
  private async abortStart(): Promise<void> {
    const child = this.child;
    if (child !== null && !child.killed) {
      const exited = waitForExit(child, GRACEFUL_STOP_MS);
      child.kill();
      if (!(await exited) && !child.killed) child.kill("SIGKILL");
    }
    this.reset();
  }

  private reset(): void {
    if (this.child !== null) this.child.removeListener("exit", this.onChildExit);
    this.child = null;
    this.childAlive = false;
    this.capturedIdentity = null;
    this.state = "idle";
  }

  /** Inherit the parent env (string values only) then layer the spec's secret-bearing extras. */
  private buildChildEnv(extra: Record<string, string> | undefined): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value;
    }
    if (extra) Object.assign(env, extra);
    return env;
  }

  /**
   * Poll the readiness probe until it returns `true`, racing an early spawn error / premature
   * exit, bounded by `timeoutMs`. Throws {@link GenericChildSpawnError} (early failure) or
   * {@link GenericChildReadinessTimeoutError}.
   */
  private async awaitReady(child: SupervisedChild, target: ReadinessTarget, timeoutMs: number): Promise<void> {
    let earlyFailure: Error | null = null;
    const onError = (err: Error): void => {
      earlyFailure ??= genericSpawnErrorFrom(this.role, err);
    };
    const onEarlyExit = (): void => {
      earlyFailure ??= new GenericChildSpawnError(this.role, "child exited before it became ready");
    };
    child.once("error", onError);
    child.once("exit", onEarlyExit);
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        if (earlyFailure) throw earlyFailure;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROBE_ABORT_MS);
        let ready: boolean;
        try {
          ready = await this.readinessProbe(target, controller.signal);
        } catch {
          ready = false;
        } finally {
          clearTimeout(timer);
        }
        if (earlyFailure) throw earlyFailure;
        if (ready) return;
        await this.sleep(this.pollIntervalMs);
      }
      throw new GenericChildReadinessTimeoutError(this.role, timeoutMs);
    } finally {
      child.removeListener("error", onError);
      child.removeListener("exit", onEarlyExit);
    }
  }
}

/** Resolve `true` when the child exits within `timeoutMs`, else `false` (mirrors lifecycle-wait). */
function waitForExit(child: SupervisedChild, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (value: boolean): void => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(value);
    };
    const onExit = (): void => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    child.once("exit", onExit);
  });
}
