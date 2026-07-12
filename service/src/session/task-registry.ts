/**
 * Per-session runtime task registry — the load-bearing S3 (cancel) + S6 (honest status)
 * enforcement layer of session orchestration (CGHC-013).
 *
 * It owns the authoritative {@link SessionView} per live session (folded via the CGHC-012
 * reducer) and adds two guarantees the bare reducer does not provide on its own:
 *
 *  - S3 (cancel stops mutation): `cancel` routes through the {@link StreamCanceller} seam
 *    to stop output at the runtime source, drives the session to a terminal `cancelled`
 *    state, then FREEZES the task. Once frozen, {@link TaskRegistry.apply} DROPS every
 *    further frame, so no post-cancel tool call / file mutation / token is ever applied to
 *    the view. (The reducer alone still appends a late `file_mutation` even after a
 *    terminal — see ev-reducer.ts — so this freeze gate is what makes S3 true.)
 *
 *  - S6 (truthful status): status is derived from the reduced view (never fabricated). A
 *    non-terminal session whose supervised runtime child is dead is reported as
 *    `runtime_down`; a genuinely-terminal run keeps its honest historical status.
 */

import type { EvEvent, SessionId, SessionStatus, TerminalEvent } from "@cowork-ghc/contracts";
import { initialSessionView, reduceEv, type SessionView } from "../execution/index.js";
import type { StreamHandle } from "../provider/index.js";
import type { RuntimeHealth, StreamCanceller } from "./seams.js";

interface TaskState {
  view: SessionView;
  /** Handle for an in-flight runtime stream, bound by CGHC-014 so cancel can abort it. */
  handle: StreamHandle | null;
  /** Set by `cancel`; once true, `apply` drops every further frame (S3). */
  frozen: boolean;
}

export interface TaskRegistryOptions {
  readonly canceller: StreamCanceller;
  readonly health: RuntimeHealth;
  /** Injectable clock for the synthetic cancel terminal's `at` (deterministic tests). */
  readonly now?: () => string;
}

export interface TaskRegistry {
  /** Register (or replace) a session's task with a starting view (initial or rebuilt). */
  register(sessionId: SessionId, view?: SessionView): void;
  /** Whether a live task exists for the session. */
  has(sessionId: SessionId): boolean;
  /** The current authoritative view, or `undefined` if the session is not loaded. */
  view(sessionId: SessionId): SessionView | undefined;
  /** Bind the in-flight stream handle so a later `cancel` can abort it (CGHC-014). */
  bindStream(sessionId: SessionId, handle: StreamHandle): void;
  /**
   * Apply one mapped EV event. Returns the updated view. AFTER cancel the task is frozen
   * and this drops the event unchanged — the S3 no-post-cancel-mutation guarantee.
   */
  apply(sessionId: SessionId, event: EvEvent): SessionView;
  /** Cancel the session (S3): stop output at the source, go terminal `cancelled`, freeze. */
  cancel(sessionId: SessionId): Promise<void>;
  /** The honest session status (S6), with `runtime_down` when the child is dead. */
  status(sessionId: SessionId): SessionStatus;
}

export function createTaskRegistry(options: TaskRegistryOptions): TaskRegistry {
  const clock = options.now ?? (() => new Date().toISOString());
  const tasks = new Map<SessionId, TaskState>();

  function requireTask(sessionId: SessionId): TaskState {
    const task = tasks.get(sessionId);
    if (task === undefined) {
      throw new Error(`No live task for session ${JSON.stringify(sessionId)}`);
    }
    return task;
  }

  return {
    register(sessionId, view) {
      tasks.set(sessionId, {
        view: view ?? initialSessionView(sessionId),
        handle: null,
        frozen: false,
      });
    },

    has: (sessionId) => tasks.has(sessionId),
    view: (sessionId) => tasks.get(sessionId)?.view,

    bindStream(sessionId, handle) {
      requireTask(sessionId).handle = handle;
    },

    apply(sessionId, event) {
      const task = requireTask(sessionId);
      // S3: a frozen task accepts NO further frames — the load-bearing no-post-terminal
      // mutation guarantee.
      if (task.frozen) return task.view;
      task.view = reduceEv(task.view, event);
      // Freeze on ANY terminal, not only cancel (CGHC-013 review MEDIUM-1): once a run reaches
      // completed/errored/cancelled/denied it is over, so a later frame must not mutate the
      // view. The reducer now also drops post-terminal mutating frames (defense in depth), and
      // this freeze stops even the seq/cursor from advancing on junk after the run finished.
      if (task.view.terminal !== null) task.frozen = true;
      return task.view;
    },

    async cancel(sessionId) {
      const task = requireTask(sessionId);
      // 1. Stop output at the runtime source — always routed through the provider seam.
      if (task.handle) await options.canceller.cancel(task.handle);
      // 2. Drive the session to a terminal `cancelled` state. The user's explicit cancel
      //    IS the real cause, so this terminal is honest (not a fabricated `completed`);
      //    "first terminal wins" in the reducer means an already-terminal run is untouched.
      const terminal: TerminalEvent = {
        sessionId,
        seq: task.view.lastSeq + 1,
        at: clock(),
        kind: "terminal",
        state: "cancelled",
        message: "Cancelled by user.",
      };
      task.view = reduceEv(task.view, terminal);
      // 3. Freeze: from now on `apply` drops every frame (S3, load-bearing).
      task.frozen = true;
    },

    status(sessionId) {
      const task = tasks.get(sessionId);
      const derived: SessionStatus = task ? task.view.status : "idle";
      // A run that genuinely reached a terminal state keeps that honest historical status
      // even if the runtime later exits — the run really did finish/cancel/error.
      if (task && task.view.terminal !== null) return derived;
      // S6: a non-terminal session cannot honestly be called live/idle when the supervised
      // child is dead. Surface `runtime_down` instead of a fabricated running status.
      if (!options.health.isAlive()) return "runtime_down";
      return derived;
    },
  };
}
