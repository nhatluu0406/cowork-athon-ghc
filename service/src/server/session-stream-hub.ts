/**
 * Live session-stream fan-out hub (CGHC-015).
 *
 * Bridges the DONE hop-2 core ({@link createSessionStream}: raw frame → mapper → authoritative
 * fold → coalescing coordinator → emit) to N connected SSE clients. There is exactly ONE live
 * {@link createSessionStream} per session (the single mapper/seq owner); its coalesced `emit`
 * output is fanned out to every subscribed SSE writer. The authoritative fold still flows
 * through the injected `apply` seam (the session task-registry — the one source of truth), so
 * this hub adds NO new state machine and never fabricates a terminal: it only relays.
 *
 * The composition root binds `apply`/`view` to the live `SessionService` and calls `open()`
 * when a run starts, feeding it the real OpenCode `/event` frames via `ingest`. Tests drive
 * `ingest` directly to exercise the real coalescing/terminal-finality guarantees over a socket.
 */

import type { EvEvent, SessionId } from "@cowork-ghc/contracts";
import {
  createSessionStream,
  realScheduler,
  type CoalesceScheduler,
  type SessionStream,
  type SessionView,
} from "../execution/index.js";

/** A subscribed SSE consumer's per-event sink. */
export type EvListener = (event: EvEvent) => void;

/** Handle returned by {@link SessionEventSource.subscribe}; detaches the listener. */
export interface Unsubscribe {
  close(): void;
}

/** Feeds raw runtime frames into one live session run and tears it down. */
export interface SessionRunController {
  /** Feed one raw OpenCode frame: map → authoritative fold → coalesce → fan-out emit. */
  ingest(frame: unknown): void;
  /** Force-flush pending coalesced tokens (e.g. on idle-cut before a heartbeat). */
  flush(): void;
  /** Stop the run: flush, stop the progress ticker, and drop the run + its listeners. */
  close(): void;
}

/**
 * The read seam the SSE route consumes: look up the authoritative view (existence + terminal
 * check) and subscribe to live coalesced EV events. Kept minimal so the route stays pure.
 */
export interface SessionEventSource {
  /** The authoritative folded view, or `undefined` when the session is not loaded. */
  view(sessionId: SessionId): SessionView | undefined;
  /** Subscribe to live EV events; `undefined` when no live run is attached to the session. */
  subscribe(sessionId: SessionId, listener: EvListener): Unsubscribe | undefined;
}

export interface SessionStreamHubOptions {
  /** Authoritative fold seam — the session task-registry `apply` (single source of truth). */
  readonly apply: (sessionId: SessionId, event: EvEvent) => SessionView;
  /** Authoritative view lookup — the session-service `view`. */
  readonly view: (sessionId: SessionId) => SessionView | undefined;
  /** Coalescing/progress timer seam; defaults to the real `setTimeout` scheduler. */
  readonly scheduler?: CoalesceScheduler;
  readonly now?: () => string;
  readonly windowMs?: number;
  readonly maxBatchTokens?: number;
  readonly progressIntervalMs?: number;
  readonly progressLabel?: string;
  /**
   * Composed error redactor forwarded to each live {@link createSessionStream}'s mapper so a
   * `session.error` message is VALUE-scrubbed then shape-sanitized on the live path exactly as
   * on the rebuild path. The composition root supplies it; omitted → the mapper's default.
   */
  readonly redactError?: (message: string) => string;
}

interface Run {
  readonly stream: SessionStream;
  readonly listeners: Set<EvListener>;
  /**
   * True once the pump has CLAIMED this run via {@link SessionStreamHub.open} — from then on the
   * pump owns teardown (single owner) and the hub must never evict it. A run reaches this state
   * before it can ingest any frame (ingest is only reachable through `open()`'s controller), so
   * an ingested run is always claimed. Used by the empty-run eviction guard (FIX-3).
   */
  opened: boolean;
  /** True once at least one frame has been ingested (real folded activity). Never evict then. */
  ingested: boolean;
}

/** The hub: a {@link SessionEventSource} the route reads, plus `open()` to start a run. */
export interface SessionStreamHub extends SessionEventSource {
  /** Start (or reuse) the live run for a session and return a controller to feed frames. */
  open(sessionId: SessionId): SessionRunController;
  /** Whether a live run is currently registered for a session (diagnostics/tests). */
  hasRun(sessionId: SessionId): boolean;
}

export function createSessionStreamHub(options: SessionStreamHubOptions): SessionStreamHub {
  const runs = new Map<SessionId, Run>();
  const scheduler: CoalesceScheduler = options.scheduler ?? realScheduler();

  function ensureRun(sessionId: SessionId): Run {
    const existing = runs.get(sessionId);
    if (existing) return existing;
    const listeners = new Set<EvListener>();
    const stream = createSessionStream({
      sessionId,
      // Fan out each coalesced event to every current subscriber. Snapshot the set first so a
      // listener that detaches during dispatch cannot corrupt the iteration.
      emit: (event) => {
        for (const listener of [...listeners]) listener(event);
      },
      apply: (event) => options.apply(sessionId, event),
      scheduler,
      ...(options.now ? { now: options.now } : {}),
      ...(options.windowMs !== undefined ? { windowMs: options.windowMs } : {}),
      ...(options.maxBatchTokens !== undefined ? { maxBatchTokens: options.maxBatchTokens } : {}),
      ...(options.progressIntervalMs !== undefined
        ? { progressIntervalMs: options.progressIntervalMs }
        : {}),
      ...(options.progressLabel !== undefined ? { progressLabel: options.progressLabel } : {}),
      ...(options.redactError ? { redactError: options.redactError } : {}),
    });
    const run: Run = { stream, listeners, opened: false, ingested: false };
    runs.set(sessionId, run);
    return run;
  }

  return {
    open(sessionId) {
      const run = ensureRun(sessionId);
      // The pump has claimed this run: it now owns teardown (single owner), so the hub's
      // empty-run eviction (FIX-3) must never drop it out from under the pump.
      run.opened = true;
      return {
        ingest: (frame) => {
          run.ingested = true;
          run.stream.ingest(frame);
        },
        flush: () => run.stream.flush(),
        close: () => {
          run.stream.close();
          runs.delete(sessionId);
        },
      };
    },
    hasRun: (sessionId) => runs.has(sessionId),
    view: (sessionId) => options.view(sessionId),
    subscribe(sessionId, listener) {
      let run = runs.get(sessionId);
      if (!run) {
        // Lazily attach a live run so the renderer can subscribe BEFORE the first `/event`
        // frame arrives (the product opens the stream, THEN sends the prompt). Only for a
        // session the authoritative view actually holds and has not already gone terminal —
        // never fabricate a run for an unknown/finished session. The run stays inert (no
        // mapper output, no progress ticker) until the pump feeds a frame via `open().ingest`,
        // so this cannot fabricate a terminal.
        const view = options.view(sessionId);
        if (view === undefined || view.terminal !== null) return undefined;
        run = ensureRun(sessionId);
      }
      const attached = run;
      attached.listeners.add(listener);
      return {
        close: () => {
          attached.listeners.delete(listener);
          // Empty-run eviction (FIX-3): a run lazily created for a subscription that then
          // disconnected BEFORE any frame — and that the pump never claimed via open() — would
          // otherwise leak in `runs` forever (the pump only reaps runs IT opened). Drop it only
          // when it is inert and unclaimed: ZERO listeners AND no frame ingested AND not opened.
          // Never evict a run that still has listeners, that has ingested frames, or that the
          // pump owns — so this can neither fabricate nor skip a terminal. The identity check
          // guards against deleting a newer run that already replaced this one. `ensureRun` still
          // reuses a present run, so there is no double-open regression.
          if (
            attached.listeners.size === 0 &&
            !attached.ingested &&
            !attached.opened &&
            runs.get(sessionId) === attached
          ) {
            runs.delete(sessionId);
          }
        },
      };
    },
  };
}
