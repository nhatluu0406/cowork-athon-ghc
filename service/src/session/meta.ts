/**
 * Light session-metadata mapping (CGHC-013, S1). Pure + secret-free: turns a
 * {@link StoredSession} (from the OpenCode store) plus the current authoritative status
 * into the {@link SessionMeta} the app persists/renders. NO transcript or content is
 * copied — the runtime store remains the single source of truth for that.
 */

import type { SessionMeta, SessionStatus } from "@cowork-ghc/contracts";
import type { StoredSession } from "./seams.js";

/**
 * Build the app-side light metadata for a stored session at a given status. `model` is a
 * secret-free {@link import("@cowork-ghc/contracts").ModelRef} handle; it is only included
 * when present (exactOptionalPropertyTypes).
 */
export function toSessionMeta(stored: StoredSession, status: SessionStatus): SessionMeta {
  return {
    id: stored.id,
    title: stored.title,
    workspaceId: stored.workspaceId,
    status,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    ...(stored.model ? { model: stored.model } : {}),
  };
}
