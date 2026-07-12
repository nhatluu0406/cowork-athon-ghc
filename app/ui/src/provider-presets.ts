/**
 * UI-only provider quick-setup presets (Slice 3). Provider-neutral at the domain boundary:
 * each preset maps to the existing custom OpenAI-compatible descriptor + non-secret settings.
 */

import type { ModelRef } from "@cowork-ghc/contracts";

/** The shared custom OpenAI-compatible provider id (matches service descriptors). */
export const CUSTOM_OPENAI_COMPAT_ID = "custom-openai-compat";

export interface ProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly baseUrl: string;
  readonly envVar: string;
  readonly models: readonly { readonly ref: ModelRef; readonly label: string }[];
}

export const DEEPSEEK_PRESET: ProviderPreset = {
  id: "deepseek",
  label: "DeepSeek",
  providerId: CUSTOM_OPENAI_COMPAT_ID,
  baseUrl: "https://api.deepseek.com/v1",
  envVar: "DEEPSEEK_API_KEY",
  models: [
    {
      ref: { providerID: CUSTOM_OPENAI_COMPAT_ID, modelID: "deepseek-chat" },
      label: "DeepSeek Chat",
    },
  ],
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [DEEPSEEK_PRESET];

export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
