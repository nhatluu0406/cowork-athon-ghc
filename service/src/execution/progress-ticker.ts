/**
 * EV5 long-running progress ticker (CGHC-014).
 *
 * A slow run that produces no tokens for a while would otherwise look stalled. This drives a
 * periodic liveness signal: while the run is active it calls `onTick` every `intervalMs`, so
 * the caller can emit an EV5 {@link import("@cowork-ghc/contracts").ProgressEvent} onto hop 2.
 * The reducer folds `progress` as a no-op state hint (it changes no stored view field), so a
 * tick is a transient "still working" signal and never mutates the authoritative snapshot.
 *
 * The timer is injected via the same {@link CoalesceScheduler} seam as the coordinator, so a
 * slow run is exercised in tests by advancing virtual time — NO real sleeps, no wall clock.
 */

import type { CoalesceScheduler } from "./stream-coordinator.js";

export interface ProgressTickerOptions {
  readonly scheduler: CoalesceScheduler;
  /** Interval between liveness ticks in ms. */
  readonly intervalMs: number;
  /** True while the run should still emit progress (live + some activity seen). */
  readonly isActive: () => boolean;
  /** Invoked on each tick while active; the caller emits the EV5 event. */
  readonly onTick: () => void;
}

export interface ProgressTicker {
  /** Arm the recurring tick. Idempotent — re-arming while running is a no-op. */
  start(): void;
  /** Stop ticking and cancel any pending timer. Idempotent. */
  stop(): void;
}

export function createProgressTicker(options: ProgressTickerOptions): ProgressTicker {
  let cancel: (() => void) | null = null;
  let running = false;

  function arm(): void {
    cancel = options.scheduler.setTimer(options.intervalMs, () => {
      cancel = null;
      if (!running) return;
      // Only signal while genuinely active; when the run ends the ticker stops re-arming so
      // it never emits a false "still working" after a terminal.
      if (options.isActive()) options.onTick();
      if (running) arm();
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      arm();
    },
    stop() {
      running = false;
      if (cancel) {
        cancel();
        cancel = null;
      }
    },
  };
}
