/**
 * Session contract types (S1–S6).
 *
 * Consumed by: CGHC-012/013/014/015 (session orchestration + EV timeline + resync).
 * Session status is the honest, service-authoritative state (S6) — the UI never
 * invents a `completed`/`waiting` status; it renders what the service reports.
 */

import type { ModelRef } from "./refs.js";
import type { TerminalState } from "./ev.js";
import type { WorkspaceId } from "./workspace.js";

/** Opaque identifier for a session. */
export type SessionId = string;

/**
 * Honest session status (S6). Runtime-checkable list; the type is derived from it.
 *
 * Vocabulary is deliberately aligned with `TerminalState` (ev.ts): every terminal
 * EV state — `completed` / `errored` / `cancelled` / `denied` — has an exact
 * `SessionStatus` counterpart, so a reducer can map a terminal event onto a status
 * without inventing tokens. `runtime_down` is distinct from `errored` so the UI can
 * offer a runtime-restart recovery instead of a task-level retry. This never shows a
 * fabricated "ready"/"completed" state (EV7).
 */
export const SESSION_STATUSES = [
  "idle",
  "running",
  "waiting_approval",
  "cancelled",
  "completed",
  "errored",
  "denied",
  "runtime_down",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * The single, exhaustive mapping from a terminal EV state to the session status a
 * reducer must set. `satisfies Record<TerminalState, SessionStatus>` is a
 * compile-time exhaustiveness guard: adding a `TerminalState` without a mapping (or
 * mapping to a non-`SessionStatus`) is a build error. Downstream (CGHC-012) must use
 * this rather than invent its own mapping.
 */
export const terminalStateToSessionStatus = {
  completed: "completed",
  errored: "errored",
  cancelled: "cancelled",
  denied: "denied",
} as const satisfies Record<TerminalState, SessionStatus>;

/** Resolve the session status for a terminal EV state (see the mapping above). */
export function sessionStatusForTerminal(state: TerminalState): SessionStatus {
  return terminalStateToSessionStatus[state];
}

/** Session metadata (light; the transcript/history lives in the runtime store). */
export interface SessionMeta {
  readonly id: SessionId;
  readonly title: string;
  readonly workspaceId: WorkspaceId;
  readonly status: SessionStatus;
  /** Effective model for this session (default or per-session override, PR4). */
  readonly model?: ModelRef;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Snapshot returned by the resync endpoint after a dropped stream (S6). It carries
 * the authoritative status plus the last applied EV sequence number so the client
 * can resume without rendering a stale `waiting`/`completed` state.
 */
export interface SessionSnapshot {
  readonly meta: SessionMeta;
  /** Sequence number of the last EV event the service has emitted for this session. */
  readonly lastSeq: number;
}
