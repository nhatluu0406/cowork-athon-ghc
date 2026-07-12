/**
 * Shared in-memory fakes for the CGHC-016 permission tests. All seams (runtime reply,
 * session denial, timer scheduler, clock) are faked so the default suite makes NO live
 * network / LLM call and uses NO real wall-clock sleeps. Not a `*.test.ts` file, so the
 * runner does not execute it directly.
 */

import type { PermissionReply, SessionId } from "@cowork-ghc/contracts";
import type {
  RuntimeReplyPort,
  SessionDenialSink,
  TimerHandle,
  TimerScheduler,
} from "../src/permission/index.js";

export const FIXED_NOW = () => "2026-07-11T00:00:00.000Z";

/** A runtime-reply port that records every forwarded reply (proves the runtime is not stranded). */
export interface RecordingReplyPort extends RuntimeReplyPort {
  readonly replies: readonly PermissionReply[];
}

export function recordingReplyPort(): RecordingReplyPort {
  const replies: PermissionReply[] = [];
  return {
    replies,
    async reply(reply: PermissionReply) {
      replies.push(reply);
    },
  };
}

/** A reply port that always rejects — proves the gate stays fail-closed if forwarding fails. */
export function failingReplyPort(): RuntimeReplyPort {
  return {
    async reply() {
      throw new Error("simulated runtime reply transport failure");
    },
  };
}

/** A session-denial sink that records which sessions were driven terminal (no real session needed). */
export interface RecordingDenialSink extends SessionDenialSink {
  readonly denied: readonly SessionId[];
}

export function recordingDenialSink(): RecordingDenialSink {
  const denied: SessionId[] = [];
  return {
    denied,
    denySession(sessionId: SessionId) {
      denied.push(sessionId);
    },
  };
}

/**
 * A deterministic virtual-time source: `now()` advances only when `advance(ms)` is called,
 * and the scheduler fires timers whose due time has been reached. No real timers, no sleeps.
 */
export interface FakeTime {
  readonly now: () => string;
  readonly scheduler: TimerScheduler;
  /** Advance virtual time by `ms`, firing any timers that come due (in schedule order). */
  advance(ms: number): void;
}

export function createFakeTime(startMs = 0): FakeTime {
  let currentMs = startMs;
  let counter = 0;
  interface Scheduled {
    readonly handle: TimerHandle;
    readonly dueMs: number;
    readonly callback: () => void;
  }
  const scheduled: Scheduled[] = [];

  const scheduler: TimerScheduler = {
    schedule(delayMs, callback) {
      const handle: TimerHandle = { id: ++counter };
      scheduled.push({ handle, dueMs: currentMs + delayMs, callback });
      return handle;
    },
    cancel(handle) {
      const index = scheduled.findIndex((s) => s.handle.id === handle.id);
      if (index !== -1) scheduled.splice(index, 1);
    },
  };

  return {
    now: () => new Date(currentMs).toISOString(),
    scheduler,
    advance(ms) {
      currentMs += ms;
      // Fire everything due, honoring timers that may be scheduled by a firing callback.
      let due = scheduled.filter((s) => s.dueMs <= currentMs);
      while (due.length > 0) {
        for (const item of due) {
          const index = scheduled.indexOf(item);
          if (index !== -1) {
            scheduled.splice(index, 1);
            item.callback();
          }
        }
        due = scheduled.filter((s) => s.dueMs <= currentMs);
      }
    },
  };
}
