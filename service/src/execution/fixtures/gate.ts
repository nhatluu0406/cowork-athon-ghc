/**
 * Pin/upgrade gate for captured-frame fixtures (CGHC-024, ADR 0001 pin gate).
 *
 * Ties every fixture to `OPENCODE_PIN`. The gate is the HONEST reporter the test harness
 * uses: it never returns "ready" for a missing OR pin-mismatched fixture. A test consumes
 * {@link captureGateStatus} and, when the state is not `ready`, SKIPS with `status.reason`
 * (node:test counts it as skipped, not passed) — so a not-yet-captured or stale scenario is
 * visibly needs-capture, never a fake green.
 *
 * The decision rule is split into a PURE {@link evaluateCaptureGate} (no I/O) so all three
 * outcomes can be unit-tested without writing files, while {@link captureGateStatus} wires it
 * to the on-disk loader.
 */

import {
  CAPTURE_PIN,
  REQUIRED_CAPTURE_SCENARIOS,
  requiredScenario,
  type RequiredScenario,
} from "./manifest.js";
import { readCapturedFrames, type CapturedFrameLoad } from "./loader.js";
import type { CapturedFrameFile } from "./schema.js";

/** The pin-gate outcome for one scenario. Only `ready` unlocks a real replay assertion. */
export type CaptureGateState = "ready" | "needs_capture" | "needs_recapture" | "unknown_scenario";

export interface CaptureGateStatus {
  readonly scenario: string;
  readonly state: CaptureGateState;
  /** True only when a valid, pin-matched fixture is present. */
  readonly ready: boolean;
  /** Human-readable reason (used verbatim as the node:test skip reason when not ready). */
  readonly reason: string;
  /** The pin the fixtures must match. */
  readonly expectedPin: string;
  /** The loaded fixture when (and only when) `ready` is true. */
  readonly file?: CapturedFrameFile;
  /** The manifest entry, when the scenario is known. */
  readonly required?: RequiredScenario;
}

/**
 * PURE gate decision: given a scenario and the result of trying to load its fixture, decide
 * ready / needs_capture / needs_recapture / unknown_scenario. No I/O.
 */
export function evaluateCaptureGate(scenario: string, load: CapturedFrameLoad): CaptureGateStatus {
  const required = requiredScenario(scenario);
  const base = { scenario, expectedPin: CAPTURE_PIN } as const;
  if (required === undefined) {
    return {
      ...base,
      state: "unknown_scenario",
      ready: false,
      reason: `"${scenario}" is not a required capture scenario (see fixtures/manifest.ts).`,
    };
  }
  if (!load.present) {
    return {
      ...base,
      required,
      state: "needs_capture",
      ready: false,
      reason:
        `NEEDS CAPTURE: no live fixture for "${scenario}" at OpenCode pin ${CAPTURE_PIN}. ` +
        `Run the opt-in capture tool after the product-owner token gate.`,
    };
  }
  const capturedPin = load.file.meta.opencodePin;
  if (capturedPin !== CAPTURE_PIN) {
    return {
      ...base,
      required,
      state: "needs_recapture",
      ready: false,
      reason:
        `NEEDS RE-CAPTURE: "${scenario}" was captured against ${capturedPin} but the pin is now ` +
        `${CAPTURE_PIN}. Re-capture the fixtures against the new pin (ADR 0001 upgrade gate).`,
    };
  }
  return {
    ...base,
    required,
    state: "ready",
    ready: true,
    reason: `Fixture "${scenario}" is present and matches pin ${CAPTURE_PIN}.`,
    file: load.file,
  };
}

/**
 * Report whether a scenario's captured fixture is present AND matches the current pin.
 * Never throws for "not captured": that is a first-class `needs_capture` result. A
 * present-but-corrupt fixture DOES throw (via the loader) — a broken fixture is a real bug.
 */
export function captureGateStatus(scenario: string): CaptureGateStatus {
  return evaluateCaptureGate(scenario, readCapturedFrames(scenario));
}

/** Gate status for every required scenario (review-visible capture backlog). */
export function captureGateReport(): readonly CaptureGateStatus[] {
  return REQUIRED_CAPTURE_SCENARIOS.map((scenario) => captureGateStatus(scenario.name));
}
