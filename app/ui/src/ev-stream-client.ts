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

import {
  BOUNDARY_PROTOCOL_VERSION,
  EV_SNAPSHOT_PATH,
  EV_STREAM_PATH,
  type EvEvent,
  type SessionId,
} from "@cowork-ghc/contracts";
import {
  decodeEvSseFrame,
  initialSessionView,
  reduceEv,
  sanitizeErrorMessage,
  type SessionView,
} from "@cowork-ghc/service/execution";

/** Honest, non-secret Vietnamese message shown when the stream drops before a terminal. */
const DISCONNECT_MESSAGE = "Mất kết nối luồng sự kiện.";

/**
 * Hard cap on the un-framed SSE receive buffer. EV frames are small and blank-line delimited;
 * if the buffer grows past this without a frame boundary the peer is misbehaving, so we stop
 * growing it unbounded (anti-DoS) and treat it as a disconnect instead (CGHC-015 LOW-S4).
 */
const MAX_SSE_BUFFER = 1_048_576;

/** Minimal shape of the envelope-wrapped snapshot payload the renderer consumes. */
interface SnapshotEnvelope {
  /** The shared protocol tag; a mismatch means a drifted wire contract we must refuse. */
  readonly protocol?: string;
  readonly ok: boolean;
  readonly data?: {
    readonly found: boolean;
    readonly resumeSeq?: number;
    readonly snapshot?: SessionView;
  };
  readonly error?: { readonly code: string; readonly message: string };
}

export interface EvStreamDeps {
  readonly baseUrl: string;
  /** Per-launch client token — used only in the Authorization header; never rendered. */
  readonly clientToken: string;
  readonly sessionId: SessionId;
  /** Called with each folded EV event (for activity timeline ordering). */
  readonly onEvent?: (event: EvEvent) => void;
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

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Default render coalescer: frame-align to `requestAnimationFrame` so a burst of frames across
 * many `reader.read()` chunks collapses to ≤1 render per frame (MEDIUM-5). Falls back to the
 * microtask queue, then a macrotask, in headless/no-rAF hosts. Tests inject a synchronous or
 * explicitly-async coalescer via {@link EvStreamDeps.scheduleFlush}.
 */
function defaultScheduleFlush(flush: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => flush());
  } else if (typeof queueMicrotask === "function") {
    queueMicrotask(flush);
  } else {
    setTimeout(flush, 0);
  }
}

/** Adopt the authoritative snapshot; returns the folded view + the live resume cursor. */
async function loadSnapshot(
  deps: EvStreamDeps,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ view: SessionView; sinceSeq: number }> {
  const url = `${deps.baseUrl.replace(/\/$/, "")}${EV_SNAPSHOT_PATH}?sessionId=${encodeURIComponent(deps.sessionId)}`;
  const response = await fetchImpl(url, { headers: authHeaders(deps.clientToken), signal });
  const envelope = (await response.json()) as SnapshotEnvelope;
  // GATE 2 drift guard (parity with the service client): refuse a wrong/drifted wire contract
  // rather than adopting a snapshot from an envelope whose protocol tag we do not recognize.
  // The throw propagates to the honest error/disconnect path — we never adopt a drifted snapshot
  // nor fabricate a ready/terminal state.
  if (envelope.protocol !== BOUNDARY_PROTOCOL_VERSION) {
    throw new Error(`Giao thức ranh giới không khớp (mong đợi ${BOUNDARY_PROTOCOL_VERSION}).`);
  }
  if (!envelope.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message ?? "Không lấy được ảnh chụp phiên.");
  }
  if (envelope.data.found && envelope.data.snapshot !== undefined) {
    return { view: envelope.data.snapshot, sinceSeq: envelope.data.resumeSeq ?? -1 };
  }
  return { view: initialSessionView(deps.sessionId), sinceSeq: -1 };
}

/**
 * Start the snapshot-then-live pipeline. Synchronous entry so the caller gets a handle it
 * can `stop()` immediately; all I/O runs on the returned `done` promise.
 */
export function startEvStream(deps: EvStreamDeps): EvStreamHandle {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const schedule = deps.scheduleFlush ?? defaultScheduleFlush;

  let view = initialSessionView(deps.sessionId);
  let flushScheduled = false;
  let controller = new AbortController();
  let stopped = false;

  const emit = (): void => {
    if (flushScheduled) return;
    flushScheduled = true;
    schedule(() => {
      flushScheduled = false;
      deps.onView(view);
    });
  };

  const apply = (event: EvEvent): void => {
    view = reduceEv(view, event);
    deps.onEvent?.(event);
    emit();
  };

  /** Inject an honest disconnect into the view so the timeline shows error + recovery. */
  const surfaceDisconnect = (): void => {
    view = { ...view, error: { message: DISCONNECT_MESSAGE, recovery: "retry" } };
    emit();
    deps.onError?.(DISCONNECT_MESSAGE);
  };

  async function consumeStream(sinceSeq: number): Promise<void> {
    const url =
      `${deps.baseUrl.replace(/\/$/, "")}${EV_STREAM_PATH}` +
      `?sessionId=${encodeURIComponent(deps.sessionId)}&sinceSeq=${sinceSeq}`;
    const response = await fetchImpl(url, { headers: authHeaders(deps.clientToken), signal: controller.signal });
    if (response.body === null) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // A stop()/abort must tear the read loop down even if the underlying stream ignores the
    // fetch signal: cancelling the reader resolves a pending read with `{done:true}`.
    const onAbort = (): void => void reader.cancel().catch(() => {});
    controller.signal.addEventListener("abort", onAbort, { once: true });
    let buffer = "";
    // SSE frames are separated by a blank line; buffer until a complete frame is available.
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > MAX_SSE_BUFFER) break; // no frame boundary in bounds → drop, disconnect
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = decodeEvSseFrame(block);
          if (event !== null) apply(event);
        }
        if (view.terminal !== null) break; // terminal is the honest final event
      }
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      // Release the locked reader/connection so it isn't left for GC (CGHC-015 LOW-1).
      await reader.cancel().catch(() => {});
    }
    // The loop ended without a terminal: if this was not an intentional stop(), it is a
    // premature disconnect — surface it honestly with a recovery affordance (HIGH-1).
    if (view.terminal === null && !stopped && !controller.signal.aborted) surfaceDisconnect();
  }

  async function run(): Promise<void> {
    controller = new AbortController();
    const snapshot = await loadSnapshot(deps, fetchImpl, controller.signal);
    view = snapshot.view;
    emit(); // adopt the authoritative view before the first live frame
    if (view.terminal !== null) return; // already finished: snapshot carried the terminal
    await consumeStream(snapshot.sinceSeq);
  }

  const settle = (running: Promise<void>): Promise<void> =>
    running.catch((error: unknown) => {
      if (stopped || controller.signal.aborted) return; // a stop() is not an error
      // Scrub before surfacing: a future error type carrying a raw message must not reach the
      // onError sink (and thus the DOM) unscrubbed (defense-in-depth, matching the stated contract).
      const message = error instanceof Error ? sanitizeErrorMessage(error.message) : DISCONNECT_MESSAGE;
      deps.onError?.(message);
    });

  return {
    done: settle(run()),
    stop: () => {
      stopped = true;
      controller.abort();
    },
    reconnect: () => (stopped ? Promise.resolve() : settle(run())),
  };
}
