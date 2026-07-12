/**
 * Shared deterministic fakes for the CGHC-014 hop-2 streaming tests: a VIRTUAL scheduler
 * (no real sleeps — tests advance time explicitly), an EV-event recorder, and small EV/frame
 * builders. Not a `*.test.ts` file, so the runner does not execute it directly.
 */

import type { EvEvent } from "@cowork-ghc/contracts";
import type { CancelTimer, CoalesceScheduler } from "../src/execution/index.js";

interface VirtualTimer {
  due: number;
  fn: () => void;
  cancelled: boolean;
}

/** A `CoalesceScheduler` whose timers fire only when the test advances virtual time. */
export interface ManualScheduler extends CoalesceScheduler {
  /** Advance virtual time by `ms`, firing every timer whose deadline is now reached (in order). */
  advance(ms: number): void;
  /** Number of still-pending (armed, uncancelled) timers. */
  pending(): number;
  /** Current virtual clock value in ms. */
  nowMs(): number;
}

export function createManualScheduler(): ManualScheduler {
  const timers: VirtualTimer[] = [];
  let clock = 0;

  return {
    setTimer(delayMs: number, fn: () => void): CancelTimer {
      const timer: VirtualTimer = { due: clock + delayMs, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    advance(ms: number): void {
      const target = clock + ms;
      // Fire due timers in deadline order; re-armed timers may be added mid-loop.
      for (;;) {
        const next = timers
          .filter((t) => !t.cancelled && t.due <= target)
          .sort((a, b) => a.due - b.due)[0];
        if (next === undefined) break;
        next.cancelled = true;
        clock = next.due;
        next.fn();
      }
      clock = target;
    },
    pending: () => timers.filter((t) => !t.cancelled).length,
    nowMs: () => clock,
  };
}

/** Record every event a coordinator/stream emits toward the renderer. */
export interface Recorder {
  readonly events: EvEvent[];
  emit(event: EvEvent): void;
  kinds(): string[];
  tokensText(): string;
}

export function createRecorder(): Recorder {
  const events: EvEvent[] = [];
  return {
    events,
    emit: (event) => void events.push(event),
    kinds: () => events.map((e) => e.kind),
    tokensText: () =>
      events
        .filter((e): e is Extract<EvEvent, { kind: "token" }> => e.kind === "token")
        .map((e) => e.delta)
        .join(""),
  };
}

export const STREAM_SID = "sess-stream";
export const STREAM_AT = "2026-07-11T00:00:00.000Z";

/** Build a token EV event with the shared session id/timestamp. */
export function tokenEv(seq: number, delta: string): EvEvent {
  return { sessionId: STREAM_SID, seq, at: STREAM_AT, kind: "token", delta };
}

/** Build a terminal EV event. */
export function terminalEv(
  seq: number,
  state: "completed" | "errored" | "cancelled" | "denied" = "completed",
): EvEvent {
  return { sessionId: STREAM_SID, seq, at: STREAM_AT, kind: "terminal", state };
}

/** Raw OpenCode frames for the shared session (hop-1 input). */
export function tokenFrame(delta: string): unknown {
  return { type: "message.part.delta", properties: { sessionID: STREAM_SID, delta } };
}
export function toolFrame(callID: string, status: string): unknown {
  return {
    type: "message.part.updated",
    properties: {
      sessionID: STREAM_SID,
      part: { type: "tool", callID, tool: "write", state: { status } },
    },
  };
}
export function idleFrame(): unknown {
  return { type: "session.idle", properties: { sessionID: STREAM_SID } };
}
