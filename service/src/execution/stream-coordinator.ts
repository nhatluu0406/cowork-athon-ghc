/**
 * Hop-2 coalescing / backpressure coordinator (CGHC-014, risk R7).
 *
 * The renderer-facing streaming policy that keeps token spam off the UI thread WITHOUT
 * ever delaying a state-changing event or dropping a terminal. It is transport-agnostic:
 * push mapped {@link EvEvent}s in, get (fewer) events out via `emit` — a thin SSE/socket
 * endpoint wraps this, and the whole policy is unit-testable with a virtual scheduler.
 *
 * Policy:
 *  - S2 `token` deltas are COALESCED over a small window (time OR count): consecutive
 *    tokens accumulate into ONE emitted token whose `delta` is their concatenation and
 *    whose `seq`/`at` are the LAST coalesced token's — so a burst of N deltas yields far
 *    fewer than N emissions and buffering is bounded to a single accumulator (backpressure).
 *  - EVERY other kind (plan/step/tool_call/file_mutation/progress/error/terminal) FLUSHES
 *    PROMPTLY: pending tokens are flushed FIRST (ordering is preserved — a token always
 *    has a lower `seq` than a later state event), then the state event is emitted with no
 *    delay. Low latency for state-changing events, coalesced for token noise.
 *  - A `terminal` is emitted promptly and is the FINAL emission; nothing is emitted after
 *    it (post-terminal noise is dropped, mirroring the reducer/registry freeze — the
 *    coordinator never fabricates or reorders a terminal).
 *
 * The scheduler (window timer) is injected so tests advance virtual time — NO real sleeps.
 */

import type { EvEvent, TokenEvent } from "@cowork-ghc/contracts";

/** Cancel a scheduled window flush. Idempotent. */
export type CancelTimer = () => void;

/** Injected timer seam — a real one for production, a virtual one for deterministic tests. */
export interface CoalesceScheduler {
  /** Run `fn` after `delayMs`; the returned canceller unschedules it if still pending. */
  readonly setTimer: (delayMs: number, fn: () => void) => CancelTimer;
}

export interface StreamCoordinatorOptions {
  /** Sink for the (coalesced) hop-2 event stream toward the renderer. */
  readonly emit: (event: EvEvent) => void;
  /** Injected window timer (deterministic in tests). */
  readonly scheduler: CoalesceScheduler;
  /** Coalescing window in ms; pending tokens flush at most this long after the first. */
  readonly windowMs?: number;
  /** Hard cap on tokens buffered before a forced flush (bounds burst latency). */
  readonly maxBatchTokens?: number;
  /** Grace delay before emitting terminal so late token deltas can flush first. */
  readonly terminalGraceMs?: number;
}

export interface StreamCoordinator {
  /** Feed one mapped EV event (in emission/`seq` order). */
  push(event: EvEvent): void;
  /** Force-flush any pending coalesced tokens (call on stream close/idle-cut). */
  flush(): void;
  /** True once a terminal has been emitted — the stream is over. */
  readonly isTerminated: () => boolean;
}

const DEFAULT_WINDOW_MS = 40;
const DEFAULT_MAX_BATCH_TOKENS = 48;
const DEFAULT_TERMINAL_GRACE_MS = 120;

interface PendingTokens {
  sessionId: EvEvent["sessionId"];
  at: string;
  seq: number;
  delta: string;
  count: number;
}

export function createStreamCoordinator(options: StreamCoordinatorOptions): StreamCoordinator {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxBatchTokens = options.maxBatchTokens ?? DEFAULT_MAX_BATCH_TOKENS;
  const terminalGraceMs = options.terminalGraceMs ?? DEFAULT_TERMINAL_GRACE_MS;

  let pending: PendingTokens | null = null;
  let cancelTimer: CancelTimer | null = null;
  let cancelTerminalGrace: CancelTimer | null = null;
  let pendingTerminal: EvEvent | null = null;
  let terminated = false;

  function clearTimer(): void {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
  }

  function clearTerminalGrace(): void {
    if (cancelTerminalGrace) {
      cancelTerminalGrace();
      cancelTerminalGrace = null;
    }
  }

  function emitTerminalNow(): void {
    clearTerminalGrace();
    if (pendingTerminal === null) return;
    const terminal = pendingTerminal;
    pendingTerminal = null;
    options.emit(terminal);
    terminated = true;
    clearTimer();
  }

  /** Emit the accumulated tokens as ONE token event (or nothing if none pending). */
  function flushPending(): void {
    clearTimer();
    if (pending === null) return;
    const batch: TokenEvent = {
      sessionId: pending.sessionId,
      seq: pending.seq,
      at: pending.at,
      kind: "token",
      delta: pending.delta,
    };
    pending = null;
    options.emit(batch);
  }

  function accumulate(event: TokenEvent): void {
    if (pending === null) {
      pending = {
        sessionId: event.sessionId,
        at: event.at,
        seq: event.seq,
        delta: event.delta,
        count: 1,
      };
    } else {
      pending.delta += event.delta;
      pending.seq = event.seq;
      pending.at = event.at;
      pending.count += 1;
    }
    // Count-bound flush keeps a fast burst from waiting the whole window.
    if (pending.count >= maxBatchTokens) {
      flushPending();
      return;
    }
    // Arm the window timer once; it flushes whatever accumulated when it fires.
    if (cancelTimer === null) {
      cancelTimer = options.scheduler.setTimer(windowMs, () => {
        cancelTimer = null;
        flushPending();
      });
    }
  }

  return {
    push(event) {
      // Post-terminal noise is dropped (matches the reducer/registry freeze). The terminal
      // already emitted is the final, honest end of the stream — never fabricate more.
      if (terminated) return;
      if (event.kind === "token") {
        accumulate(event);
        return;
      }
      // A state-changing event: preserve ordering by flushing buffered tokens first, then
      // emit it with no coalescing delay (low latency for state that changes the UI).
      flushPending();
      if (event.kind === "terminal") {
        pendingTerminal = event;
        clearTerminalGrace();
        cancelTerminalGrace = options.scheduler.setTimer(terminalGraceMs, () => {
          cancelTerminalGrace = null;
          emitTerminalNow();
        });
        return;
      }
      options.emit(event);
    },

    flush() {
      flushPending();
      emitTerminalNow();
    },

    isTerminated: () => terminated,
  };
}

/**
 * Production scheduler backed by `setTimeout`. `unref` so a pending window never keeps the
 * process alive. Tests inject a virtual scheduler instead (no real sleeps).
 */
export function realScheduler(): CoalesceScheduler {
  return {
    setTimer(delayMs, fn) {
      const handle = setTimeout(fn, delayMs);
      handle.unref?.();
      return () => clearTimeout(handle);
    },
  };
}
