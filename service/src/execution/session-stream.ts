/**
 * Second hop of the two-hop SSE pipeline (CGHC-014): runtime frames → authoritative fold →
 * renderer stream, with coalescing, EV5 progress, and reconnect resync.
 *
 * Hop 1 (already built): a raw OpenCode `/event` frame → EV events via {@link createEvMapper}.
 * Hop 2 (this module): each mapped EV event is (a) folded into the authoritative view via the
 * injected `apply` seam (the session task-registry — the ONE source of truth), then (b) pushed
 * through the {@link createStreamCoordinator} so token spam is coalesced while state-changing
 * events flush promptly to the renderer `emit` sink. Apply-BEFORE-emit means the authoritative
 * snapshot is always at least as current as anything the renderer has seen, so a resync can
 * only ever move the client forward to (never behind) the server truth.
 *
 * Transport-agnostic on purpose: `emit` is any sink (SSE writer, in-proc observer, test
 * recorder), the scheduler is injected (deterministic virtual time), and nothing here touches
 * a socket — a thin endpoint wraps it. Keeps the event loop free: no blocking, no busy-wait.
 */

import type { EvEvent, ProgressEvent, SessionId } from "@cowork-ghc/contracts";
import { createEvMapper, type EvMapper } from "./ev-mapper.js";
import { initialSessionView, type SessionView } from "./ev-reducer.js";
import type { RawOpencodeEvent } from "./opencode-events.js";
import { planResync, type ResyncResult } from "./session-resync.js";
import { createProgressTicker, type ProgressTicker } from "./progress-ticker.js";
import {
  createStreamCoordinator,
  type CoalesceScheduler,
  type StreamCoordinator,
} from "./stream-coordinator.js";

export interface SessionStreamOptions {
  readonly sessionId: SessionId;
  /** Hop-2 sink toward the renderer (coalesced token + prompt state events). */
  readonly emit: (event: EvEvent) => void;
  /**
   * Fold one EV event into the authoritative view and return it. The session task-registry's
   * `apply` satisfies this — it is the single source of truth (freeze/idempotency live there).
   */
  readonly apply: (event: EvEvent) => SessionView;
  /** Injected window/progress timer (deterministic in tests). */
  readonly scheduler: CoalesceScheduler;
  /** Timestamp source for the mapper + synthetic progress (deterministic tests). */
  readonly now?: () => string;
  /** Resume the monotonic `seq` after a reconnect (passed to the mapper). */
  readonly startSeq?: number;
  /** Seed the local snapshot for a resumed session (defaults to a fresh view). */
  readonly initialView?: SessionView;
  /** Coalescing window in ms. */
  readonly windowMs?: number;
  /** Token burst cap before a forced flush. */
  readonly maxBatchTokens?: number;
  /** EV5 progress interval in ms; omit/`0` to disable the liveness ticker. */
  readonly progressIntervalMs?: number;
  /** Non-secret progress label (UI localizes; a neutral default is fine). */
  readonly progressLabel?: string;
  /** Log-and-drop sink for frames the mapper does not recognise (drift detection). */
  readonly onUnmapped?: (frame: RawOpencodeEvent) => void;
  /**
   * Composed error redactor threaded into the internal {@link createEvMapper}. The
   * composition root passes a VALUE-based-scrub THEN shape-sanitize redactor; defaults to
   * the mapper's built-in shape sanitizer when omitted.
   */
  readonly redactError?: (message: string) => string;
}

export interface SessionStream {
  /** Feed one raw OpenCode frame: map → authoritative fold → coalesce → emit. */
  ingest(frame: unknown): void;
  /** Force-flush pending coalesced tokens (call on idle-cut before a heartbeat). */
  flush(): void;
  /** Stop the progress ticker and flush pending tokens. Idempotent. */
  close(): void;
  /** The current authoritative snapshot (folded view + `lastSeq`). */
  snapshot(): SessionView;
  /** Plan a reconnect resync from the client's last-seen `seq`. */
  resync(clientLastSeq: number): ResyncResult;
}

const DEFAULT_PROGRESS_LABEL = "Running";

export function createSessionStream(options: SessionStreamOptions): SessionStream {
  const clock = options.now ?? (() => new Date().toISOString());
  const mapper: EvMapper = createEvMapper({
    sessionId: options.sessionId,
    now: clock,
    ...(options.startSeq !== undefined ? { startSeq: options.startSeq } : {}),
    ...(options.onUnmapped ? { onUnmapped: options.onUnmapped } : {}),
    ...(options.redactError ? { redactError: options.redactError } : {}),
  });

  let view: SessionView = options.initialView ?? initialSessionView(options.sessionId);
  let closed = false;

  const coordinator: StreamCoordinator = createStreamCoordinator({
    emit: options.emit,
    scheduler: options.scheduler,
    ...(options.windowMs !== undefined ? { windowMs: options.windowMs } : {}),
    ...(options.maxBatchTokens !== undefined ? { maxBatchTokens: options.maxBatchTokens } : {}),
  });

  const ticker: ProgressTicker | null =
    options.progressIntervalMs && options.progressIntervalMs > 0
      ? createProgressTicker({
          scheduler: options.scheduler,
          intervalMs: options.progressIntervalMs,
          // Active = the run has started and is not yet terminal/closed.
          isActive: () => !closed && view.terminal === null && view.lastSeq > 0,
          onTick: emitProgress,
        })
      : null;

  /**
   * Emit a transient EV5 liveness signal. It carries the current authoritative `seq` (NOT a
   * fresh one), so the reducer treats it as a duplicate no-op — progress never shadows a real
   * event nor mutates the stored snapshot; it is purely a "still working" hint for the UI.
   */
  function emitProgress(): void {
    const event: ProgressEvent = {
      sessionId: options.sessionId,
      seq: view.lastSeq,
      at: clock(),
      kind: "progress",
      label: options.progressLabel ?? DEFAULT_PROGRESS_LABEL,
    };
    coordinator.push(event);
  }

  return {
    ingest(frame) {
      if (closed) return;
      for (const event of mapper.map(frame)) {
        // Authoritative fold FIRST (single source of truth), then hop-2 coalesce/emit.
        view = options.apply(event);
        coordinator.push(event);
        if (event.kind === "terminal") {
          ticker?.stop();
        } else {
          ticker?.start();
        }
      }
    },

    flush() {
      coordinator.flush();
    },

    close() {
      if (closed) return;
      closed = true;
      ticker?.stop();
      coordinator.flush();
    },

    snapshot: () => view,
    resync: (clientLastSeq) => planResync(view, clientLastSeq),
  };
}
