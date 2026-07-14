/**
 * Shared fakes for the ADR 0010 GenericChildSupervisor tests. No real Postgres/Neo4j/backend/
 * llm-svc binary or socket is touched. Not a `*.test.ts` file, so the runner never executes it
 * directly.
 */

import { EventEmitter } from "node:events";
import type { ChildSpawner, SpawnChildOptions, SupervisedChild } from "../src/runtime/child-spawner.js";
import type { PortChecker, ProcessTimesProbe } from "../src/runtime/probes.js";
import type { ReadinessProbe } from "../src/runtime/generic-readiness.js";

export class FakeGenericChild implements SupervisedChild {
  private readonly emitter = new EventEmitter();
  killed = false;
  constructor(public readonly pid: number = 9001) {}

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.killed) return true;
    this.killed = true;
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
  emitError(err: unknown): void {
    this.emitter.emit("error", err);
  }
  emitExit(code = 0): void {
    this.emitter.emit("exit", code, null);
  }
}

export interface SpawnCapture {
  count: number;
  command?: string;
  args?: readonly string[];
  env?: Record<string, string>;
}

export function recordingGenericSpawner(child: SupervisedChild): { spawner: ChildSpawner; capture: SpawnCapture } {
  const capture: SpawnCapture = { count: 0 };
  const spawner: ChildSpawner = {
    spawn(command: string, args: readonly string[], options: SpawnChildOptions): SupervisedChild {
      capture.count += 1;
      capture.command = command;
      capture.args = args;
      capture.env = options.env;
      return child;
    },
  };
  return { spawner, capture };
}

export function toggleReadinessProbe(): { probe: ReadinessProbe; setReady(v: boolean): void } {
  let ready = true;
  return {
    probe: async () => ready,
    setReady: (v) => {
      ready = v;
    },
  };
}

export const neverReadyGenericProbe: ReadinessProbe = async () => false;

export function fixedGenericTimesProbe(
  startTime = "2026-07-13T00:00:00.000Z",
  exePath = "C:\\m365kg\\postgres\\bin\\postgres.exe",
): ProcessTimesProbe {
  return async () => ({ startTime, exePath });
}

export function fixedGenericPortChecker(free: boolean): PortChecker {
  return async () => free;
}
