/**
 * Shared fakes for the M365KG stack tests (ADR 0010) — the generic-child analogue of
 * `runtime-supervisor-fakes.ts`. No real Postgres/Neo4j/backend/llm-svc binary, socket, or
 * PowerShell is touched: the child, the OS process-times probe, and the port checker are faked so
 * `GenericChildSupervisor`'s full spawn → ready → stop lifecycle runs against them. Not a
 * `*.test.ts` file, so the runner never executes it directly.
 */

import { EventEmitter } from "node:events";
import type { SupervisedChild } from "../src/runtime/child-spawner.js";
import type { PortChecker, ProcessTimesProbe } from "../src/runtime/probes.js";

/** A controllable fake generic child backed by a real EventEmitter. */
export class FakeGenericChild implements SupervisedChild {
  private readonly emitter = new EventEmitter();
  killed = false;
  constructor(public readonly pid: number) {}

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.killed) return true;
    this.killed = true;
    // Model a process that exits shortly after a kill signal so the graceful stop path resolves.
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

  /** Test hook: emit a spawn error (e.g. ENOENT). */
  emitError(err: unknown): void {
    this.emitter.emit("error", err);
  }
  /** Test hook: emit a premature exit before readiness. */
  emitExit(code = 0): void {
    this.emitter.emit("exit", code, null);
  }
}

/** A port checker with a fixed answer (tests always run against free loopback ports). */
export function fixedGenericPortChecker(free: boolean): PortChecker {
  return async () => free;
}

/** A process-times probe that returns fixed, valid identity data (no real Win32 query). */
export function fixedGenericTimesProbe(
  startTime = "2026-07-11T00:00:00.000Z",
  exePath = "C:\\m365kg\\bundled-child.exe",
): ProcessTimesProbe {
  return async () => ({ startTime, exePath });
}
