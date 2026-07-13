/**
 * Per-profile connection tester — isolated probe results by profile id.
 */

import type { TestResult } from "@cowork-ghc/contracts";
import type { CredentialService } from "../credential/index.js";
import {
  createHttpConnector,
  createProviderPort,
  createSsrfPolicy,
  type DnsResolver,
  type ProviderPort,
} from "../provider/index.js";
import { CUSTOM_OPENAI_COMPAT_ID } from "../provider/descriptors.js";
import { providerEnvSpec } from "../provider/descriptors.js";
import type { ProviderProfile } from "./types.js";
import type { ProfileConnectionTestState } from "./types.js";
import { resolveRuntimeProviderConfig } from "./runtime-provider-config.js";

export interface ProviderConnectionTester {
  testProfile(profile: ProviderProfile): Promise<TestResult>;
  lastResultFor(profileId: string): ProfileConnectionTestState | undefined;
}

export interface ProviderConnectionTesterOptions {
  readonly credentials: CredentialService;
  readonly dnsResolver: DnsResolver;
  readonly now?: () => string;
  readonly e2eMockLlmBaseUrl?: string;
}

export function createProviderConnectionTester(
  options: ProviderConnectionTesterOptions,
): ProviderConnectionTester {
  const results = new Map<string, ProfileConnectionTestState>();
  const clock = options.now ?? (() => new Date().toISOString());
  const ssrf = createSsrfPolicy({
    resolver: options.dnsResolver,
    ...(options.e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl: options.e2eMockLlmBaseUrl } : {}),
  });

  function portForProfile(profile: ProviderProfile): ProviderPort {
    const resolved = resolveRuntimeProviderConfig(profile);
    const credentialRef = profile.credentialRef;
    const connector = createHttpConnector({
      ssrf,
      credentials: options.credentials,
      credentialRefFor: () => credentialRef,
      activeModelFor: () => resolved.model,
      envSpecFor: () => providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, profile.envVar),
    });
    const port = createProviderPort({ ssrf, connector });
    return {
      ...port,
      async configureEndpoint(id, input) {
        if (id !== CUSTOM_OPENAI_COMPAT_ID) {
          throw new Error(`Unexpected provider id ${id}`);
        }
        await port.configureEndpoint(id, input);
      },
      list: port.list,
      describe: port.describe,
      configureCredential(id, ref) {
        port.configureCredential(id, ref);
      },
      credentialRefFor: () => credentialRef,
      removeCredential: port.removeCredential,
      baseUrlFor: () => profile.baseUrl,
      configureModel: port.configureModel,
      clearModel: port.clearModel,
      modelSelection: () => resolved.model,
      guardedConnect: port.guardedConnect,
      testConnection: async (id) => {
        await port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: profile.baseUrl });
        if (credentialRef !== undefined) {
          port.configureCredential(CUSTOM_OPENAI_COMPAT_ID, credentialRef);
        }
        port.configureModel({ scope: "default", model: resolved.model });
        return port.testConnection(id);
      },
      cancel: port.cancel,
      mapError: port.mapError,
      redactionPatterns: port.redactionPatterns,
    };
  }

  return {
    async testProfile(profile) {
      if (profile.credentialRef === undefined) {
        const state: ProfileConnectionTestState = {
          profileId: profile.id,
          testedAt: clock(),
          ok: false,
          errorMessage: "Credential is not configured for this profile.",
        };
        results.set(profile.id, state);
        return { ok: false, error: { kind: "auth_invalid", message: "Credential is not configured for this profile.", retryable: false, recovery: "Configure API key." } };
      }
      const port = portForProfile(profile);
      const result = await port.testConnection(CUSTOM_OPENAI_COMPAT_ID);
      results.set(profile.id, {
        profileId: profile.id,
        testedAt: clock(),
        ok: result.ok,
        ...(result.ok || result.error?.message === undefined
          ? {}
          : { errorMessage: result.error.message }),
      });
      return result;
    },

    lastResultFor(profileId) {
      return results.get(profileId);
    },
  };
}
