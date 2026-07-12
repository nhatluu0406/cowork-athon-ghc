/**
 * MANIFEST of the RAW-frame scenarios that MUST be captured from a live pinned OpenCode
 * run before CGHC-024 is DONE (PR10). Each entry states what the replayed EV stream must
 * prove, so a captured fixture can be verified against a real contract rather than trusted.
 *
 * The pin binding lives in {@link CAPTURE_PIN}: fixtures captured against a different
 * OpenCode version are stale and MUST be re-captured (see `gate.ts`). Nothing here is a
 * frame — this is the shopping list the opt-in capture tool fills after the token gate.
 */

import type { EvEventKind, TerminalState } from "@cowork-ghc/contracts";
import { OPENCODE_PIN } from "@cowork-ghc/runtime";

/** The OpenCode pin captured fixtures are bound to (single source of truth = the runtime pin). */
export const CAPTURE_PIN = OPENCODE_PIN;

/** One required capture scenario + the contract its replayed EV stream must satisfy. */
export interface RequiredScenario {
  /** Fixture file base name (`<name>.ndjson`) and `CapturedMeta.scenario`. */
  readonly name: string;
  /** What the live run should do (guides the capture prompt). */
  readonly description: string;
  /** The prompt shape to drive the run (illustrative; the operator may refine it). */
  readonly promptHint: string;
  /** The terminal state the replayed view MUST end in (from a REAL terminal frame). */
  readonly expectedTerminal: TerminalState;
  /** EV kinds the replayed stream MUST contain (proves the mapping forwards real frames). */
  readonly mustEmit: readonly EvEventKind[];
}

/**
 * The scenarios required for an honest PR10. `simple-chat` and `tool-call` end `completed`
 * (real `session.idle`); `error` ends `errored` and `cancel` ends `cancelled` — proving the
 * "no fabricated completed" guarantee (EV7) holds against REAL frames, not just handcrafted
 * ones. Order is stable for review.
 */
export const REQUIRED_CAPTURE_SCENARIOS: readonly RequiredScenario[] = Object.freeze([
  {
    name: "simple-chat",
    description: "A plain prompt that streams assistant text and finishes normally.",
    promptHint: "Reply with a single short sentence.",
    expectedTerminal: "completed",
    mustEmit: ["token", "terminal"],
  },
  {
    name: "tool-call",
    description: "A prompt that makes the runtime call a file-writing tool and finish.",
    promptHint: "Create a file notes.txt containing the word hello, then stop.",
    expectedTerminal: "completed",
    mustEmit: ["tool_call", "file_mutation", "terminal"],
  },
  {
    name: "error",
    description: "A run that surfaces a real provider/runtime error (e.g. bad model/quota).",
    promptHint: "Drive a run against a model/condition that returns a provider error.",
    expectedTerminal: "errored",
    mustEmit: ["error", "terminal"],
  },
  {
    name: "cancel",
    description: "A run cancelled mid-flight (real MessageAbortedError → cancelled).",
    promptHint: "Start a longer run, then abort it before it finishes.",
    expectedTerminal: "cancelled",
    mustEmit: ["terminal"],
  },
]);

/** Look up a required scenario by name, or `undefined` when it is not a known scenario. */
export function requiredScenario(name: string): RequiredScenario | undefined {
  return REQUIRED_CAPTURE_SCENARIOS.find((scenario) => scenario.name === name);
}
