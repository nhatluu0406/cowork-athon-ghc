/**
 * Session orchestration seams (CGHC-013, S1/S3/S4/S6).
 *
 * These are the injected boundaries the session domain service talks to, mirroring the
 * `ProviderConnector` pattern (CGHC-010): the DEFAULT test suite supplies fakes so no
 * live OpenCode wire call / network / LLM is touched.
 *
 * ONE session mechanism (architecture invariant): OpenCode's OWN store is the content
 * source of truth (transcript, messages, parts, event history). This app owns only LIGHT,
 * secret-free metadata (id, title, timestamps, workspace, provider/model ref). {@link
 * SessionStore} is the seam onto that OpenCode store — we never build a parallel content
 * store. The app never writes OpenCode `auth.json`/`env.json` through this seam.
 */

import type { ModelRef } from "@cowork-ghc/contracts";
import type { SessionId } from "@cowork-ghc/contracts";
import type { WorkspaceId } from "@cowork-ghc/contracts";
import type { StreamHandle } from "../provider/index.js";

/**
 * Light, secret-free session metadata as held by the OpenCode store. Deliberately carries
 * NO transcript/content — that stays in the runtime store (single source of truth).
 */
export interface StoredSession {
  readonly id: SessionId;
  readonly title: string;
  readonly workspaceId: WorkspaceId;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Effective model ref for the session (secret-free handle, PR4). */
  readonly model?: ModelRef;
}

/** Inputs to create a session in the OpenCode store (S1). */
export interface CreateSessionInput {
  readonly workspaceId: WorkspaceId;
  /** Optional human title; the store may derive a default when omitted. */
  readonly title?: string;
  readonly model?: ModelRef;
}

/**
 * The OpenCode-store seam. Every method is a wire call to the runtime's own persistence;
 * tests supply an in-memory fake. `replay` returns the RAW OpenCode event frames for a
 * session so the service can rebuild the authoritative view through the CGHC-012
 * mapper+reducer (S4) rather than trusting an in-memory snapshot.
 */
export interface SessionStore {
  /** Create a session in the OpenCode store and return its light metadata (S1). */
  create(input: CreateSessionInput): Promise<StoredSession>;
  /** List stored sessions (light metadata only) — the S4 restart/resume source. */
  list(): Promise<readonly StoredSession[]>;
  /** One stored session by id, or `undefined` if the store has no such session. */
  get(id: SessionId): Promise<StoredSession | undefined>;
  /** Rename a stored session and return the updated light metadata (S1). */
  rename(id: SessionId, title: string): Promise<StoredSession>;
  /**
   * Replay the stored OpenCode event frames for a session (S4). Returned frames are raw
   * (mapper-shaped) OpenCode `/event` objects; the service maps + folds them to rebuild
   * the {@link import("../execution/index.js").SessionView} deterministically.
   */
  replay(id: SessionId, fromSeq?: number): Promise<readonly unknown[]>;
}

/**
 * The runtime supervision seam (design §8): reports whether the supervised OpenCode child
 * is alive. Used for the honest `runtime_down` status (S6) — the session service never
 * claims a live status when the child process is gone.
 */
export interface RuntimeHealth {
  /** True when the supervised runtime child is currently alive. */
  isAlive(): boolean;
}

/**
 * The narrow cancel capability the session service needs from the {@link
 * import("../provider/index.js").ProviderPort} (S3). Cancel is ALWAYS routed through this
 * seam so output stops at the runtime source; `ProviderPort` satisfies it structurally.
 */
export interface StreamCanceller {
  /** Abort an in-flight runtime stream (S3). */
  cancel(handle: StreamHandle): Promise<void>;
}
