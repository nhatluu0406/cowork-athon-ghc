/**
 * EV event model — the load-bearing execution-visibility contract (EV1–EV7, S2/S6).
 *
 * Consumed by: CGHC-012 (EV contract + SSE mapping), CGHC-014/015 (EV timeline UI),
 * and the event reducer/state machine (testing.md). These are Cowork-GHC's own event
 * shapes; the service MAPS real OpenCode SSE frames onto them (ADR 0001/0003) and
 * never fabricates a terminal state (EV7).
 *
 * Alignment: the terminal-state set is fixed by design §11 / ADR 0003:95-98 / VS-05.
 */

import type { SessionId } from "./session.js";

/**
 * The terminal-state set that makes EV1–EV7 / S6 honest. A session is `completed`
 * only when a terminal EV event with `state: "completed"` is emitted (EV7).
 */
export type TerminalState = "completed" | "errored" | "cancelled" | "denied";

/** Runtime-checkable form of `TerminalState` (for the reducer/state machine). */
export const TERMINAL_STATES = ["completed", "errored", "cancelled", "denied"] as const;

/** Type guard: is a raw string one of the four terminal states? */
export function isTerminalState(value: string): value is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(value);
}

/** Status of a plan todo / step / tool call as it progresses (EV1/EV2/EV3). */
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "errored"
  | "cancelled";

/** File mutation operations surfaced honestly to the UI (EV4). */
export type FileMutationOp = "create" | "edit" | "delete" | "move";

/** Discriminant for every EV event kind. */
export type EvEventKind =
  | "plan"
  | "step"
  | "tool_call"
  | "file_mutation"
  | "token"
  | "progress"
  | "metrics"
  | "error"
  | "terminal";

/**
 * Per-turn runtime metrics (issue #4). Non-secret counts only — token COUNTS and cost, never
 * any prompt/response content or credential. Every field is optional because a provider may
 * report only a subset (e.g. total without a prompt/completion breakdown).
 */
export interface TurnMetrics {
  /** Prompt/input tokens. */
  readonly tokensInput?: number;
  /** Completion/output tokens. */
  readonly tokensOutput?: number;
  /** Total tokens (may include cache/reasoning depending on the provider). */
  readonly tokensTotal?: number;
  /** Reasoning tokens, when the provider reports them separately. */
  readonly tokensReasoning?: number;
  /**
   * Cached-context tokens (prompt-cache read + write) when the provider reports them. Most of a
   * turn's `tokensTotal` is usually this — the runtime's system prompt + tool schemas reused
   * across turns — so surfacing it explains why `tokensTotal` dwarfs `tokensInput`.
   */
  readonly tokensCache?: number;
  /** Estimated cost in USD, when the provider reports it. */
  readonly costUsd?: number;
}

/** A recovery action attached to an error so the UI can offer a next step (EV6). */
export interface RecoveryAction {
  readonly kind:
    | "retry"
    | "cancel"
    | "reconfigure_credential"
    | "switch_model"
    | "switch_provider"
    | "restart_runtime"
    | "none";
  /** Short, non-secret label for the action button. */
  readonly label: string;
}

/** Fields shared by every EV event. `seq` is monotonic per session (for resync). */
export interface EvBase {
  readonly sessionId: SessionId;
  readonly seq: number;
  /** ISO-8601 timestamp assigned at the service boundary. */
  readonly at: string;
}

/** A single todo in the plan/todo timeline (EV1). */
export interface PlanTodo {
  readonly id: string;
  readonly title: string;
  readonly status: StepStatus;
}

/** EV1 — plan / todo timeline. */
export interface PlanEvent extends EvBase {
  readonly kind: "plan";
  readonly todos: readonly PlanTodo[];
}

/** EV2 — per-step status transition. */
export interface StepEvent extends EvBase {
  readonly kind: "step";
  readonly stepId: string;
  readonly label: string;
  readonly status: StepStatus;
}

/** EV3 — a tool call the runtime makes (proxied, not synthesized). */
export interface ToolCallEvent extends EvBase {
  readonly kind: "tool_call";
  readonly callId: string;
  readonly toolName: string;
  readonly status: StepStatus;
  readonly summary?: string;
}

/** EV4 — a file mutation with its target path. */
export interface FileMutationEvent extends EvBase {
  readonly kind: "file_mutation";
  readonly operation: FileMutationOp;
  readonly path: string;
  /** Prior path for a `move`/rename operation. */
  readonly previousPath?: string;
}

/** S2 — a streaming token delta (coalesced/backpressured at the boundary). */
export interface TokenEvent extends EvBase {
  readonly kind: "token";
  readonly delta: string;
}

/** EV5 — long-running progress (SHOULD). */
export interface ProgressEvent extends EvBase {
  readonly kind: "progress";
  readonly label: string;
  /** 0..1 when a ratio is known; omitted for indeterminate progress. */
  readonly ratio?: number;
}

/** Per-turn runtime/token metrics, forwarded from the runtime's step-finish usage (issue #4). */
export interface MetricsEvent extends EvBase {
  readonly kind: "metrics";
  readonly metrics: TurnMetrics;
}

/** EV6 — an error carrying a recovery action. */
export interface ErrorEvent extends EvBase {
  readonly kind: "error";
  readonly message: string;
  readonly recovery?: RecoveryAction;
}

/** EV7 — the honest terminal marker; the only source of a `completed` view. */
export interface TerminalEvent extends EvBase {
  readonly kind: "terminal";
  readonly state: TerminalState;
  readonly message?: string;
}

/** The full EV event union carried over the two-hop SSE stream (runtime→service→UI). */
export type EvEvent =
  | PlanEvent
  | StepEvent
  | ToolCallEvent
  | FileMutationEvent
  | TokenEvent
  | ProgressEvent
  | MetricsEvent
  | ErrorEvent
  | TerminalEvent;
