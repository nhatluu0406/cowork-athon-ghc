/**
 * Snapshot / reconnect resync seam (CGHC-014, S6).
 *
 * When a renderer's hop-2 stream drops and reconnects, it presents the last EV `seq` it
 * folded. The service is authoritative: it returns the folded {@link SessionView} snapshot
 * for the client to ADOPT WHOLESALE, plus the `seq` from which live events resume. Because
 * the client replaces its (possibly stale) view with the authoritative snapshot, a dropped
 * stream always converges — it can never be left showing a stale `waiting`/`completed`
 * state after a terminal it missed, nor a live `running` after the run actually finished.
 *
 * Convergence + idempotency guarantees:
 *  - `snapshot` is the current authoritative view; the client's own partial view is discarded.
 *  - `resumeSeq === snapshot.lastSeq`: subsequent live events (seq > lastSeq) apply cleanly;
 *    any re-sent event with `seq <= lastSeq` is dropped by the reducer (no duplicate terminal).
 *  - If the run already reached a terminal, the snapshot carries it — no terminal is lost.
 *
 * Pure and transport-agnostic: given a view + the client cursor, it computes the plan. The
 * HTTP endpoint (ev-stream-router) and the live stream (session-stream) both reuse it.
 */

import type { SessionView } from "./ev-reducer.js";

export interface ResyncResult {
  /** Authoritative snapshot the reconnecting client MUST adopt (replaces its local view). */
  readonly snapshot: SessionView;
  /** `seq` from which the client applies subsequent live EV events (== snapshot.lastSeq). */
  readonly resumeSeq: number;
  /**
   * True when the client's presented cursor diverged from the authoritative `lastSeq`
   * (behind after a drop, or impossibly ahead) — surfaced for audit/telemetry, not control
   * flow: the client always adopts the snapshot regardless.
   */
  readonly replaced: boolean;
}

/**
 * Plan a reconnect from the client's last-seen `seq` against the authoritative view.
 * A non-finite/negative cursor is treated as "no cursor" (full snapshot adoption).
 */
export function planResync(view: SessionView, clientLastSeq: number): ResyncResult {
  const cursor = Number.isFinite(clientLastSeq) && clientLastSeq >= 0 ? clientLastSeq : -1;
  return {
    snapshot: view,
    resumeSeq: view.lastSeq,
    replaced: cursor !== view.lastSeq,
  };
}
