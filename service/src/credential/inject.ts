/**
 * Inject-at-launch glue (ADR 0006 SEC-1, "HARD CONSTRAINT").
 *
 * Composes the credential service with the runtime launch seam: resolve each provider
 * handle to a `{ envVar, value }` injection and hand them to the runtime's pure
 * `buildLaunchSpec`, which places keys into the child spawn env ONLY (never a file). This
 * module owns NO disk writes and never calls OpenCode's `c.auth.set`/`auth.json`/`env.json`.
 *
 * Redaction: the resolved `RuntimeLaunchSpec.env` carries plaintext (in-memory, per launch)
 * and MUST NOT be logged; `redactedEnvSnapshot` (CGHC-001, value-based) is the only log-safe
 * view. `envMapContainsNoSecret` proves a snapshot leaked no key value.
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import {
  buildLaunchSpec,
  redactedEnvSnapshot,
  type BuildLaunchSpecOptions,
  type ProviderEnvSpec,
  type ProviderKeyInjection,
  type RuntimeLaunchSpec,
} from "@cowork-ghc/runtime";
import type { CredentialService } from "./credential-service.js";

/** A request to resolve one provider's stored credential into a launch injection. */
export interface CredentialInjectionRequest {
  readonly ref: CredentialRef;
  readonly spec: ProviderEnvSpec;
}

/**
 * Resolve every request to a `{ envVar, value }` injection. This is the boundary at which
 * key values leave the OS store; the caller passes the result straight to a spawn env.
 */
export async function resolveInjections(
  service: CredentialService,
  requests: readonly CredentialInjectionRequest[],
): Promise<ProviderKeyInjection[]> {
  const injections: ProviderKeyInjection[] = [];
  for (const request of requests) {
    injections.push(await service.resolveInjection(request.ref, request.spec));
  }
  return injections;
}

/** Options to build a launch spec whose provider keys come from the credential store. */
export interface LaunchWithCredentialsOptions {
  readonly service: CredentialService;
  readonly requests: readonly CredentialInjectionRequest[];
  /** Everything except `providerKeys`, which this helper resolves from the store. */
  readonly launch: Omit<BuildLaunchSpecOptions, "providerKeys">;
}

/**
 * Resolve stored credentials and build a spawn-ready {@link RuntimeLaunchSpec} with the
 * keys injected as env vars. The returned spec's `env`/`secretValues` are plaintext and
 * must never be logged — use {@link redactedLaunchEnv} for any log/diagnostics view.
 */
export async function buildLaunchSpecWithCredentials(
  options: LaunchWithCredentialsOptions,
): Promise<RuntimeLaunchSpec> {
  const providerKeys = await resolveInjections(options.service, options.requests);
  return buildLaunchSpec({ ...options.launch, providerKeys });
}

/** Log-safe view of a launch spec's env (secret VALUES replaced by `<redacted>`). */
export function redactedLaunchEnv(spec: RuntimeLaunchSpec): Record<string, string> {
  return redactedEnvSnapshot(spec);
}
