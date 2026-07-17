/**
 * Test fakes for the runtime preview runner. No real process, port, or taskkill is touched:
 * a {@link FakePreviewChild} is driven by the test (emit output / exit / error), and a
 * {@link recordingPreviewSpawner} captures the exact command/args/env/cwd.
 */

import type {
  PreviewChild,
  PreviewChildEvent,
  PreviewDataListener,
  PreviewSpawnOptions,
  PreviewSpawner,
} from "../src/runtime-preview/preview-spawner.js";

type AnyListener = (...args: unknown[]) => void;

export class FakePreviewChild implements PreviewChild {
  killed = false;
  killCalls = 0;
  killTreeCalls = 0;
  /** When true, a graceful `kill()` immediately fires `exit` (a well-behaved process). */
  gracefulOnKill: boolean;
  private readonly dataListeners: PreviewDataListener[] = [];
  private readonly exitListeners: AnyListener[] = [];
  private readonly errorListeners: AnyListener[] = [];

  constructor(
    readonly pid: number | undefined = 4321,
    options: { gracefulOnKill?: boolean } = {},
  ) {
    this.gracefulOnKill = options.gracefulOnKill ?? true;
  }

  onData(listener: PreviewDataListener): void {
    this.dataListeners.push(listener);
  }
  once(event: PreviewChildEvent, listener: (...args: never[]) => void): void {
    (event === "exit" ? this.exitListeners : this.errorListeners).push(listener as AnyListener);
  }
  on(event: PreviewChildEvent, listener: (...args: never[]) => void): void {
    this.once(event, listener);
  }
  removeListener(): void {
    /* no-op */
  }
  kill(): boolean {
    this.killCalls += 1;
    if (this.gracefulOnKill) this.emitExit(0);
    return true;
  }
  killTree(): void {
    this.killTreeCalls += 1;
    this.emitExit(null);
  }

  // --- test drivers ---
  emitData(stream: "stdout" | "stderr", chunk: string): void {
    for (const l of this.dataListeners) l(stream, chunk);
  }
  emitExit(code: number | null): void {
    if (this.killed) return;
    this.killed = true;
    const listeners = [...this.exitListeners];
    this.exitListeners.length = 0;
    for (const l of listeners) l(code);
  }
  emitError(err: Error): void {
    for (const l of this.errorListeners) l(err);
  }
}

export interface SpawnCapture {
  command?: string;
  args?: readonly string[];
  options?: PreviewSpawnOptions;
}

export function recordingPreviewSpawner(child: FakePreviewChild): {
  spawner: PreviewSpawner;
  capture: SpawnCapture;
} {
  const capture: SpawnCapture = {};
  return {
    capture,
    spawner: {
      spawn(command, args, options): PreviewChild {
        capture.command = command;
        capture.args = args;
        capture.options = options;
        return child;
      },
    },
  };
}

/** A hand-driven poll seam: the test calls `step()` to advance the startup poll. */
export function manualPoll(): {
  setPoll: (fn: () => void, ms: number) => { cancel: () => void };
  step: () => void;
  cancelled: () => boolean;
} {
  let current: (() => void) | null = null;
  let cancelled = false;
  return {
    setPoll: (fn) => {
      current = fn;
      return {
        cancel: () => {
          cancelled = true;
          current = null;
        },
      };
    },
    step: () => current?.(),
    cancelled: () => cancelled,
  };
}
