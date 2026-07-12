/**
 * Bounded readiness + exit waiting for the OpenCode supervisor (CGHC-028 Wave A1).
 *
 * Split from `supervisor.ts` to keep each file cohesive and small. Every wait here is BOUNDED
 * (health timeout, per-probe abort, graceful-stop timeout) so a stuck child can never hang the
 * caller, and a premature spawn error / early exit short-circuits the readiness loop into a
 * typed {@link RuntimeSpawnError} instead of waiting out the full timeout.
 */

import type { SupervisedChild } from "./child-spawner.js";
import type { HealthProbe, HealthReport } from "./probes.js";
import { RuntimeHealthTimeoutError, RuntimeSpawnError } from "./errors.js";

const PROBE_ABORT_MS = 2_000;

/** Map a raw spawn 'error' into a typed {@link RuntimeSpawnError} (ENOENT etc.). */
export function spawnErrorFrom(err: unknown): RuntimeSpawnError {
  const code = typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : undefined;
  const message =
    code === "ENOENT" ? "OpenCode binary not found (ENOENT)" : "OpenCode child failed to spawn";
  return new RuntimeSpawnError(message, code, { cause: err });
}

export interface AwaitReadyOptions {
  readonly child: SupervisedChild;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly healthProbe: HealthProbe;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pollIntervalMs: number;
}

/**
 * Poll `/global/health` until healthy, racing an early spawn error / premature exit. Resolves the
 * healthy report; throws {@link RuntimeSpawnError} (early failure) or {@link RuntimeHealthTimeoutError}.
 */
export async function awaitReady(options: AwaitReadyOptions): Promise<HealthReport> {
  const { child, baseUrl, timeoutMs, healthProbe, sleep, pollIntervalMs } = options;
  let earlyFailure: Error | null = null;
  const onError = (err: Error): void => {
    earlyFailure ??= spawnErrorFrom(err);
  };
  const onEarlyExit = (): void => {
    earlyFailure ??= new RuntimeSpawnError("OpenCode child exited before it became healthy");
  };
  child.once("error", onError);
  child.once("exit", onEarlyExit);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (earlyFailure) throw earlyFailure;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_ABORT_MS);
      let report: HealthReport | null;
      try {
        report = await healthProbe(baseUrl, controller.signal);
      } finally {
        clearTimeout(timer);
      }
      if (earlyFailure) throw earlyFailure;
      if (report !== null && report.healthy) return report;
      await sleep(pollIntervalMs);
    }
    throw new RuntimeHealthTimeoutError(timeoutMs);
  } finally {
    child.removeListener("error", onError);
    child.removeListener("exit", onEarlyExit);
  }
}

/** Resolve `true` when the child exits within `timeoutMs`, else `false`. */
export function waitForExit(child: SupervisedChild, timeoutMs: number): Promise<boolean> {
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
