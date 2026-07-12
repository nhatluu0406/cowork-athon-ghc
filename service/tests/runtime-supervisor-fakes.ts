/**
 * Shared fakes for the CGHC-028 supervisor tests. No real OpenCode binary, socket, or PowerShell
 * is touched: the ChildSpawner, health probe, process-times probe, and port checker are all faked.
 * Not a `*.test.ts` file, so the runner never executes it directly.
 */

import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import type {
  ChildSpawner,
  SpawnChildOptions,
  SupervisedChild,
} from "../src/runtime/child-spawner.js";
import type { HealthProbe, HealthReport, PortChecker, ProcessTimesProbe } from "../src/runtime/probes.js";
import type { ResolveInjections } from "../src/runtime/supervisor.js";
import type { ProviderKeyInjection } from "@cowork-ghc/runtime";

/** A controllable fake OpenCode child backed by a real EventEmitter. */
export class FakeChild implements SupervisedChild {
  private readonly emitter = new EventEmitter();
  killed = false;
  constructor(public readonly pid: number = 4321) {}

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.killed) return true;
    this.killed = true;
    // Model a process that exits shortly after a kill signal (graceful path resolves).
    setImmediate(() => this.emitter.emit("exit", 0, signal ?? null));
    return true;
  }
  once(event: "exit" | "error", listener: (...args: never[]) => void): void {
    this.emitter.once(event, listener as (...a: unknown[]) => void);
  }
  on(event: "exit" | "error", listener: (...args: never[]) => void): void {
    this.emitter.on(event, listener as (...a: unknown[]) => void);
  }
  removeListener(event: "exit" | "error", listener: (...args: never[]) => void): void {
    this.emitter.removeListener(event, listener as (...a: unknown[]) => void);
  }

  /** Test hook: emit a spawn error (e.g. ENOENT) once listeners are attached. */
  emitError(err: unknown): void {
    this.emitter.emit("error", err);
  }
  /** Test hook: emit a premature exit. */
  emitExit(code = 0): void {
    this.emitter.emit("exit", code, null);
  }
}

/** What a fake spawner captured about the one spawn call it saw. */
export interface SpawnCapture {
  count: number;
  command?: string;
  args?: readonly string[];
  env?: Record<string, string>;
  dataHomeExistedAtSpawn?: boolean;
  configDirExistedAtSpawn?: boolean;
}

/** A ChildSpawner that returns a preset child and records the spawn arguments/env + dir state. */
export function recordingSpawner(
  child: SupervisedChild,
  onSpawn?: (child: SupervisedChild) => void,
): { spawner: ChildSpawner; capture: SpawnCapture } {
  const capture: SpawnCapture = { count: 0 };
  const spawner: ChildSpawner = {
    spawn(command: string, args: readonly string[], options: SpawnChildOptions): SupervisedChild {
      capture.count += 1;
      capture.command = command;
      capture.args = args;
      capture.env = options.env;
      const dataHome = options.env["XDG_DATA_HOME"];
      const configDir = options.env["OPENCODE_CONFIG_DIR"];
      capture.dataHomeExistedAtSpawn = dataHome !== undefined && existsSync(dataHome);
      capture.configDirExistedAtSpawn = configDir !== undefined && existsSync(configDir);
      onSpawn?.(child);
      return child;
    },
  };
  return { spawner, capture };
}

/** A health probe that returns a fixed report once `ready` flips true (else `null`). */
export function toggleHealthProbe(version: string): {
  probe: HealthProbe;
  setReady(v: boolean): void;
} {
  let ready = true;
  const report: HealthReport = { healthy: true, version };
  return {
    probe: async () => (ready ? report : null),
    setReady: (v) => {
      ready = v;
    },
  };
}

/** A health probe that is never ready (drives the bounded timeout path). */
export const neverReadyProbe: HealthProbe = async () => null;

/** A health probe that reports an unexpected version (drives the pin gate). */
export function versionProbe(version: string): HealthProbe {
  return async () => ({ healthy: true, version });
}

/** A process-times probe that returns fixed identity data (no real Win32 query). */
export function fixedTimesProbe(
  startTime = "2026-07-11T00:00:00.000Z",
  exePath = "C:\\opencode\\opencode.exe",
): ProcessTimesProbe {
  return async () => ({ startTime, exePath });
}

/** A port checker with a fixed answer. */
export function fixedPortChecker(free: boolean): PortChecker {
  return async () => free;
}

/** A credential-resolve seam that returns preset injections and records the request count. */
export function fakeResolver(injections: readonly ProviderKeyInjection[]): {
  resolve: ResolveInjections;
  calls: number;
} {
  const state = { calls: 0 };
  const resolve: ResolveInjections = async () => {
    state.calls += 1;
    return injections;
  };
  return {
    resolve,
    get calls() {
      return state.calls;
    },
  };
}
