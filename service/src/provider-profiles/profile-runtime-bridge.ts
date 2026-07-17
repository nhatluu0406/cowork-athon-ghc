/**
 * Sync active provider profile into the runtime ProviderPort + default model (no restart).
 */

import type { ModelConfigService } from "../provider/model-config-service.js";
import type { ProviderPort } from "../provider/provider-port.js";
import { CUSTOM_OPENAI_COMPAT_ID } from "../provider/descriptors.js";
import type { ProviderProfileStore } from "./provider-profile-store.js";
import { resolveRuntimeProviderConfig } from "./runtime-provider-config.js";

export interface ProfileRuntimeBridge {
  syncActiveProfile(): Promise<void>;
  syncProfileById(profileId: string): Promise<void>;
}

export function createProfileRuntimeBridge(input: {
  readonly profiles: ProviderProfileStore;
  readonly port: ProviderPort;
  readonly modelConfig: ModelConfigService;
}): ProfileRuntimeBridge {
  async function applyProfile(profileId: string): Promise<void> {
    const profile = input.profiles.get(profileId);
    if (profile === undefined) return;
    const resolved = resolveRuntimeProviderConfig(profile);
    await input.port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: profile.baseUrl });
    if (profile.credentialRef !== undefined) {
      input.port.configureCredential(CUSTOM_OPENAI_COMPAT_ID, profile.credentialRef);
    } else {
      input.port.removeCredential(CUSTOM_OPENAI_COMPAT_ID);
    }
    input.modelConfig.configureModel({ scope: "default", model: resolved.model });
  }

  return {
    async syncActiveProfile() {
      const activeId = input.profiles.activeProfileId();
      if (activeId === undefined) return;
      await applyProfile(activeId);
    },
    syncProfileById: applyProfile,
  };
}
