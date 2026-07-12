/**
 * EV reducer / state machine (CGHC-012, S6 authoritative view).
 *
 * Folds the EV stream into ONE authoritative session view so a dropped stream + resync
 * (CGHC-014) has a correct state to return. Guarantees:
 *  - The session status is `completed` ONLY after a terminal EV with `state:"completed"`;
 *    it is derived exclusively via `sessionStatusForTerminal` (no invented tokens, EV7).
 *  - The FIRST terminal wins: once terminal, later events cannot flip the status back to
 *    `running` or overwrite the terminal state (a late `session.idle` after an error does
 *    not turn an errored run "completed").
 *  - Apply is idempotent + ordered by `seq`: events with `seq <= lastSeq` are ignored, so
 *    replaying a snapshot's tail on resync cannot double-count.
 */

import type {
  EvEvent,
  FileMutationOp,
  PlanTodo,
  SessionId,
  SessionStatus,
  StepStatus,
  TerminalState,
} from "@cowork-ghc/contracts";
import { sessionStatusForTerminal } from "@cowork-ghc/contracts";

export interface ToolCallView {
  readonly callId: string;
  readonly toolName: string;
  readonly status: StepStatus;
  readonly summary?: string;
}

export interface StepView {
  readonly stepId: string;
  readonly label: string;
  readonly status: StepStatus;
}

export interface FileMutationView {
  readonly operation: FileMutationOp;
  readonly path: string;
  readonly previousPath?: string;
}

export interface ErrorView {
  readonly message: string;
  readonly recovery?: string;
}

/** EV5 long-running progress currently in flight; `ratio` (0..1) absent ⇒ indeterminate. */
export interface ProgressView {
  readonly label: string;
  readonly ratio?: number;
}

/** The authoritative, service-owned view a resync returns (S6). */
export interface SessionView {
  readonly sessionId: SessionId;
  readonly status: SessionStatus;
  /** Set once a terminal EV has been folded; `null` while the run is live. */
  readonly terminal: TerminalState | null;
  /** Highest applied `seq` — the resync cursor (CGHC-014). */
  readonly lastSeq: number;
  readonly todos: readonly PlanTodo[];
  readonly steps: readonly StepView[];
  readonly toolCalls: readonly ToolCallView[];
  readonly fileMutations: readonly FileMutationView[];
  /** Concatenated S2 token deltas (assistant streaming text). */
  readonly text: string;
  readonly error: ErrorView | null;
  /**
   * EV5 — the newest long-running progress marker while the run is live. A newer progress
   * event REPLACES an older one; it is cleared on the terminal event (progress is irrelevant
   * once the run is over), so a terminal view never carries a stale in-progress bar.
   */
  readonly progress?: ProgressView;
}

/** A fresh, honest view: `idle`, nothing observed, no fabricated completion. */
export function initialSessionView(sessionId: SessionId): SessionView {
  return {
    sessionId,
    status: "idle",
    terminal: null,
    lastSeq: 0,
    todos: [],
    steps: [],
    toolCalls: [],
    fileMutations: [],
    text: "",
    error: null,
  };
}

/** Upsert a keyed item into a readonly list (last write wins on the key). */
function upsert<T>(list: readonly T[], item: T, keyOf: (value: T) => string): readonly T[] {
  const key = keyOf(item);
  const index = list.findIndex((value) => keyOf(value) === key);
  if (index === -1) return [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
}

/** While the run is live (not terminal), any activity marks it `running`. */
function liveStatus(view: SessionView): SessionStatus {
  return view.terminal ? view.status : "running";
}

function foldOne(view: SessionView, event: EvEvent): SessionView {
  // Defense in depth (CGHC-013 review MEDIUM-1): once a run is terminal it is OVER — no later
  // frame may append a tool call / file mutation / token, or surface a new error. Only a
  // terminal event is meaningful post-terminal ("first terminal wins", handled below). Every
  // direct reduceEv consumer (session task-registry, CGHC-014 streaming, CGHC-016 permission)
  // inherits this, so a late/out-of-order mutating frame can never show the UI a mutation that
  // "happened" after the run finished. Status truthfulness (S6/EV7) is thus enforced here too,
  // not only in the registry freeze gate.
  if (view.terminal !== null && event.kind !== "terminal") return view;
  switch (event.kind) {
    case "plan":
      return { ...view, status: liveStatus(view), todos: event.todos };
    case "step":
      return {
        ...view,
        status: liveStatus(view),
        steps: upsert(
          view.steps,
          { stepId: event.stepId, label: event.label, status: event.status },
          (s) => s.stepId,
        ),
      };
    case "tool_call":
      return {
        ...view,
        status: liveStatus(view),
        toolCalls: upsert(
          view.toolCalls,
          {
            callId: event.callId,
            toolName: event.toolName,
            status: event.status,
            ...(event.summary ? { summary: event.summary } : {}),
          },
          (c) => c.callId,
        ),
      };
    case "file_mutation":
      return {
        ...view,
        status: liveStatus(view),
        fileMutations: [
          ...view.fileMutations,
          {
            operation: event.operation,
            path: event.path,
            ...(event.previousPath ? { previousPath: event.previousPath } : {}),
          },
        ],
      };
    case "token":
      return { ...view, status: liveStatus(view), text: view.text + event.delta };
    case "progress":
      // EV5: surface the newest progress marker (label + optional ratio). A later progress
      // event replaces the older one; the terminal case below clears it.
      return {
        ...view,
        status: liveStatus(view),
        progress: {
          label: event.label,
          ...(typeof event.ratio === "number" ? { ratio: event.ratio } : {}),
        },
      };
    case "error":
      // An EV6 error does not itself end the run; it surfaces a recoverable failure and
      // keeps the run live until a real terminal arrives.
      return {
        ...view,
        status: liveStatus(view),
        error: {
          message: event.message,
          ...(event.recovery ? { recovery: event.recovery.kind } : {}),
        },
      };
    case "terminal":
      // First terminal wins; a later terminal cannot overwrite it (EV7 honesty).
      if (view.terminal) return view;
      // The run is over: drop any in-flight progress (omit the field, not `undefined`, under
      // exactOptionalPropertyTypes) so the terminal view never shows a stale in-progress bar.
      {
        const { progress: _cleared, ...rest } = view;
        return {
          ...rest,
          terminal: event.state,
          status: sessionStatusForTerminal(event.state),
        };
      }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * Apply one EV event. Out-of-order / already-seen events (`seq <= lastSeq`) are ignored;
 * otherwise `lastSeq` advances to the event's `seq`.
 */
export function reduceEv(view: SessionView, event: EvEvent): SessionView {
  if (event.seq <= view.lastSeq) return view;
  return { ...foldOne(view, event), lastSeq: event.seq };
}

/**
 * Fold a whole EV sequence into an authoritative view. Application is monotonic-forward:
 * each event advances `lastSeq`, and stale/duplicate events (`seq <= lastSeq`) are dropped
 * rather than reordered — feed events in emission order.
 */
export function foldEv(
  sessionId: SessionId,
  events: Iterable<EvEvent>,
): SessionView {
  let view = initialSessionView(sessionId);
  for (const event of events) view = reduceEv(view, event);
  return view;
}
