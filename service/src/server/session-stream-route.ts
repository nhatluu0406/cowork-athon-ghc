/**
 * Live EV SSE route (CGHC-015) — the long-lived streaming half carried forward from CGHC-014.
 *
 * `GET /v1/session/stream?sessionId=…&sinceSeq=…` is a token-guarded STREAMING route: after the
 * fail-closed token guard, the dispatcher hands the handler the {@link SseWriter} and it OWNS
 * the response — SSE headers, coalesced EV frames ({@link encodeEvSseFrame}), and periodic
 * heartbeats ({@link encodeSseHeartbeat}) until the run terminates or the client disconnects.
 * It is NEVER envelope-wrapped.
 *
 * Convergence contract (with the existing snapshot endpoint EV_SNAPSHOT_PATH):
 *  - `sinceSeq` is the client's resume cursor. Events with `seq <= sinceSeq` are dropped, so a
 *    reconnecting client that already adopted the authoritative snapshot never sees a duplicate
 *    (in particular the terminal is delivered exactly once — via the snapshot OR live, not both).
 *  - The reducer/coordinator freeze guarantees the terminal is the FINAL live event; on it the
 *    route closes the stream. If the run was already terminal at connect, the snapshot carries
 *    it and the route closes immediately (no fake keep-alive on a finished run).
 *  - Disconnect tears down the subscription + heartbeat via {@link SseWriter.onClose}.
 */

import type { EvEvent } from "@cowork-ghc/contracts";
import { EV_STREAM_PATH } from "@cowork-ghc/contracts";
import { encodeEvSseFrame, encodeSseHeartbeat } from "../execution/index.js";
import type {
  BoundaryRouter,
  RouteContext,
  SseWriter,
  StreamingRouteDefinition,
} from "../boundary/contract.js";
import type { SessionEventSource } from "./session-stream-hub.js";

// Path is centralized in `@cowork-ghc/contracts` (LOW-S5); re-exported so existing importers
// (service barrel, tests) keep the stable `EV_STREAM_PATH` name.
export { EV_STREAM_PATH };

/** Heartbeat interval; MUST stay well under the server idle-socket cutoff (120s). */
const DEFAULT_HEARTBEAT_MS = 15_000;

/** Injectable interval seam so tests need not wait real seconds for a heartbeat. */
export interface IntervalScheduler {
  set(handler: () => void, ms: number): () => void;
}

const realIntervals: IntervalScheduler = {
  set(handler, ms) {
    const id = setInterval(handler, ms);
    id.unref?.();
    return () => clearInterval(id);
  },
};

/** Parse a non-negative integer cursor, or `-1` ("no cursor" → deliver all live events). */
function readCursor(raw: string | null): number {
  if (raw === null) return -1;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : -1;
}

function handleStream(
  ctx: RouteContext,
  sse: SseWriter,
  source: SessionEventSource,
  intervals: IntervalScheduler,
  heartbeatMs: number,
): void {
  const sessionId = ctx.url.searchParams.get("sessionId");
  if (sessionId === null || sessionId.length === 0) {
    sse.fail(400, "bad_request", "sessionId is required.");
    return;
  }
  const view = source.view(sessionId);
  if (view === undefined) {
    // Never fabricate a stream for a session the service does not hold.
    sse.fail(404, "not_found", "Unknown session.");
    return;
  }

  const sinceSeq = readCursor(ctx.url.searchParams.get("sinceSeq"));
  sse.open();

  // Already finished: the client's snapshot carries the terminal; nothing more will come.
  if (view.terminal !== null) {
    sse.end();
    return;
  }

  const onEvent = (event: EvEvent): void => {
    // Resume-from-seq dedupe: skip anything the client already has from the snapshot tail.
    if (event.seq <= sinceSeq) return;
    sse.write(encodeEvSseFrame(event));
    // The terminal is the honest, final event — close the stream on it (delivered once, last).
    if (event.kind === "terminal") sse.end();
  };

  const subscription = source.subscribe(sessionId, onEvent);
  const stopHeartbeat = intervals.set(() => sse.write(encodeSseHeartbeat()), heartbeatMs);
  sse.onClose(() => {
    subscription?.close();
    stopHeartbeat();
  });
}

export interface SessionStreamRouterOptions {
  /** Override the heartbeat scheduler (tests) — defaults to `setInterval` (unref'd). */
  readonly intervals?: IntervalScheduler;
  /** Override the heartbeat interval (tests). */
  readonly heartbeatMs?: number;
}

/** Build the token-guarded live-stream router bound to a {@link SessionEventSource}. */
export function createSessionStreamRouter(
  source: SessionEventSource,
  options: SessionStreamRouterOptions = {},
): BoundaryRouter {
  const intervals = options.intervals ?? realIntervals;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const route: StreamingRouteDefinition = {
    // Token-guarded by default (fail-closed): no `publicUnauthenticated`.
    method: "GET",
    path: EV_STREAM_PATH,
    stream: (ctx, sse) => handleStream(ctx, sse, source, intervals, heartbeatMs),
  };
  return { name: "ev-stream-live", routes: [route] };
}
