/**
 * M365 Knowledge Graph credential kind (REQ-205 T1.6, D4).
 *
 * The `m365-knowledge` credential kind stores the M365KG API token (JWT, or Entra ID
 * access/refresh token) via the existing {@link CredentialService} + Windows keyring backend
 * (`@napi-rs/keyring`), reusing the EXACT same store/resolve/remove flow that provider
 * credentials use. No second mechanism; no plaintext storage.
 *
 * The raw token NEVER:
 * - appears in the persisted JSON config (only the `CredentialRef` handle does)
 * - is logged or returned in an HTTP response
 * - enters the renderer
 * - is registered with the app scrubber UNLESS it is being resolved for use
 *
 * This module exports helper functions called by `knowledge-service.ts` to manage the token
 * lifecycle; `CredentialService` is the single point of store access.
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import type { CredentialService } from "./credential-service.js";
import { credentialAccountFor, credentialRef } from "./store.js";

/** The stable provider ID for M365KG credentials. */
export const M365_KNOWLEDGE_PROVIDER_ID = "m365-knowledge" as const;

/**
 * Stable keyring account handle for the M365KG credential. Deterministic across app
 * launches so the persisted `CredentialRef` always points to the same account.
 */
export function m365KnowledgeAccount(): string {
  return credentialAccountFor(M365_KNOWLEDGE_PROVIDER_ID);
}

/**
 * Build the `CredentialRef` handle for the M365KG credential. Does not create or validate
 * anything — just the handle shape (same as `credentialRef(m365KnowledgeAccount())`).
 */
export function m365KnowledgeCredentialRef(): CredentialRef {
  return credentialRef(m365KnowledgeAccount());
}

/**
 * Store the raw M365KG token in the keyring. The caller is responsible for not logging
 * or serializing the `token` argument — this function never logs/exposes it.
 * Returns the secret-free handle to be persisted in `KnowledgeSourceConfig`.
 */
export async function storeM365KnowledgeToken(
  service: CredentialService,
  token: string,
): Promise<CredentialRef> {
  return service.store({
    providerId: M365_KNOWLEDGE_PROVIDER_ID,
    secret: token,
  });
}

/**
 * Resolve the M365KG token from the keyring for a persisted handle.
 * This is the SOLE point the token leaves the store and is exposed to a caller.
 * The value is registered with the scrubber (so it gets masked in logs, errors, diagnostics).
 *
 * Throws {@link CredentialNotFoundError} if the ref is dangling (cleared or corrupted).
 */
export async function resolveM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef,
): Promise<string> {
  return service.resolveValue(ref);
}

/**
 * Check whether a persisted M365KG credential handle points to a stored entry.
 * Does not expose the value — the answer is just boolean.
 */
export async function hasM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef,
): Promise<boolean> {
  return service.has(ref);
}

/**
 * Remove the stored M365KG token for a persisted handle. Idempotent — returns `true`
 * if an entry existed and was removed, `false` otherwise.
 */
export async function removeM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef,
): Promise<boolean> {
  return service.remove(ref);
}
