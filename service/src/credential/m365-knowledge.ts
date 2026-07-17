/**
 * `m365-knowledge` credential kind (REQ-205 T1.4/T1.6, ADR 0006 SEC-1/SEC-2).
 *
 * The bundled M365 Knowledge-Graph backend authenticates with a bearer token. This module is a
 * thin, ADDITIVE wrapper over the ONE {@link CredentialService} + {@link CredentialStore} every
 * other credential uses — it introduces NO second storage mechanism. The raw token lives only in
 * the OS store; callers get a secret-free {@link CredentialRef} handle and resolve the value ONLY
 * at the live-call boundary (`knowledge-service.ts`), where {@link CredentialService.resolveInjection}
 * registers it with the shared secret scrubber BEFORE it is returned, so it can never leak into a
 * log line, error message, or JSON-serialized response.
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import type { ProviderEnvSpec } from "@cowork-ghc/runtime";
import type { CredentialService } from "./credential-service.js";
import { credentialAccountFor, credentialRef } from "./store.js";

/** The provider id under which the M365KG token is stored (`provider:m365-knowledge` account). */
export const M365_KNOWLEDGE_PROVIDER_ID = "m365-knowledge" as const;

/**
 * The env-var spec the token resolves against. The M365KG token is passed to the backend as a
 * bearer header by `m365kg-client.ts` (never spawned into a child), so this spec only exists to
 * label the value for the shared scrubber at the injection boundary — the var name is non-secret.
 */
const M365_KNOWLEDGE_ENV_SPEC: ProviderEnvSpec = {
  providerId: M365_KNOWLEDGE_PROVIDER_ID,
  primaryEnvVar: "M365_KNOWLEDGE_TOKEN",
  acceptedEnvVars: ["M365_KNOWLEDGE_TOKEN"],
  requiresBaseUrl: true,
};

/** The stable store account for the M365KG token: `provider:m365-knowledge`. */
export function m365KnowledgeAccount(): string {
  return credentialAccountFor(M365_KNOWLEDGE_PROVIDER_ID);
}

/** The secret-free handle for the M365KG token (`{ store: "os", account }`). */
export function m365KnowledgeCredentialRef(): CredentialRef {
  return credentialRef(m365KnowledgeAccount());
}

/** Store the raw M365KG token; returns ONLY a handle. The value stays in the OS store. */
export function storeM365KnowledgeToken(service: CredentialService, token: string): Promise<CredentialRef> {
  return service.store({ providerId: M365_KNOWLEDGE_PROVIDER_ID, secret: token });
}

/** True when a token is stored for `ref` (no value is exposed). */
export function hasM365KnowledgeToken(service: CredentialService, ref: CredentialRef): Promise<boolean> {
  return service.has(ref);
}

/**
 * Resolve the raw token — the SOLE point it leaves the store. Goes through
 * {@link CredentialService.resolveInjection} so the value is registered with the shared scrubber
 * before it is returned. Rejects with a secret-free `CredentialNotFoundError` for a dangling ref.
 */
export async function resolveM365KnowledgeToken(service: CredentialService, ref: CredentialRef): Promise<string> {
  const injection = await service.resolveInjection(ref, M365_KNOWLEDGE_ENV_SPEC);
  return injection.value;
}

/** Remove the stored token; `true` when one existed. */
export function removeM365KnowledgeToken(service: CredentialService, ref: CredentialRef): Promise<boolean> {
  return service.remove(ref);
}
