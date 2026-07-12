/**
 * Live EV stream client (CGHC-015) — the renderer-side transport seam.
 *
 * This is the ONLY place the renderer talks to the two-hop EV endpoints. It owns transport
 * + reducer folding so the view stays a pure render of {@link SessionView}:
 *  1. Fetch the AUTHORITATIVE snapshot (EV_SNAPSHOT_PATH), adopt it wholesale, and take its
 *     `resumeSeq` cursor — so a reconnect converges to server truth (never a stale view).
 *  2. Subscribe to the live SSE stream (EV_STREAM_PATH) from `sinceSeq = resumeSeq`, decode
 *     each EV frame, and fold it via {@link reduceEv} into the running view.
 *  3. Coalesce renders: many frames (esp. token deltas) collapse into ONE `onView` per tick
 *     via {@link scheduleFlush}, so token streaming never thrashes the DOM.
 *
 * Honest disconnect (CGHC-015 UX HIGH-1): if the stream ends BEFORE a terminal event and the
 * client did not intentionally `stop()`, that is a premature disconnect (service restart,
 * proxy idle cutoff, sleep, network EOF) — NOT a finished run. Rather than leave a dishonest
 * perpetual "running" with no signal, the client surfaces a scrubbed error into the view (so
 * the timeline renders it via the normal EV6 error+recovery surface) and exposes `reconnect()`
 * that re-runs the snapshot→`sinceSeq` path. An intentional `stop()`/abort surfaces no error.
 *
 * SSE transport is `fetch` + a `ReadableStream` reader (NOT `EventSource`): the boundary
 * token guard requires an `Authorization: Bearer <token>` header (see server `token.ts`),
 * which `EventSource` cannot set. The token is used ONLY in that header — it is never passed
 * to `onView`, written to the DOM, or logged.
 */
import { type SessionId } from "@cowork-ghc/contracts";
import { type SessionView } from "@cowork-ghc/service/execution";
export interface EvStreamDeps {
    readonly baseUrl: string;
    /** Per-launch client token — used only in the Authorization header; never rendered. */
    readonly clientToken: string;
    readonly sessionId: SessionId;
    /** Called with each folded, authoritative view (coalesced). */
    readonly onView: (view: SessionView) => void;
    /** Non-secret transport-failure message sink (e.g. to render an honest error). */
    readonly onError?: (message: string) => void;
    /** Injectable `fetch` (tests). Defaults to the global. */
    readonly fetchImpl?: typeof fetch;
    /** Injectable render coalescer (tests). Defaults to a `requestAnimationFrame`-aligned flush. */
    readonly scheduleFlush?: (flush: () => void) => void;
}
/** Handle to a running stream: `done` settles on end/abort; `stop` tears the socket down. */
export interface EvStreamHandle {
    readonly done: Promise<void>;
    /** Intentionally end the stream (no error surfaced). Disables future reconnects. */
    stop(): void;
    /** Re-run the snapshot→live path after a disconnect. No-op once `stop()` was called. */
    reconnect(): Promise<void>;
}
/**
 * Start the snapshot-then-live pipeline. Synchronous entry so the caller gets a handle it
 * can `stop()` immediately; all I/O runs on the returned `done` promise.
 */
export declare function startEvStream(deps: EvStreamDeps): EvStreamHandle;
//# sourceMappingURL=ev-stream-client.d.ts.map