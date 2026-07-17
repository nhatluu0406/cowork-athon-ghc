/**
 * Session-denial adapter (CGHC-016, P3 "no strand").
 *
 * Bridges the permission gate's {@link SessionDenialSink} onto the CGHC-013 session
 * mechanism WITHOUT the gate depending on the session service directly (port/adapter at the
 * real seam). On a Deny the gate calls {@link SessionDenialSink.denySession}; this adapter
 * folds a `denied` {@link import("@cowork-ghc/contracts").TerminalEvent} into the session's
 * authoritative view, so the session reaches the honest terminal `denied` status and is not
 * left hanging in `waiting_approval`.
 *
 * It talks to a narrow {@link SessionDenialTarget} (the CGHC-013 `SessionService` /
 * `TaskRegistry` satisfy it structurally) so no wide dependency is pulled in. If the session
 * is already terminal, "first terminal wins" in the reducer makes this a no-op — a Deny after
 * a completed/cancelled run cannot rewrite history.
 */

import type { EvEvent, SessionId, TerminalEvent } from "@cowork-ghc/contracts";
import type { SessionDenialSink } from "./ports.js";

/** The minimal live-session surface the adapter needs (structurally met by the session layer). */
export interface SessionDenialTarget {
  /** Whether a live task exists for the session (nothing to drive if not). */
  has(sessionId: SessionId): boolean;
  /** Current authoritative view — used only for its `lastSeq` cursor. */
  view(sessionId: SessionId): { readonly lastSeq: number } | undefined;
  /** Apply a mapped EV event (the freeze/first-terminal-wins guarantees live here). */
  apply(sessionId: SessionId, event: EvEvent): unknown;
}

/**
 * Build a {@link SessionDenialSink} over a live-session target. Only drives a session that
 * is actually loaded; a Deny for an unknown/unloaded session is a safe no-op (the runtime
 * reply already unblocked the runtime; there is no in-process session view to terminate).
 */
export function createSessionDenialSink(target: SessionDenialTarget): SessionDenialSink {
  return {
    denySession(sessionId, requestId, at) {
      if (!target.has(sessionId)) return;
      const current = target.view(sessionId);
      const terminal: TerminalEvent = {
        sessionId,
        seq: (current?.lastSeq ?? 0) + 1,
        at,
        kind: "terminal",
        state: "denied",
        message: `Permission denied (request ${requestId}).`,
      };
      target.apply(sessionId, terminal);
    },
  };
}

/** A no-op denial sink for wiring where no session view is tracked (the runtime reply still fires). */
export function noopSessionDenialSink(): SessionDenialSink {
  return { denySession: () => {} };
}
