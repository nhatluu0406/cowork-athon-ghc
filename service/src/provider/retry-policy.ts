/**
 * BOUNDED retry policy for the provider boundary (CGHC-020, testing.md "no infinite retry").
 *
 * A pure decision function: given a mapped {@link ProviderError} and the number of attempts
 * already spent, it answers whether to retry and, if so, a bounded backoff delay. There is a
 * HARD attempt cap — the loop can never spin forever regardless of what a provider reports.
 *
 * Design rules enforced here:
 *  - `error.retryable` is only a HINT. Even a "retryable" error stops at `maxAttempts`.
 *  - Non-retryable KINDS (`auth_invalid`, `unknown`) NEVER retry, defence-in-depth, even if a
 *    caller hands in an error object with `retryable: true`.
 *  - Backoff is exponential, CAPPED at `maxDelayMs`, and monotonic before the cap. Jitter is
 *    injected (`random`) so tests are deterministic; the default is jitter-free (`() => 0`).
 *
 * This function does not sleep and needs no clock — it returns the delay; the CALLER schedules
 * it. Keeping it pure is what makes the bound trivially testable.
 */

import type { ProviderError, ProviderErrorKind } from "@cowork-ghc/contracts";

/** Kinds that must never be retried, whatever the taxonomy hint says. */
const NON_RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  "auth_invalid",
  "unknown",
]);

export interface RetryPolicy {
  /** Hard cap on TOTAL attempts (the first try counts as attempt 1). Must be >= 1. */
  readonly maxAttempts: number;
  /** First backoff step in ms; each further retry doubles it up to `maxDelayMs`. */
  readonly baseDelayMs: number;
  /** Upper bound on any single backoff delay in ms. */
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
});

export interface RetryDecisionOptions {
  readonly policy?: RetryPolicy;
  /**
   * Injectable jitter source in `[0, 1)`; the fraction is added on top of the exponential step
   * (still capped at `maxDelayMs`). Defaults to `() => 0` for deterministic backoff.
   */
  readonly random?: () => number;
}

export interface RetryDecision {
  /** Whether the caller should retry. */
  readonly retry: boolean;
  /** Bounded backoff before the next attempt, in ms. `0` when `retry` is false. */
  readonly delayMs: number;
  /** Attempts spent so far (echoed for logging/telemetry). */
  readonly attempt: number;
  /** Non-secret reason the decision was made (safe to log). */
  readonly reason: string;
}

/**
 * Decide whether to retry after `attempt` failed attempts (1 = the first try just failed).
 * Pure and bounded: returns `retry:false` the moment the cap is reached or the kind/hint is
 * non-retryable.
 */
export function retryDecision(
  error: ProviderError,
  attempt: number,
  options: RetryDecisionOptions = {},
): RetryDecision {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const spent = Number.isInteger(attempt) && attempt >= 1 ? attempt : 1;

  if (NON_RETRYABLE_KINDS.has(error.kind)) {
    return { retry: false, delayMs: 0, attempt: spent, reason: `kind ${error.kind} is not retryable` };
  }
  if (!error.retryable) {
    return { retry: false, delayMs: 0, attempt: spent, reason: "error marked not retryable" };
  }
  if (spent >= policy.maxAttempts) {
    return { retry: false, delayMs: 0, attempt: spent, reason: `attempt cap ${policy.maxAttempts} reached` };
  }

  return {
    retry: true,
    delayMs: backoffMs(spent, policy, options.random ?? (() => 0)),
    attempt: spent,
    reason: `retry ${spent + 1}/${policy.maxAttempts}`,
  };
}

/** Exponential backoff for the `spent`-th failed attempt, capped and jittered. */
function backoffMs(spent: number, policy: RetryPolicy, random: () => number): number {
  const exponential = policy.baseDelayMs * 2 ** (spent - 1);
  const step = Math.min(exponential, policy.maxDelayMs);
  const jitter = Math.floor(clamp01(random()) * policy.baseDelayMs);
  return Math.min(step + jitter, policy.maxDelayMs);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value >= 1 ? 0.999_999 : value;
}
