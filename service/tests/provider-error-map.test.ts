/**
 * CGHC-020 (PR7) — provider error mapping, bounded retry, and secret non-leak.
 *
 * Proves the refined taxonomy is distinct + actionable, that the retry policy is HARD-bounded
 * (never loops past the cap and never retries a non-retryable kind), and — load-bearing for
 * security — that a raw error carrying a secret-shaped string never leaks any character into
 * the mapped {@link ProviderError} (message / recovery / serialized form).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProviderError, ProviderErrorKind } from "@cowork-ghc/contracts";
import {
  mapProviderError,
  retryDecision,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
} from "../src/provider/index.js";

// ── Mapping table (raw condition → kind) ──────────────────────────────────────────────────
const CASES: ReadonlyArray<{
  label: string;
  raw: unknown;
  kind: ProviderErrorKind;
  retryable: boolean;
  context?: { probe?: "auth" | "model" };
}> = [
  { label: "401", raw: { status: 401 }, kind: "auth_invalid", retryable: false },
  { label: "403", raw: { status: 403 }, kind: "auth_invalid", retryable: false },
  { label: "model probe 404", raw: { status: 404 }, kind: "model_invalid", retryable: false, context: { probe: "model" as const } },
  { label: "model probe 400", raw: { status: 400 }, kind: "model_invalid", retryable: false, context: { probe: "model" as const } },
  { label: "429", raw: { status: 429 }, kind: "rate_limited", retryable: true },
  { label: "408", raw: { status: 408 }, kind: "timeout", retryable: true },
  { label: "AbortError", raw: Object.assign(new Error("aborted"), { name: "AbortError" }), kind: "timeout", retryable: true },
  { label: "500", raw: { status: 500 }, kind: "unavailable", retryable: true },
  { label: "503", raw: { status: 503 }, kind: "unavailable", retryable: true },
  { label: "ECONNREFUSED", raw: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), kind: "unavailable", retryable: true },
  { label: "ENOTFOUND", raw: Object.assign(new Error("dns"), { code: "ENOTFOUND" }), kind: "unavailable", retryable: true },
  { label: "ECONNRESET", raw: Object.assign(new Error("reset"), { code: "ECONNRESET" }), kind: "unavailable", retryable: true },
  { label: "EAI_AGAIN", raw: Object.assign(new Error("dns-temp"), { code: "EAI_AGAIN" }), kind: "unavailable", retryable: true },
  { label: "EPIPE", raw: Object.assign(new Error("broken pipe"), { code: "EPIPE" }), kind: "unavailable", retryable: true },
  { label: "ENETUNREACH", raw: Object.assign(new Error("net unreachable"), { code: "ENETUNREACH" }), kind: "unavailable", retryable: true },
  { label: "EHOSTUNREACH", raw: Object.assign(new Error("host unreachable"), { code: "EHOSTUNREACH" }), kind: "unavailable", retryable: true },
  { label: "fetch failed", raw: new TypeError("fetch failed"), kind: "unavailable", retryable: true },
  { label: "fetch failed / cause ECONNREFUSED", raw: Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("c"), { code: "ECONNREFUSED" }) }), kind: "unavailable", retryable: true },
  { label: "fetch failed / cause ETIMEDOUT", raw: Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("c"), { code: "ETIMEDOUT" }) }), kind: "timeout", retryable: true },
  { label: "ETIMEDOUT", raw: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), kind: "timeout", retryable: true },
  { label: "unrecognized string", raw: "weird", kind: "unknown", retryable: false },
  { label: "418", raw: { status: 418 }, kind: "unknown", retryable: false },
  { label: "null", raw: null, kind: "unknown", retryable: false },
];

for (const c of CASES) {
  test(`[error-map] ${c.label} → ${c.kind}`, () => {
    const err = mapProviderError(c.raw, c.context);
    assert.equal(err.kind, c.kind);
    assert.equal(err.retryable, c.retryable);
    assert.ok(err.message.length > 0, "message present");
    assert.ok(err.recovery.length > 0, "recovery action present");
  });
}

test("[error-map] invalid-key / timeout / rate-limit / unavailable are four DISTINCT actionable errors", () => {
  const auth = mapProviderError({ status: 401 });
  const timeout = mapProviderError({ status: 408 });
  const rate = mapProviderError({ status: 429 });
  const unavailable = mapProviderError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
  const recoveries = new Set([auth.recovery, timeout.recovery, rate.recovery, unavailable.recovery]);
  assert.equal(recoveries.size, 4, "each category has a distinct recovery action");
  const kinds = new Set([auth.kind, timeout.kind, rate.kind, unavailable.kind]);
  assert.equal(kinds.size, 4, "each category maps to a distinct kind");
});

// ── Bounded retry ─────────────────────────────────────────────────────────────────────────
test("[retry] a retryable error STOPS at the attempt cap and never loops past it", () => {
  const policy: RetryPolicy = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1000 };
  const rateLimited = mapProviderError({ status: 429 });
  let attempt = 0;
  let iterations = 0;
  const HARD_LOOP_GUARD = 1000; // if the policy ever failed to bound, this would trip first
  while (true) {
    iterations += 1;
    assert.ok(iterations <= HARD_LOOP_GUARD, "policy failed to bound the retry loop");
    attempt += 1;
    const decision = retryDecision(rateLimited, attempt, { policy });
    if (!decision.retry) break;
  }
  assert.equal(attempt, policy.maxAttempts, "stopped exactly at the cap");
  assert.ok(iterations < HARD_LOOP_GUARD, "did not spin");
  // One past the cap still refuses.
  assert.equal(retryDecision(rateLimited, policy.maxAttempts + 5, { policy }).retry, false);
});

test("[retry] non-retryable kinds return retry=false immediately", () => {
  for (const raw of [{ status: 401 }, { status: 403 }, "weird"]) {
    const err = mapProviderError(raw);
    assert.equal(retryDecision(err, 1).retry, false, `${err.kind} must not retry`);
    assert.equal(retryDecision(err, 1).delayMs, 0);
  }
});

test("[retry] retryable=false is honoured even if a caller forces a retryable KIND", () => {
  // Defence-in-depth: hand in a rate_limited (retryable kind) but retryable:false flag.
  const forced: ProviderError = { kind: "rate_limited", message: "x", retryable: false, recovery: "y" };
  assert.equal(retryDecision(forced, 1).retry, false);
});

test("[retry] a NON-retryable kind refuses even when a caller forces retryable:true (isolates the kind guard)", () => {
  // This isolates the NON_RETRYABLE_KINDS guard from the retryable-flag guard: the flag is
  // forced true, so ONLY the kind check can produce retry=false. Deleting that guard fails here.
  for (const kind of ["auth_invalid", "model_invalid", "unknown"] as const) {
    const forced: ProviderError = { kind, message: "x", retryable: true, recovery: "y" };
    assert.equal(retryDecision(forced, 1).retry, false, `${kind} must never retry even if retryable:true`);
  }
});

test("[retry] backoff is bounded and monotonic with injected (zero) jitter", () => {
  const policy: RetryPolicy = { maxAttempts: 6, baseDelayMs: 100, maxDelayMs: 800 };
  const rate = mapProviderError({ status: 429 });
  const delays: number[] = [];
  for (let attempt = 1; attempt < policy.maxAttempts; attempt += 1) {
    const d = retryDecision(rate, attempt, { policy, random: () => 0 });
    assert.equal(d.retry, true);
    delays.push(d.delayMs);
  }
  // 100, 200, 400, 800, 800 — monotonic non-decreasing and never above the cap.
  for (let i = 1; i < delays.length; i += 1) {
    assert.ok(delays[i]! >= delays[i - 1]!, `delay ${i} not monotonic`);
    assert.ok(delays[i]! <= policy.maxDelayMs, `delay ${i} exceeds cap`);
  }
  assert.equal(delays[0], 100);
  assert.equal(delays[delays.length - 1], policy.maxDelayMs);
});

test("[retry] injected jitter is deterministic and stays under the cap", () => {
  const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 500 };
  const rate = mapProviderError({ status: 429 });
  const a = retryDecision(rate, 1, { policy, random: () => 0.5 });
  const b = retryDecision(rate, 1, { policy, random: () => 0.5 });
  assert.equal(a.delayMs, b.delayMs, "same jitter → same delay (deterministic)");
  assert.ok(a.delayMs <= policy.maxDelayMs);
});

test("[retry] default policy exposes a finite hard cap", () => {
  assert.ok(DEFAULT_RETRY_POLICY.maxAttempts >= 1 && Number.isFinite(DEFAULT_RETRY_POLICY.maxAttempts));
  assert.ok(DEFAULT_RETRY_POLICY.maxDelayMs >= DEFAULT_RETRY_POLICY.baseDelayMs);
});

// ── Secret non-leak (security co-signs this) ────────────────────────────────────────────────
test("[secret] a raw error carrying a secret-shaped string never leaks into the mapped error", () => {
  const SECRET = "sk-ant-SUPERSECRETKEY0123456789abcdef";
  const raws: readonly unknown[] = [
    Object.assign(new Error(`auth failed for ${SECRET}`), { status: 401 }),
    { status: 500, body: `{"error":"bad key ${SECRET}"}`, headers: { authorization: `Bearer ${SECRET}` } },
    Object.assign(new Error(`connect https://user:${SECRET}@host/v1 failed`), { code: "ECONNREFUSED" }),
    Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(SECRET), { code: "ENOTFOUND" }) }),
    { status: 429, message: SECRET, url: `https://api?key=${SECRET}` },
  ];
  for (const raw of raws) {
    const err = mapProviderError(raw);
    const serialized = JSON.stringify(err);
    assert.ok(!serialized.includes(SECRET), "serialized ProviderError leaked the secret");
    assert.ok(!err.message.includes(SECRET), "message leaked the secret");
    assert.ok(!err.recovery.includes(SECRET), "recovery leaked the secret");
    // And the URL fragment must not leak either.
    assert.ok(!serialized.includes("SUPERSECRETKEY"));
  }
});
