/**
 * m365-knowledge credential kind (D3 Knowledge module, REQ-205 T1.4, T1.6).
 *
 * Handles storage and retrieval of Microsoft Graph API tokens for Knowledge module.
 * Follows the same pattern as other credential kinds: account identifier → credential ref →
 * store/retrieve/remove via CredentialService.
 *
 * The token is NEVER stored as plaintext in SQLite or logs; it is persisted through
 * CredentialService which uses the OS keyring (Windows Credential Manager) and is
 * registered with SecretScrubber for log redaction.
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import type { CredentialService } from "./credential-service.js";
import { credentialRef } from "./store.js";

/**
 * Unique provider ID for Knowledge module credentials.
 * Used to distinguish this credential kind in the account namespace.
 */
export const M365_KNOWLEDGE_PROVIDER_ID = "m365-knowledge";

/**
 * Environment variable name for the m365-knowledge token.
 */
export const M365_KNOWLEDGE_ENV_VAR = "COWORK_M365_KNOWLEDGE_TOKEN";

/**
 * Returns the stable account identifier for m365-knowledge credentials.
 * Pattern: `provider:<PROVIDER_ID>`
 */
export function m365KnowledgeAccount(): string {
  return `provider:${M365_KNOWLEDGE_PROVIDER_ID}`;
}

/**
 * Builds a CredentialRef for m365-knowledge credentials.
 * Used to store and later retrieve the token via CredentialService.
 */
export function m365KnowledgeCredentialRef(): CredentialRef {
  return credentialRef(m365KnowledgeAccount());
}

/**
 * Stores an m365-knowledge token via CredentialService.
 *
 * @param service - The credential service (owns the store + scrubber)
 * @param token - The Microsoft Graph API token (will be stored securely, never logged)
 * @returns A CredentialRef handle; the handle never contains the raw token
 *
 * @throws {CredentialStoreError} if storage fails
 */
export async function storeM365KnowledgeToken(
  service: CredentialService,
  token: string
): Promise<CredentialRef> {
  return await service.store({
    providerId: M365_KNOWLEDGE_PROVIDER_ID,
    secret: token,
  });
}

/**
 * Checks whether an m365-knowledge token is currently stored.
 *
 * @param service - The credential service
 * @param ref - The credential ref (from storeM365KnowledgeToken or m365KnowledgeCredentialRef)
 * @returns true if a token is stored and retrievable; false otherwise
 */
export async function hasM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef
): Promise<boolean> {
  try {
    return await service.has(ref);
  } catch {
    return false;
  }
}

/**
 * Resolves the stored m365-knowledge token.
 *
 * Note: This is a specialized helper for the knowledge module (D3, not fully implemented).
 * It returns the raw token string for service-level use, unlike the standard CredentialService
 * API which is designed for launch-time injection. Future work should integrate with launch seam.
 *
 * @param service - The credential service
 * @param ref - The credential ref (from storeM365KnowledgeToken or m365KnowledgeCredentialRef)
 * @returns The raw token string, registered with SecretScrubber for log redaction
 *
 * @throws {CredentialNotFoundError} if no token is stored
 */
export async function resolveM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef
): Promise<string> {
  // Temporary implementation for service-level token retrieval.
  // TODO: Integrate with launch-time injection once knowledge module is fully scoped.
  // For now, resolve through the injection seam and extract the value.
  const injection = await service.resolveInjection(ref, {
    envVar: M365_KNOWLEDGE_ENV_VAR,
    kind: "plaintext"
  });
  return injection.value;
}

/**
 * Removes the stored m365-knowledge token.
 *
 * @param service - The credential service
 * @param ref - The credential ref
 * @returns true if a token was present and removed; false if no token was found
 */
export async function removeM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef
): Promise<boolean> {
  return await service.remove(ref);
}
