/**
 * Renderer-facing resync endpoint for the two-hop EV stream (CGHC-014).
 *
 * `GET /v1/session/stream/snapshot?sessionId=…&sinceSeq=…` returns the AUTHORITATIVE folded
 * {@link SessionView} plus the `seq` from which the client resumes live events. A reconnecting
 * renderer adopts this snapshot wholesale, so a dropped stream converges to the server truth
 * (never a stale `waiting`/`completed`). It is token-guarded like every sensitive route (the
 * default fail-closed guard — NO `publicUnauthenticated`), mounted on the existing loopback
 * boundary via the standard {@link BoundaryRouter} seam; no CORS, no new transport.
 *
 * The live token stream itself (hop 2) is the transport-agnostic {@link createSessionStream}
 * core; wiring it to a long-lived SSE response is left as a thin seam for CGHC-015 once the
 * boundary dispatcher exposes a streaming response (see session-stream.ts). This endpoint
 * carries the snapshot/resume half over the existing request/response envelope today.
 */

import type { SessionId } from "@cowork-ghc/contracts";
import { EV_SNAPSHOT_PATH } from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { planResync, type SessionView } from "../execution/index.js";

// Path is centralized in `@cowork-ghc/contracts` (LOW-S5); re-exported so existing importers
// (service barrel, tests) keep the stable `EV_SNAPSHOT_PATH` name.
export { EV_SNAPSHOT_PATH };

/** The authoritative-view lookup seam; the session service's `view` satisfies it. */
export interface SnapshotSource {
  view(sessionId: SessionId): SessionView | undefined;
}

/** Payload of a successful snapshot lookup (client adopts `snapshot`, resumes at `resumeSeq`). */
export interface SessionSnapshotFound {
  readonly found: true;
  readonly sessionId: SessionId;
  readonly status: SessionView["status"];
  readonly lastSeq: number;
  readonly resumeSeq: number;
  /** True when the presented cursor diverged from authoritative `lastSeq` (audit signal). */
  readonly replaced: boolean;
  readonly snapshot: SessionView;
}

/** Payload when the session is not loaded (no fabricated view is ever returned). */
export interface SessionSnapshotMissing {
  readonly found: false;
  readonly sessionId: SessionId;
}

export type SessionSnapshotResult = SessionSnapshotFound | SessionSnapshotMissing;

/** Parse a non-negative integer query param, or `-1` (== "no cursor") when absent/invalid. */
function readCursor(raw: string | null): number {
  if (raw === null) return -1;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : -1;
}

function handleSnapshot(ctx: RouteContext, source: SnapshotSource): RouteResult<SessionSnapshotResult> {
  const sessionId = ctx.url.searchParams.get("sessionId");
  if (sessionId === null || sessionId.length === 0) {
    // A missing id is a client error; surface it as a typed not-found payload (envelope stays ok).
    return { status: 400, data: { found: false, sessionId: "" } };
  }
  const view = source.view(sessionId);
  if (view === undefined) {
    return { status: 404, data: { found: false, sessionId } };
  }
  const plan = planResync(view, readCursor(ctx.url.searchParams.get("sinceSeq")));
  return {
    status: 200,
    data: {
      found: true,
      sessionId,
      status: view.status,
      lastSeq: view.lastSeq,
      resumeSeq: plan.resumeSeq,
      replaced: plan.replaced,
      snapshot: plan.snapshot,
    },
  };
}

/** Build the token-guarded resync router bound to an authoritative-view source. */
export function createEvStreamRouter(source: SnapshotSource): BoundaryRouter {
  return {
    name: "ev-stream",
    routes: [
      {
        // Token-guarded by default (fail-closed): no `publicUnauthenticated`.
        method: "GET",
        path: EV_SNAPSHOT_PATH,
        handler: (ctx) => handleSnapshot(ctx, source),
      },
    ],
  };
}
