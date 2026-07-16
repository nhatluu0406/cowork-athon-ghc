/**
 * Per-profile connection tester — isolated probe results by profile id.
 */

import type { ProviderError, TestResult } from "@cowork-ghc/contracts";
import type { CredentialService } from "../credential/index.js";
import {
  CrossHostRedirectError,
  createHttpConnector,
  createProviderPort,
  createSsrfPolicy,
  SsrfBlockedError,
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
  /**
   * Developer-only loopback-http override (see `../provider/dev-loopback-http.js`). Sourced ONLY
   * from process env at the composition root — never from a request. Defaults to `false`.
   */
  readonly loopbackEscape?: boolean;
}

const ENDPOINT_POLICY_ERROR: ProviderError = {
  kind: "unavailable",
  message: "The provider endpoint is invalid or not allowed by the connection policy.",
  retryable: false,
  recovery: "Check the base URL and test again.",
};

const REDIRECT_POLICY_ERROR: ProviderError = {
  kind: "unavailable",
  message: "The provider redirected the connection to an endpoint that is not allowed.",
  retryable: false,
  recovery: "Check the base URL or provider configuration and test again.",
};

function recoverableProfileTestResult(error: unknown): TestResult | undefined {
  if (error instanceof SsrfBlockedError) {
    return { ok: false, error: ENDPOINT_POLICY_ERROR };
  }
  if (error instanceof CrossHostRedirectError) {
    return { ok: false, error: REDIRECT_POLICY_ERROR };
  }
  return undefined;
}

export function createProviderConnectionTester(
  options: ProviderConnectionTesterOptions,
): ProviderConnectionTester {
  const results = new Map<string, ProfileConnectionTestState>();
  const clock = options.now ?? (() => new Date().toISOString());
  const ssrf = createSsrfPolicy({
    resolver: options.dnsResolver,
    ...(options.e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl: options.e2eMockLlmBaseUrl } : {}),
    ...(options.loopbackEscape === true ? { loopbackEscape: true } : {}),
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
      function record(result: TestResult): TestResult {
        results.set(profile.id, {
          profileId: profile.id,
          testedAt: clock(),
          ok: result.ok,
          ...(result.ok || result.error?.message === undefined
            ? {}
            : { errorMessage: result.error.message }),
        });
        return result;
      }

      if (profile.credentialRef === undefined) {
        return record({
          ok: false,
          error: {
            kind: "auth_invalid",
            message: "Credential is not configured for this profile.",
            retryable: false,
            recovery: "Configure API key.",
          },
        });
      }
      const port = portForProfile(profile);
      try {
        return record(await port.testConnection(CUSTOM_OPENAI_COMPAT_ID));
      } catch (error) {
        const recoverable = recoverableProfileTestResult(error);
        if (recoverable !== undefined) return record(recoverable);
        throw error;
      }
    },

    lastResultFor(profileId) {
      return results.get(profileId);
    },
  };
}
