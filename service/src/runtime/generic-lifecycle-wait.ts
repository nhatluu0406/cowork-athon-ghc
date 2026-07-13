/**
 * Bounded readiness + exit waiting for {@link GenericChildSupervisor} (ADR 0010). Same shape as
 * `lifecycle-wait.ts` (OpenCode-specific), generalized over a role label and a boolean
 * {@link ReadinessProbe} instead of a `/global/health` JSON probe — Postgres/Neo4j/llm-svc don't
 * speak that shape.
 */

import type { SupervisedChild } from "./child-spawner.js";
import type { ReadinessProbe } from "./generic-readiness.js";
import { GenericChildHealthTimeoutError, GenericChildSpawnError } from "./generic-supervisor-errors.js";

const PROBE_ABORT_MS = 2_000;

function spawnErrorFrom(role: string, err: unknown): GenericChildSpawnError {
  const code = typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : undefined;
  const message = code === "ENOENT" ? `"${role}" binary not found (ENOENT)` : `"${role}" child failed to spawn`;
  return new GenericChildSpawnError(role, message, code, { cause: err });
}

export interface AwaitGenericReadyOptions {
  readonly role: string;
  readonly child: SupervisedChild;
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly readinessProbe: ReadinessProbe;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pollIntervalMs: number;
}

/** Poll the readiness probe until it's true, racing an early spawn error / premature exit. */
export async function awaitGenericReady(options: AwaitGenericReadyOptions): Promise<void> {
  const { role, child, host, port, timeoutMs, readinessProbe, sleep, pollIntervalMs } = options;
  let earlyFailure: Error | null = null;
  const onError = (err: Error): void => {
    earlyFailure ??= spawnErrorFrom(role, err);
  };
  const onEarlyExit = (): void => {
    earlyFailure ??= new GenericChildSpawnError(role, `"${role}" child exited before it became ready`);
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
        ready = await readinessProbe(host, port, controller.signal);
      } finally {
        clearTimeout(timer);
      }
      if (earlyFailure) throw earlyFailure;
      if (ready) return;
      await sleep(pollIntervalMs);
    }
    throw new GenericChildHealthTimeoutError(role, timeoutMs);
  } finally {
    child.removeListener("error", onError);
    child.removeListener("exit", onEarlyExit);
  }
}

/** Resolve `true` when the child exits within `timeoutMs`, else `false`. */
export function waitForGenericExit(child: SupervisedChild, timeoutMs: number): Promise<boolean> {
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
