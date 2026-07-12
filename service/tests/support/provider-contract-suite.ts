/**
 * Parametric PROVIDER CONTRACT suite (CGHC-024 scaffold, testing.md "provider contract
 * tests"). One factory every provider adapter reuses so connect / auth-error /
 * configured-model / streaming / timeout / cancellation / rate-limit / provider-error-mapping
 * / secret-redaction are checked uniformly.
 *
 * Honest split:
 *  - Cases that can be checked against the EXISTING mapper / error-map / redaction contract
 *    run FOR REAL now (error taxonomy, timeout, rate-limit, auth mapping, configured model,
 *    secret redaction).
 *  - Cases that need a LIVE runtime handshake (connect, streaming, cancellation) are GATED on
 *    captured fixtures: they SKIP with the pin-gate reason until the frames are recorded
 *    post-token, then assert the REAL replayed EV stream. Nothing is faked green.
 *
 * NOT a `.test.ts` file itself (it registers no tests until invoked) — a per-adapter
 * `*.test.ts` calls {@link runProviderContractSuite}.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRef, ProviderError, ProviderId } from "@cowork-ghc/contracts";
import { redactEnvMapValues } from "@cowork-ghc/runtime";
import type { ProviderPort } from "../../src/provider/index.js";
import {
  captureGateStatus,
  replayCapturedFrames,
  type CaptureGateStatus,
} from "../../src/execution/fixtures/index.js";

export interface ProviderContractDeps {
  /** A provider port already configured for `providerId` (real mapError/model config). */
  readonly port: ProviderPort;
  readonly providerId: ProviderId;
  /** Label used to namespace the registered test names. */
  readonly label: string;
  /** A secret-free model ref to exercise configured-model selection. */
  readonly sampleModel: ModelRef;
  /** Env var the resolved key is injected under (for the redaction case). */
  readonly injectEnvVar: string;
  /** Captured scenario whose frames prove connect + streaming (e.g. "simple-chat"). */
  readonly streamingScenario: string;
  /** Captured scenario whose frames prove a real cancellation (e.g. "cancel"). */
  readonly cancelScenario: string;
}

/** Register one skip-or-run case bound to a captured scenario's pin gate. */
function gatedCase(
  name: string,
  status: CaptureGateStatus,
  body: (file: NonNullable<CaptureGateStatus["file"]>) => void,
): void {
  test(name, { skip: status.ready ? false : status.reason }, () => {
    assert.ok(status.file, "gate reported ready but carried no fixture");
    body(status.file);
  });
}

export function runProviderContractSuite(deps: ProviderContractDeps): void {
  const p = (name: string) => `[contract:${deps.label}] ${name}`;
  const streaming = captureGateStatus(deps.streamingScenario);
  const cancel = captureGateStatus(deps.cancelScenario);

  // ── REAL NOW: error taxonomy (PR7) ────────────────────────────────────────────────────
  test(p("auth-error → auth_invalid, not retryable"), () => {
    const err: ProviderError = deps.port.mapError({ status: 401 });
    assert.equal(err.kind, "auth_invalid");
    assert.equal(err.retryable, false);
  });

  test(p("rate-limit → rate_limited, retryable (bounded)"), () => {
    const err = deps.port.mapError({ status: 429 });
    assert.equal(err.kind, "rate_limited");
    assert.equal(err.retryable, true);
  });

  test(p("timeout → timeout (status 408 and AbortError both)"), () => {
    assert.equal(deps.port.mapError({ status: 408 }).kind, "timeout");
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    assert.equal(deps.port.mapError(abort).kind, "timeout");
  });

  test(p("provider-error-mapping covers 5xx/unknown"), () => {
    assert.equal(deps.port.mapError({ status: 503 }).kind, "unavailable");
    assert.equal(deps.port.mapError({ status: 418 }).kind, "unknown");
    assert.equal(deps.port.mapError("weird").kind, "unknown");
    // No secret ever leaks into a mapped message.
    assert.ok(!deps.port.mapError({ status: 401 }).message.includes("sk-"));
  });

  test(p("network-loss → unavailable, fetch-failed → unavailable, ETIMEDOUT → timeout"), () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN", "EPIPE"]) {
      const err = deps.port.mapError(Object.assign(new Error("socket down"), { code }));
      assert.equal(err.kind, "unavailable", `${code} should be unavailable`);
      assert.equal(err.retryable, true);
    }
    const fetchFailed = new TypeError("fetch failed");
    assert.equal(deps.port.mapError(fetchFailed).kind, "unavailable");
    const etimedout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    assert.equal(deps.port.mapError(etimedout).kind, "timeout");
  });

  test(p("each mapped error carries a non-empty recovery action"), () => {
    const raws: readonly unknown[] = [
      { status: 401 }, // auth
      { status: 429 }, // rate
      { status: 408 }, // timeout
      { status: 503 }, // unavailable
      Object.assign(new Error("x"), { code: "ECONNREFUSED" }), // network
      "weird", // unknown
    ];
    for (const raw of raws) {
      const err = deps.port.mapError(raw);
      assert.ok(err.recovery.length > 0, `recovery must be actionable for ${JSON.stringify(raw)}`);
      assert.ok(err.message.length > 0);
    }
  });

  // ── REAL NOW: configured-model selection (PR4/PR5) ────────────────────────────────────
  test(p("configured-model round-trips a secret-free model ref"), () => {
    deps.port.configureModel({ scope: "default", model: deps.sampleModel });
    const read = deps.port.modelSelection("default");
    assert.deepEqual(read, deps.sampleModel);
  });

  // ── REAL NOW: secret redaction (SEC-2) ────────────────────────────────────────────────
  test(p("secret-redaction masks the key VALUE in an env snapshot"), () => {
    const secret = "sk-super-secret-value-abc123";
    const snapshot = redactEnvMapValues(
      { [deps.injectEnvVar]: secret, PATH: "/usr/bin" },
      [secret],
    );
    assert.equal(snapshot[deps.injectEnvVar], "<redacted>");
    assert.equal(snapshot["PATH"], "/usr/bin");
    assert.ok(!Object.values(snapshot).includes(secret));
  });

  // ── GATED: connect + streaming (needs captured frames) ────────────────────────────────
  gatedCase(p("connect — a captured successful run proves a real connect"), streaming, (file) => {
    const { view } = replayCapturedFrames(file);
    // A captured run that reached a terminal implies the runtime connected + streamed.
    assert.ok(view.terminal !== null, "captured run should have a real terminal");
  });

  gatedCase(p("streaming — captured tokens flow to a completed run"), streaming, (file) => {
    const { view, events } = replayCapturedFrames(file);
    assert.ok(events.some((e) => e.kind === "token"), "expected real token EV events");
    assert.equal(view.terminal, "completed");
  });

  // ── GATED: cancellation (needs a captured cancel) ─────────────────────────────────────
  gatedCase(p("cancellation — a captured abort yields cancelled (not errored/completed)"), cancel, (file) => {
    const { view } = replayCapturedFrames(file);
    assert.equal(view.terminal, "cancelled");
    assert.notEqual(view.status, "completed");
  });
}
