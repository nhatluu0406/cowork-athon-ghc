/**
 * Default timer scheduler (CGHC-016, P6 fail-closed timeout).
 *
 * Wraps `setTimeout`/`clearTimeout` behind the {@link TimerScheduler} seam so the gate's
 * fail-closed auto-deny uses real timers in production but a deterministic manual scheduler
 * in tests (no wall-clock sleeps). Timers are `unref`'d so a pending fail-closed timer never
 * keeps the process alive on its own.
 */

import type { TimerHandle, TimerScheduler } from "./ports.js";

export function createNodeScheduler(): TimerScheduler {
  let counter = 0;
  const timers = new Map<number, NodeJS.Timeout>();
  return {
    schedule(delayMs, callback) {
      const id = ++counter;
      const handle = setTimeout(() => {
        timers.delete(id);
        callback();
      }, delayMs);
      if (typeof handle.unref === "function") handle.unref();
      timers.set(id, handle);
      return { id };
    },
    cancel(handle: TimerHandle) {
      const timer = timers.get(handle.id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(handle.id);
      }
    },
  };
}
