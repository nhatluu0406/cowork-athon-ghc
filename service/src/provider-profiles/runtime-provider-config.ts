/**
 * Runtime provider config resolver — maps profiles to OpenCode / ProviderPort shapes.
 */

import type { ModelRef } from "@cowork-ghc/contracts";
import type { OpencodeProviderConfig } from "../runtime/opencode-config.js";
import { CUSTOM_OPENAI_COMPAT_ID } from "../provider/descriptors.js";
import type { ProviderProfile } from "./types.js";
import { RUNTIME_ADAPTER_ID } from "./presets.js";

export interface ResolvedRuntimeProvider {
  readonly runtimeProviderId: string;
  readonly model: ModelRef;
  readonly baseUrl: string;
  readonly envVar: string;
  readonly displayName: string;
  readonly modelId: string;
  readonly opencode: OpencodeProviderConfig;
}

export function runtimeProviderIdForProfile(_profileId: string): string {
  return RUNTIME_ADAPTER_ID;
}

/** Resolve a profile into runtime wiring (non-secret). */
export function resolveRuntimeProviderConfig(profile: ProviderProfile): ResolvedRuntimeProvider {
  const runtimeProviderId = runtimeProviderIdForProfile(profile.id);
  const model: ModelRef = {
    providerID: runtimeProviderId,
    modelID: profile.modelId,
  };
  return {
    runtimeProviderId,
    model,
    baseUrl: profile.baseUrl,
    envVar: profile.envVar,
    displayName: profile.displayName,
    modelId: profile.modelId,
    opencode: {
      providerId: runtimeProviderId,
      displayName: profile.displayName,
      envVar: profile.envVar,
      models: [profile.modelId],
      baseUrl: profile.baseUrl,
    },
  };
}

/** Legacy model ref used before profiles existed. */
export function legacyFallbackModelRef(
  providerId: string | undefined,
  modelId: string | undefined,
): ModelRef | undefined {
  if (providerId === undefined || modelId === undefined) return undefined;
  if (providerId.trim().length === 0 || modelId.trim().length === 0) return undefined;
  return { providerID: providerId, modelID: modelId };
}

/** Deterministic snapshot fallback for conversations without profile snapshot. */
export function conversationSnapshotFallback(record: {
  readonly providerSnapshot?: {
    readonly profileId: string;
    readonly displayName: string;
    readonly providerType: ProviderProfile["providerType"];
    readonly modelId: string;
    readonly baseUrl: string;
  };
  readonly providerId?: string;
  readonly modelId?: string;
  readonly model?: ModelRef;
}): {
  readonly profileId?: string;
  readonly displayName: string;
  readonly providerType: ProviderProfile["providerType"];
  readonly modelId: string;
  readonly baseUrl: string;
} | undefined {
  if (record.providerSnapshot !== undefined) {
    return record.providerSnapshot;
  }
  const modelId = record.model?.modelID ?? record.modelId;
  const providerId = record.model?.providerID ?? record.providerId;
  if (modelId === undefined) return undefined;
  const isDeepSeek =
    providerId === CUSTOM_OPENAI_COMPAT_ID && modelId.toLowerCase().includes("deepseek");
  return {
    displayName: isDeepSeek ? "DeepSeek" : "Provider",
    providerType: isDeepSeek ? "deepseek" : "custom-openai-compat",
    modelId,
    baseUrl: "",
  };
}
