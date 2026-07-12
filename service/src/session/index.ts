/**
 * `@cowork-ghc/service` session module — the ONE session mechanism (CGHC-013, S1/S3/S4/S6).
 *
 * Owns light, secret-free session metadata + the authoritative runtime view over the
 * OpenCode store (the content source of truth). Local barrel; the top-level service barrel
 * (`service/src/index.ts`) is owned by the orchestrator. Downstream:
 *  - CGHC-014 (two-hop SSE + resync) drives `apply` with mapped EV events, calls
 *    `bindStream` with the runtime {@link import("../provider/index.js").StreamHandle}, and
 *    returns `view(sessionId)` (a {@link import("../execution/index.js").SessionView}) on
 *    resync.
 *  - CGHC-016 (permission) adds the `waiting_approval` transition (an EV the reducer folds)
 *    and a `denied` terminal; the cancel gate + status derivation here already accommodate
 *    both without change.
 */

export {
  createSessionService,
  type SessionService,
  type SessionServiceOptions,
  type ReopenedSession,
} from "./session-service.js";

export {
  createTaskRegistry,
  type TaskRegistry,
  type TaskRegistryOptions,
} from "./task-registry.js";

export { toSessionMeta } from "./meta.js";

export {
  createSessionRouter,
  SessionRequestError,
  SESSION_PATH,
  SESSION_MESSAGE_PATH,
  SESSION_CANCEL_PATH,
  type SendPrompt,
} from "./router.js";

export type {
  StoredSession,
  CreateSessionInput,
  SessionStore,
  RuntimeHealth,
  StreamCanceller,
} from "./seams.js";
