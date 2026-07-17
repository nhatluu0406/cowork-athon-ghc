/**
 * Factory for the real HTTP provider connector used by settings-only onboarding (CGHC-011).
 *
 * Test connection does NOT require an OpenCode child — only the loopback credential service,
 * SSRF policy, and the IP-pinned probe. Tier 2 streaming still uses the same connector seam
 * when live; until then `probe` is fully functional for onboarding.
 */

import type { ModelRef, ProviderId } from "@cowork-ghc/contracts";
import type { CredentialService } from "../credential/index.js";
import type { SettingsStore } from "../diagnostics/index.js";
import {
  createHttpConnector,
  createProviderPort,
  createSsrfPolicy,
  providerEnvSpec,
  isCustomEndpoint,
  readE2eMockLlmBaseUrl,
  type DnsResolver,
  type ProviderConnector,
  type ProviderPort,
  type SsrfPolicy,
} from "../provider/index.js";

export interface HttpConnectorBundle {
  readonly ssrf: SsrfPolicy;
  readonly providerPort: ProviderPort;
  readonly connector: ProviderConnector;
  readonly bindActiveModelResolver: (resolver: () => ModelRef | undefined) => void;
}

/** Wire the SSRF policy, provider port, and HTTP probe connector (lazy credential lookup). */
export function createHttpConnectorBundle(
  credentialService: CredentialService,
  settingsStore: SettingsStore,
  dnsResolver: DnsResolver,
  /**
   * Developer-only loopback-http override, resolved ONCE by the caller (compose-service.ts) from
   * process env — never read here directly, so this stays a pure function of its inputs.
   */
  loopbackEscape = false,
): HttpConnectorBundle {
  const e2eMockLlmBaseUrl = readE2eMockLlmBaseUrl();
  const ssrf = createSsrfPolicy({
    resolver: dnsResolver,
    ...(e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl } : {}),
    ...(loopbackEscape ? { loopbackEscape: true } : {}),
  });
  let activeModelFor: () => ModelRef | undefined = () => undefined;
  let port!: ProviderPort;
  const connector = createHttpConnector({
    ssrf,
    credentials: credentialService,
    credentialRefFor: (id) => port.credentialRefFor(id),
    activeModelFor: () => activeModelFor(),
    envSpecFor: (id: ProviderId) => {
      if (isCustomEndpoint(id)) {
        const envVar = settingsStore.providerSettings(id)?.envVar;
        return providerEnvSpec(id, envVar);
      }
      return providerEnvSpec(id);
    },
  });
  port = createProviderPort({ ssrf, connector });
  return {
    ssrf,
    providerPort: port,
    connector,
    bindActiveModelResolver: (resolver) => {
      activeModelFor = resolver;
    },
  };
}
