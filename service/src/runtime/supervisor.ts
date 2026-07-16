/**
 * OpencodeSupervisor — the ONE owner of the OpenCode child-process lifecycle (CGHC-028 Wave A1,
 * ADR 0004). It spawns the pinned binary, injects the provider credential at launch into the
 * CHILD ENV ONLY (never a file/log), waits for a real pinned-and-healthy `/global/health`, captures
 * OS identity, persists PID/port/identity under `.runtime/`, and stops gracefully-then-forcefully.
 *
 * This wave is the LIFECYCLE only; the HTTP data adapters (SessionStore / reply / connector) are
 * Wave A2 and consume {@link OpencodeSupervisor.baseUrl} + {@link OpencodeSupervisor.isAlive}.
 *
 * SECURITY: the resolved key value is obtained via the injected {@link ResolveInjections} seam
 * (which registers it with the shared scrubber) and flows ONLY into the child spawn env. It is
 * never written to `opencode.json`, the `.runtime/` record, or any log line (`redactedEnvSnapshot`).
 */

import { mkdirSync } from "node:fs";
import {
  assertPinnedVersion,
  buildLaunchSpec,
  redactedEnvSnapshot,
  type RuntimeProcessIdentity,
  captureIdentity,
} from "@cowork-ghc/runtime";
import type { RuntimeHealth } from "../session/seams.js";
import { nodeChildSpawner, type ChildSpawner, type SupervisedChild } from "./child-spawner.js";
import { fetchHealthProbe, netPortChecker, win32ProcessTimesProbe, type HealthProbe, type PortChecker, type ProcessTimesProbe } from "./probes.js";
import { writeOpencodeConfig } from "./opencode-config.js";
import { clearRuntimeState, writeRuntimeState } from "./runtime-state.js";
import { awaitReady, waitForExit } from "./lifecycle-wait.js";
import type { OpencodeSupervisorOptions, SupervisorStartSpec } from "./supervisor-types.js";
import {
  RuntimeAlreadyStartedError,
  RuntimeIdentityCaptureError,
  RuntimePortInUseError,
  RuntimeSpawnError,
} from "./errors.js";

export type { OpencodeSupervisorOptions, SupervisorStartSpec, ResolveInjections } from "./supervisor-types.js";

type State = "idle" | "starting" | "ready" | "stopping";
const DEFAULT_HEALTH_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_MS = 150;
const GRACEFUL_STOP_MS = 5_000;

const noop = (): void => {};

export class OpencodeSupervisor implements RuntimeHealth {
  private readonly opts: OpencodeSupervisorOptions;
  private readonly spawner: ChildSpawner;
  private readonly healthProbe: HealthProbe;
  private readonly processTimesProbe: ProcessTimesProbe;
  private readonly portChecker: PortChecker;
  private readonly log: (line: string) => void;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private state: State = "idle";
  private child: SupervisedChild | null = null;
  private childAlive = false;
  private lastHealthOk = false;
  private capturedIdentity: RuntimeProcessIdentity | null = null;
  private baseUrlValue: string | null = null;
  private readonly onChildExit = (): void => {
    this.childAlive = false;
  };

  constructor(options: OpencodeSupervisorOptions) {
    this.opts = options;
    this.spawner = options.spawner ?? nodeChildSpawner();
    this.healthProbe = options.healthProbe ?? fetchHealthProbe();
    this.processTimesProbe = options.processTimesProbe ?? win32ProcessTimesProbe();
    this.portChecker = options.portChecker ?? netPortChecker();
    this.log = options.log ?? noop;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** The loopback base URL of the running child, or `null` before ready / after stop. */
  get baseUrl(): string | null {
    return this.baseUrlValue;
  }

  /** The captured OS identity of the running child, or `null` before ready / after stop. */
  get identity(): RuntimeProcessIdentity | null {
    return this.capturedIdentity;
  }

  /** Honest liveness (S6): true only when the child is live AND the last probe succeeded. */
  isAlive(): boolean {
    return (
      this.state === "ready" &&
      this.childAlive &&
      this.lastHealthOk &&
      this.child !== null &&
      !this.child.killed
    );
  }

  /** Spawn + await readiness + persist identity. Refuses a second start without a stop(). */
  async start(spec: SupervisorStartSpec): Promise<RuntimeProcessIdentity> {
    if (this.state !== "idle") throw new RuntimeAlreadyStartedError();
    this.state = "starting";
    try {
      const injections = await this.opts.resolveInjections(spec.injectionRequests);
      const launch = buildLaunchSpec({
        binPath: spec.binPath,
        cwd: spec.cwd,
        port: spec.port,
        dataHome: spec.dataHome,
        configDir: spec.configDir,
        providerKeys: injections,
        ...(spec.host !== undefined ? { host: spec.host } : {}),
        ...(spec.baseEnv !== undefined ? { baseEnv: spec.baseEnv } : {}),
      });

      if (!(await this.portChecker(launch.host, launch.port))) {
        throw new RuntimePortInUseError(launch.host, launch.port);
      }

      // Create data/config dirs BEFORE spawn: OpenCode opens its SQLite store under XDG_DATA_HOME
      // on the first session write; a missing dir is the CGHC-024 opaque-500 bug.
      mkdirSync(launch.dataHome, { recursive: true });
      mkdirSync(launch.configDir, { recursive: true });

      // Always write a project config. Built-in providers still need Cowork's explicit file-edit
      // permission policy; relying on OpenCode defaults can silently bypass the product gate.
      const forbidden = spec.providerConfig
        ? injections.find((i) => i.envVar === spec.providerConfig?.envVar)?.value
        : undefined;
      const skillsConfig =
        spec.skillsPaths !== undefined || spec.skillAllow !== undefined
          ? {
              ...(spec.skillsPaths !== undefined ? { skillsPaths: spec.skillsPaths } : {}),
              ...(spec.skillAllow !== undefined ? { skillAllow: spec.skillAllow } : {}),
            }
          : undefined;
      writeOpencodeConfig(spec.configDir, spec.providerConfig, forbidden, skillsConfig);

      const child = this.spawner.spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
      });
      this.child = child;
      this.childAlive = true;
      child.on("exit", this.onChildExit);
      // Log-safe: only the redacted env snapshot ever leaves this module.
      this.log(`runtime_spawn port=${launch.port} env=${JSON.stringify(redactedEnvSnapshot(launch))}`);

      const baseUrl = `http://${launch.host}:${launch.port}`;
      const report = await awaitReady({
        child,
        baseUrl,
        timeoutMs: spec.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
        healthProbe: this.healthProbe,
        sleep: this.sleep,
        pollIntervalMs: this.pollIntervalMs,
      });
      assertPinnedVersion(report.version); // pin gate: fail closed on an unexpected binary.

      const pid = child.pid;
      if (pid === undefined) throw new RuntimeSpawnError("OpenCode child has no pid after spawn");
      const times = await this.processTimesProbe(pid);
      if (times === null) throw new RuntimeIdentityCaptureError(pid);

      const identity = captureIdentity({
        pid,
        startTime: times.startTime,
        exePath: times.exePath.trim() || launch.command,
        port: launch.port,
        host: launch.host,
        runtimeVersion: report.version,
      });
      writeRuntimeState(this.opts.root, identity);

      this.capturedIdentity = identity;
      this.baseUrlValue = baseUrl;
      this.lastHealthOk = true;
      this.state = "ready";
      this.log(`runtime_ready pid=${identity.pid} port=${identity.port} version=${identity.runtimeVersion}`);
      return identity;
    } catch (err) {
      await this.abortStart();
      throw err;
    }
  }

  /** Graceful terminate → bounded wait → force. Clears the `.runtime/` record. Idempotent. */
  async stop(): Promise<void> {
    const child = this.child;
    if (child === null) {
      clearRuntimeState(this.opts.root);
      this.reset();
      return;
    }
    this.state = "stopping";
    try {
      if (!child.killed) {
        const exited = waitForExit(child, GRACEFUL_STOP_MS);
        child.kill(); // graceful attempt; the loopback cooperative shutdown is the reaper's job.
        const didExit = await exited;
        if (!didExit && !child.killed) child.kill("SIGKILL");
      }
    } finally {
      clearRuntimeState(this.opts.root);
      this.reset();
    }
  }

  /** Cleanup after a failed start: kill any spawned child, clear the record, return to idle. */
  private async abortStart(): Promise<void> {
    const child = this.child;
    if (child !== null && !child.killed) {
      const exited = waitForExit(child, GRACEFUL_STOP_MS);
      child.kill();
      if (!(await exited) && !child.killed) child.kill("SIGKILL");
    }
    clearRuntimeState(this.opts.root);
    this.reset();
  }

  private reset(): void {
    if (this.child !== null) this.child.removeListener("exit", this.onChildExit);
    this.child = null;
    this.childAlive = false;
    this.lastHealthOk = false;
    this.capturedIdentity = null;
    this.baseUrlValue = null;
    this.state = "idle";
  }
}
