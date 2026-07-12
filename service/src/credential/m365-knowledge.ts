/**
 * The `m365-knowledge` credential kind (REQ-205 D4, additive).
 *
 * NOT a new credential mechanism — this is one more `providerId` handled by the SAME
 * keyring-backed {@link CredentialService} every other credential (LLM provider keys) already
 * goes through (ADR 0006, one store). The M365 Knowledge Graph connection token is stored,
 * looked up, and removed exactly like a provider key; only the account label differs
 * (`provider:m365-knowledge`, via {@link credentialAccountFor}).
 *
 * `resolveM365KnowledgeToken` reuses {@link CredentialService.resolveInjection} (rather than a
 * bespoke store read) SPECIFICALLY so the resolved token value is registered with the shared
 * {@link SecretScrubber} before this module hands it back — the same defense-in-depth guarantee
 * every other credential gets (SEC-2). The `ProviderEnvSpec` passed here is never used to spawn
 * a child process or write an env file; it exists only to give the resolved value a non-secret
 * label for the scrubber/diagnostics path.
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import type { ProviderEnvSpec } from "@cowork-ghc/runtime";
import { credentialAccountFor, credentialRef } from "./store.js";
import type { CredentialService } from "./credential-service.js";

/** The `providerId` this integration's credential is stored under (D4's "kind"). */
export const M365_KNOWLEDGE_PROVIDER_ID = "m365-knowledge" as const;

/**
 * Non-secret label for the resolved token (diagnostics/scrubber only — never an actual env
 * var; the M365KG client sends the value as an `Authorization: Bearer` header, in-process).
 */
const M365_KNOWLEDGE_ENV_SPEC: ProviderEnvSpec = {
  providerId: M365_KNOWLEDGE_PROVIDER_ID,
  primaryEnvVar: "M365_KNOWLEDGE_TOKEN",
  acceptedEnvVars: ["M365_KNOWLEDGE_TOKEN"],
  requiresBaseUrl: false,
};

/** The stable keyring account for the one M365 Knowledge Graph connection (single workspace). */
export function m365KnowledgeAccount(): string {
  return credentialAccountFor(M365_KNOWLEDGE_PROVIDER_ID);
}

/** Build the {@link CredentialRef} handle for the M365 Knowledge Graph connection. */
export function m365KnowledgeCredentialRef(): CredentialRef {
  return credentialRef(m365KnowledgeAccount());
}

/** Store the raw connection token. Returns ONLY a handle — the value never comes back here. */
export function storeM365KnowledgeToken(
  service: CredentialService,
  token: string,
): Promise<CredentialRef> {
  return service.store({ providerId: M365_KNOWLEDGE_PROVIDER_ID, secret: token });
}

/** True when a token is currently stored for this ref (never exposes the value). */
export function hasM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef,
): Promise<boolean> {
  return service.has(ref);
}

/** Remove the stored token (R6 "Disconnect"). `true` when one existed. */
export function removeM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef,
): Promise<boolean> {
  return service.remove(ref);
}

/**
 * Resolve the raw token value — the SOLE point it leaves the store for this integration.
 * Registers the value with the shared scrubber first (via `resolveInjection`), then returns
 * it so the M365KG client can attach it as a Bearer header. Throws
 * {@link import("./store.js").CredentialNotFoundError} when the handle is dangling.
 */
export async function resolveM365KnowledgeToken(
  service: CredentialService,
  ref: CredentialRef,
): Promise<string> {
  const injection = await service.resolveInjection(ref, M365_KNOWLEDGE_ENV_SPEC);
  return injection.value;
}
