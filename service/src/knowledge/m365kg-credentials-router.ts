/**
 * Loopback route: authenticated endpoint the Electron shell calls AFTER `connectLive` to
 * retrieve the active provider's API key for injecting into the M365KG llm-svc spawn env.
 *
 * Security discipline:
 * - Token-guarded (no `publicUnauthenticated`): only the shell's per-launch client token
 *   can call this route.
 * - The raw key is returned ONLY across the private 127.0.0.1 loopback channel to the SAME
 *   process (the Electron shell) for child-process spawn-env injection — the same boundary
 *   the OpenCode supervisor crosses for its own credential injection.
 * - Never logged; the caller's `resolveClaude` keeps it in memory only.
 *
 * Late-binding pattern: `getCredentialService` and `getProviderProfileStore` are closures
 * populated AFTER `createCoworkService` returns but BEFORE the socket opens — so every
 * request sees the real live deps, never null.
 */

import type { BoundaryRouter } from "../boundary/contract.js";
import type { CredentialService } from "../credential/index.js";
import type { ProviderProfileStore } from "../provider-profiles/provider-profile-store.js";
import type { SettingsStore } from "../diagnostics/settings-store.js";
import { customOpenAiCompatibleEnv } from "@cowork-ghc/runtime";

export const M365KG_CREDENTIALS_PATH = "/api/m365kg/credentials" as const;

export function createM365KGCredentialsRouter(
  getCredentialService: () => CredentialService | null,
  getProviderProfileStore: () => ProviderProfileStore | null,
  getSettingsStore?: () => SettingsStore | null,
): BoundaryRouter {
  return {
    name: "m365kg-credentials",
    routes: [
      {
        method: "GET",
        path: M365KG_CREDENTIALS_PATH,
        handler: async () => {
          const credService = getCredentialService();
          const profileStore = getProviderProfileStore();
          if (credService === null || profileStore === null) {
            return { status: 503, data: { error: "service_not_ready" } };
          }

          const profile = profileStore.activeProfile();
          if (profile === undefined || profile.credentialRef === undefined) {
            return { status: 404, data: { error: "no_active_provider" } };
          }

          // Read embedding settings (non-secret model identifiers).
          const general = getSettingsStore?.()?.general();
          const embeddingMode = general?.embeddingMode ?? "cloud";
          const embeddingModelId = general?.embeddingModelId ?? "text-embedding-3-small";

          try {
            const spec = customOpenAiCompatibleEnv({
              providerId: profile.providerType,
              envVar: profile.envVar,
            });
            const injection = await credService.resolveInjection(profile.credentialRef, spec);
            return {
              status: 200,
              data: {
                claudeApiKey: injection.value,
                claudeBaseUrl: profile.baseUrl,
                embeddingMode,
                embeddingModelId,
              },
            };
          } catch {
            return { status: 404, data: { error: "credential_not_found" } };
          }
        },
      },
    ],
  };
}
