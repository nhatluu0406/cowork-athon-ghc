/**
 * Session domain service (CGHC-013, S1/S3/S4/S6).
 *
 * The ONE session mechanism: OpenCode's own store is the content source of truth; this
 * service owns only light, secret-free metadata (id, title, timestamps, workspace,
 * provider/model ref, status) and the authoritative runtime view. It composes:
 *  - {@link SessionStore} — the OpenCode-store seam (create/list/get/rename/replay).
 *  - {@link createTaskRegistry} — per-session cancel gate (S3) + honest status (S6).
 *  - the CGHC-012 {@link createEvMapper} + reducer — to rebuild state on restart (S4).
 *
 * All wire calls sit behind injected seams, so the default suite touches no live network
 * or LLM. The service never writes OpenCode `auth.json`/`env.json` and holds no secrets.
 */

import type { EvEvent, SessionId, SessionMeta, SessionStatus } from "@cowork-ghc/contracts";
import {
  createEvMapper,
  initialSessionView,
  reduceEv,
  type SessionView,
} from "../execution/index.js";
import type { StreamHandle } from "../provider/index.js";
import { toSessionMeta } from "./meta.js";
import { createTaskRegistry, type TaskRegistry } from "./task-registry.js";
import type {
  CreateSessionInput,
  RuntimeHealth,
  SessionStore,
  StreamCanceller,
} from "./seams.js";

export interface SessionServiceOptions {
  readonly store: SessionStore;
  readonly health: RuntimeHealth;
  /** The provider cancel seam (S3); `ProviderPort` satisfies it structurally. */
  readonly canceller: StreamCanceller;
  /** Injectable clock (deterministic tests). */
  readonly now?: () => string;
  /**
   * Composed error redactor threaded into the per-session {@link createEvMapper} used to
   * rebuild a view on restart (S4). The composition root passes a VALUE-based-scrub THEN
   * shape-sanitize redactor so a `session.error` message is redacted identically on the
   * live and the rebuilt path. Defaults to the mapper's built-in shape sanitizer.
   */
  readonly redactError?: (message: string) => string;
}

/** The result of reopening/continuing a session: its metadata + rebuilt view (S4). */
export interface ReopenedSession {
  readonly meta: SessionMeta;
  readonly view: SessionView;
}

export interface SessionService {
  /** Create a new session in the store and register a live task (S1). */
  create(input: CreateSessionInput): Promise<SessionMeta>;
  /** List stored sessions as light metadata — the S4 restart/resume entry point. */
  list(): Promise<readonly SessionMeta[]>;
  /**
   * Continue/reopen an existing session: rebuild its authoritative view from the store's
   * replayed events (NOT from memory) and register the live task (S1 continue + S4 resume).
   */
  continueSession(sessionId: SessionId): Promise<ReopenedSession>;
  /** Rename a session in the store and refresh its light metadata (S1). */
  rename(sessionId: SessionId, title: string): Promise<SessionMeta>;
  /** The current authoritative view for a loaded session, or `undefined`. */
  view(sessionId: SessionId): SessionView | undefined;
  /** The honest session status (S6). */
  status(sessionId: SessionId): SessionStatus;
  /** Apply a mapped EV event to a loaded session (feeder for CGHC-014 streaming). */
  apply(sessionId: SessionId, event: EvEvent): SessionView;
  /** Bind an in-flight stream handle so cancel can abort it (CGHC-014). */
  bindStream(sessionId: SessionId, handle: StreamHandle): void;
  /** Cancel a session: stop output, go terminal `cancelled`, block further mutation (S3). */
  cancel(sessionId: SessionId): Promise<void>;
}

export function createSessionService(options: SessionServiceOptions): SessionService {
  const { store } = options;
  const clock = options.now ?? (() => new Date().toISOString());
  const registry: TaskRegistry = createTaskRegistry({
    canceller: options.canceller,
    health: options.health,
    now: clock,
  });

  /**
   * Rebuild the authoritative view for a session purely from the store's replayed frames
   * (S4). Reuses the CGHC-012 mapper (OpenCode frame → EV) + reducer (EV → view), so the
   * reconstruction is identical to the live path — no separate/fabricated logic.
   */
  async function rebuildView(sessionId: SessionId): Promise<SessionView> {
    const frames = await store.replay(sessionId);
    const mapper = createEvMapper({
      sessionId,
      now: clock,
      ...(options.redactError ? { redactError: options.redactError } : {}),
    });
    let view = initialSessionView(sessionId);
    for (const frame of frames) {
      for (const event of mapper.map(frame)) view = reduceEv(view, event);
    }
    return view;
  }

  return {
    async create(input) {
      const stored = await store.create(input);
      registry.register(stored.id, initialSessionView(stored.id));
      return toSessionMeta(stored, registry.status(stored.id));
    },

    async list() {
      const stored = await store.list();
      return stored.map((session) => toSessionMeta(session, registry.status(session.id)));
    },

    async continueSession(sessionId) {
      const stored = await store.get(sessionId);
      if (stored === undefined) {
        throw new Error(`No stored session ${JSON.stringify(sessionId)}`);
      }
      // MEDIUM-2 (review): never clobber a LIVE in-process task. Re-registering would drop an
      // in-flight StreamHandle (orphaning a runtime stream a later cancel could no longer
      // abort) and silently un-freeze a cancelled task. If a non-terminal live task exists,
      // reopen returns its authoritative in-memory view untouched; only rebuild from the store
      // when there is no live task (the genuine restart/resume path, S4).
      const live = registry.view(sessionId);
      if (registry.has(sessionId) && live !== undefined && live.terminal === null) {
        return { meta: toSessionMeta(stored, registry.status(sessionId)), view: live };
      }
      const view = await rebuildView(sessionId);
      registry.register(sessionId, view);
      return { meta: toSessionMeta(stored, registry.status(sessionId)), view };
    },

    async rename(sessionId, title) {
      const stored = await store.rename(sessionId, title);
      return toSessionMeta(stored, registry.status(sessionId));
    },

    view: (sessionId) => registry.view(sessionId),
    status: (sessionId) => registry.status(sessionId),
    apply: (sessionId, event) => registry.apply(sessionId, event),
    bindStream: (sessionId, handle) => registry.bindStream(sessionId, handle),
    cancel: (sessionId) => registry.cancel(sessionId),
  };
}
