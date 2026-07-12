/**
 * Shared in-memory fakes for the CGHC-013 session tests. All seams (OpenCode store,
 * runtime health, provider cancel) are faked so the default suite makes NO live network
 * or LLM call. Not a `*.test.ts` file, so the runner does not execute it directly.
 */

import type { StreamHandle } from "../src/provider/index.js";
import type {
  CreateSessionInput,
  RuntimeHealth,
  SessionStore,
  StoredSession,
  StreamCanceller,
} from "../src/session/index.js";

export const FIXED_NOW = () => "2026-07-11T00:00:00.000Z";

/** An in-memory OpenCode-store fake with a seedable per-session replay-frame log. */
export interface FakeStore extends SessionStore {
  /** Seed the raw OpenCode frames `replay` returns for a session (S4 restart source). */
  seedFrames(id: string, frames: readonly unknown[]): void;
  /** Number of sessions currently stored (for assertions). */
  size(): number;
}

export function fakeStore(now: () => string = FIXED_NOW): FakeStore {
  const sessions = new Map<string, StoredSession>();
  const frames = new Map<string, readonly unknown[]>();
  let counter = 0;

  return {
    async create(input: CreateSessionInput): Promise<StoredSession> {
      const id = `sess-${++counter}`;
      const stored: StoredSession = {
        id,
        title: input.title ?? "Untitled",
        workspaceId: input.workspaceId,
        createdAt: now(),
        updatedAt: now(),
        ...(input.model ? { model: input.model } : {}),
      };
      sessions.set(id, stored);
      return stored;
    },
    async list() {
      return [...sessions.values()];
    },
    async get(id) {
      return sessions.get(id);
    },
    async rename(id, title) {
      const existing = sessions.get(id);
      if (!existing) throw new Error(`fakeStore: no session ${id}`);
      const updated: StoredSession = { ...existing, title, updatedAt: now() };
      sessions.set(id, updated);
      return updated;
    },
    async replay(id) {
      return frames.get(id) ?? [];
    },
    seedFrames(id, seeded) {
      frames.set(id, seeded);
    },
    size: () => sessions.size,
  };
}

export function aliveHealth(): RuntimeHealth {
  return { isAlive: () => true };
}

/** A health seam whose liveness is flipped via the returned setter (S6 runtime-down). */
export function toggleHealth(initial = true): { health: RuntimeHealth; setAlive(v: boolean): void } {
  let alive = initial;
  return { health: { isAlive: () => alive }, setAlive: (v) => (alive = v) };
}

/** A cancel seam that records every aborted handle (proves S3 routes through the seam). */
export interface RecordingCanceller extends StreamCanceller {
  readonly cancelled: readonly StreamHandle[];
}

export function recordingCanceller(): RecordingCanceller {
  const cancelled: StreamHandle[] = [];
  return {
    cancelled,
    async cancel(handle: StreamHandle) {
      cancelled.push(handle);
    },
  };
}
