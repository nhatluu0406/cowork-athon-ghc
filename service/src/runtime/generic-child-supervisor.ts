/**
 * GenericChildSupervisor — a role-agnostic single-child-process supervisor (ADR 0010). Extracts
 * the REUSABLE skeleton of `OpencodeSupervisor` (spawn → port-check → await-ready → capture OS
 * identity → persist `.runtime/` record → graceful-then-force stop) so the M365KG stack's four
 * new roles (`m365kg-postgres`, `m365kg-neo4j`, `m365kg-backend`, `m365kg-llmsvc`) don't need
 * four near-copies of that class. `supervisor.ts` (OpenCode's own) is untouched — this is a new,
 * additive file built from the SAME already-exported primitives
 * (`ChildSpawner`/`PortChecker`/`ProcessTimesProbe`/`captureIdentity`).
 *
 * Unlike `OpencodeSupervisor`, there is no pin-gate (no expected/asserted version string) and no
 * provider-key injection — those are OpenCode-specific concerns. Readiness is a plain boolean
 * {@link ReadinessProbe} instead of a `/global/health` JSON probe, since Postgres/Neo4j/llm-svc
 * don't speak that shape.
 */

import { mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { captureIdentity, type RuntimeProcessIdentity } from "@cowork-ghc/runtime";
import { nodeChildSpawner, type ChildSpawner, type SupervisedChild } from "./child-spawner.js";
import { netPortChecker, win32ProcessTimesProbe, type PortChecker, type ProcessTimesProbe } from "./probes.js";
import type { ReadinessProbe } from "./generic-readiness.js";
import { awaitGenericReady, waitForGenericExit } from "./generic-lifecycle-wait.js";
import { clearGenericRuntimeState, writeGenericRuntimeState } from "./generic-runtime-state.js";
import {
  GenericChildAlreadyStartedError,
  GenericChildIdentityCaptureError,
  GenericChildPortInUseError,
} from "./generic-supervisor-errors.js";

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 200;
const GRACEFUL_STOP_MS = 5_000;

const noop = (): void => {};

/**
 * Force-kill a still-alive child AND its descendants (ADR 0004: plain `child.kill()` does not
 * kill descendant processes on Windows — relevant here because Neo4j's `neo4j.bat console` spawns
 * a `java.exe` child of its own; killing only the `.bat`'s process leaves the JVM running). On
 * Windows this shells out to `taskkill /PID <pid> /T /F` (ADR 0004's own prescribed fallback,
 * ahead of the still-open Win32 Job Object item); elsewhere `SIGKILL` already kills the group.
 */
function forceKillTree(pid: number, fallback: () => void): void {
  if (process.platform !== "win32") {
    fallback();
    return;
  }
  execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {
    /* best-effort: if taskkill itself fails (e.g. already dead), there is nothing left to kill */
  });
}

export interface GenericStartSpec {
  readonly role: string;
  readonly ppidRole: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Directories to create before spawn (e.g. data dirs the child expects to already exist). */
  readonly ensureDirs?: readonly string[];
  readonly env: Record<string, string>;
  readonly host: string;
  readonly port: number;
  readonly readyTimeoutMs?: number;
}

export interface GenericChildSupervisorOptions {
  readonly root: string;
  readonly readinessProbe: ReadinessProbe;
  readonly spawner?: ChildSpawner;
  readonly processTimesProbe?: ProcessTimesProbe;
  readonly portChecker?: PortChecker;
  readonly log?: (line: string) => void;
  readonly pollIntervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

type State = "idle" | "starting" | "ready" | "stopping";

export class GenericChildSupervisor {
  private readonly opts: GenericChildSupervisorOptions;
  private readonly spawner: ChildSpawner;
  private readonly processTimesProbe: ProcessTimesProbe;
  private readonly portChecker: PortChecker;
  private readonly log: (line: string) => void;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private state: State = "idle";
  private child: SupervisedChild | null = null;
  private childAlive = false;
  private capturedIdentity: RuntimeProcessIdentity | null = null;
  private role = "";
  private readonly onChildExit = (): void => {
    this.childAlive = false;
  };

  constructor(options: GenericChildSupervisorOptions) {
    this.opts = options;
    this.spawner = options.spawner ?? nodeChildSpawner();
    this.processTimesProbe = options.processTimesProbe ?? win32ProcessTimesProbe();
    this.portChecker = options.portChecker ?? netPortChecker();
    this.log = options.log ?? noop;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get identity(): RuntimeProcessIdentity | null {
    return this.capturedIdentity;
  }

  isAlive(): boolean {
    return this.state === "ready" && this.childAlive && this.child !== null && !this.child.killed;
  }

  async start(spec: GenericStartSpec): Promise<RuntimeProcessIdentity> {
    if (this.state !== "idle") throw new GenericChildAlreadyStartedError(spec.role);
    this.role = spec.role;
    this.state = "starting";
    try {
      if (!(await this.portChecker(spec.host, spec.port))) {
        throw new GenericChildPortInUseError(spec.role, spec.host, spec.port);
      }
      for (const dir of spec.ensureDirs ?? []) mkdirSync(dir, { recursive: true });

      const child = this.spawner.spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env });
      this.child = child;
      this.childAlive = true;
      child.on("exit", this.onChildExit);
      this.log(`child_spawn role=${spec.role} host=${spec.host} port=${spec.port}`);

      await awaitGenericReady({
        role: spec.role,
        child,
        host: spec.host,
        port: spec.port,
        timeoutMs: spec.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
        readinessProbe: this.opts.readinessProbe,
        sleep: this.sleep,
        pollIntervalMs: this.pollIntervalMs,
      });

      const pid = child.pid;
      if (pid === undefined) throw new GenericChildIdentityCaptureError(spec.role, -1);
      const times = await this.processTimesProbe(pid);
      if (times === null) throw new GenericChildIdentityCaptureError(spec.role, pid);

      const identity = captureIdentity({
        pid,
        startTime: times.startTime,
        exePath: times.exePath.trim() || spec.command,
        port: spec.port,
        host: spec.host,
        runtimeVersion: spec.role,
      });
      writeGenericRuntimeState(this.opts.root, spec.role, spec.ppidRole, identity);

      this.capturedIdentity = identity;
      this.state = "ready";
      this.log(`child_ready role=${spec.role} pid=${identity.pid} port=${identity.port}`);
      return identity;
    } catch (err) {
      await this.abortStart();
      throw err;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child === null) {
      clearGenericRuntimeState(this.opts.root, this.role);
      this.reset();
      return;
    }
    this.state = "stopping";
    try {
      if (!child.killed) {
        const exited = waitForGenericExit(child, GRACEFUL_STOP_MS);
        child.kill();
        const didExit = await exited;
        if (!didExit && !child.killed) {
          if (child.pid !== undefined) forceKillTree(child.pid, () => child.kill("SIGKILL"));
          else child.kill("SIGKILL");
        }
      }
    } finally {
      clearGenericRuntimeState(this.opts.root, this.role);
      this.reset();
    }
  }

  private async abortStart(): Promise<void> {
    const child = this.child;
    if (child !== null && !child.killed) {
      const exited = waitForGenericExit(child, GRACEFUL_STOP_MS);
      child.kill();
      if (!(await exited) && !child.killed) {
        if (child.pid !== undefined) forceKillTree(child.pid, () => child.kill("SIGKILL"));
        else child.kill("SIGKILL");
      }
    }
    clearGenericRuntimeState(this.opts.root, this.role);
    this.reset();
  }

  private reset(): void {
    if (this.child !== null) this.child.removeListener("exit", this.onChildExit);
    this.child = null;
    this.childAlive = false;
    this.capturedIdentity = null;
    this.state = "idle";
  }
}
