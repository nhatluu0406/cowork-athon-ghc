/**
 * Phase 1 provider presets (DeepSeek + custom OpenAI-compatible factory).
 */

import { CUSTOM_OPENAI_COMPAT_ID } from "../provider/descriptors.js";
import type { CreateProviderProfileInput, ProviderProfileType } from "./types.js";
import { envVarSuffixForProfileId } from "./profile-id.js";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";
export const DEEPSEEK_PRESET_ID = "deepseek";

export const DEEPSEEK_MODEL_OPTIONS: readonly { readonly id: string; readonly label: string }[] =
  Object.freeze([
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ]);

export const FPT_CLOUD_BASE_URL = "https://api.fpt.ai/v1";
export const FPT_CLOUD_DEFAULT_MODEL = "gpt-4o-mini";
export const FPT_CLOUD_PRESET_ID = "fptcloud";

export const FPT_CLOUD_MODEL_OPTIONS: readonly { readonly id: string; readonly label: string }[] =
  Object.freeze([
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ]);

/** Runtime adapter id used for all Phase 1 OpenAI-compatible profiles. */
export const RUNTIME_ADAPTER_ID = CUSTOM_OPENAI_COMPAT_ID;

export function defaultEnvVarForProfile(profileId: string): string {
  return `COWORK_PF_${envVarSuffixForProfileId(profileId)}_KEY`;
}

export function defaultBaseUrlForType(providerType: ProviderProfileType): string {
  if (providerType === "deepseek") return DEEPSEEK_BASE_URL;
  if (providerType === "fptcloud") return FPT_CLOUD_BASE_URL;
  return "";
}

export function defaultModelForType(providerType: ProviderProfileType): string {
  if (providerType === "deepseek") return DEEPSEEK_DEFAULT_MODEL;
  if (providerType === "fptcloud") return FPT_CLOUD_DEFAULT_MODEL;
  return "";
}

export function defaultDisplayNameForType(providerType: ProviderProfileType): string {
  if (providerType === "deepseek") return "DeepSeek";
  if (providerType === "fptcloud") return "FPT Cloud";
  return "Custom provider";
}

export function isDeepSeekBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === "api.deepseek.com" || host.endsWith(".deepseek.com");
  } catch {
    return false;
  }
}

export function isFptCloudBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === "api.fpt.ai" || host.endsWith(".fpt.ai");
  } catch {
    return false;
  }
}

export function inferProviderTypeFromLegacy(
  baseUrl: string | undefined,
  modelId: string | undefined,
): ProviderProfileType {
  if (baseUrl !== undefined && isDeepSeekBaseUrl(baseUrl)) return "deepseek";
  if (baseUrl !== undefined && isFptCloudBaseUrl(baseUrl)) return "fptcloud";
  if (modelId !== undefined && modelId.toLowerCase().includes("deepseek")) return "deepseek";
  return "custom-openai-compat";
}

export function normalizeCreateInput(input: CreateProviderProfileInput): {
  readonly displayName: string;
  readonly providerType: ProviderProfileType;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly presetId?: string;
} {
  const providerType = input.providerType;
  const displayName =
    input.displayName.trim().length > 0
      ? input.displayName.trim()
      : defaultDisplayNameForType(providerType);
  const baseUrl =
    input.baseUrl !== undefined && input.baseUrl.trim().length > 0
      ? input.baseUrl.trim()
      : defaultBaseUrlForType(providerType);
  const modelId =
    input.modelId !== undefined && input.modelId.trim().length > 0
      ? input.modelId.trim()
      : defaultModelForType(providerType);
  if (baseUrl.length === 0) {
    throw new Error("baseUrl is required for custom OpenAI-compatible profiles.");
  }
  if (modelId.length === 0) {
    throw new Error("modelId is required.");
  }
  return {
    displayName,
    providerType,
    baseUrl,
    modelId,
    ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
  };
}

export function friendlyModelLabel(
  providerType: ProviderProfileType,
  modelId: string,
): string {
  if (providerType === "deepseek") {
    const match = DEEPSEEK_MODEL_OPTIONS.find((m) => m.id === modelId);
    return match?.label ?? modelId;
  }
  if (providerType === "fptcloud") {
    const match = FPT_CLOUD_MODEL_OPTIONS.find((m) => m.id === modelId);
    return match?.label ?? modelId;
  }
  return modelId;
}
