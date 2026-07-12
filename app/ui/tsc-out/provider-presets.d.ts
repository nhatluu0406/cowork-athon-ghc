/**
 * UI-only provider quick-setup presets (Slice 3). Provider-neutral at the domain boundary:
 * each preset maps to the existing custom OpenAI-compatible descriptor + non-secret settings.
 */
import type { ModelRef } from "@cowork-ghc/contracts";
/** The shared custom OpenAI-compatible provider id (matches service descriptors). */
export declare const CUSTOM_OPENAI_COMPAT_ID = "custom-openai-compat";
export interface ProviderPreset {
    readonly id: string;
    readonly label: string;
    readonly providerId: string;
    readonly baseUrl: string;
    readonly envVar: string;
    readonly models: readonly {
        readonly ref: ModelRef;
        readonly label: string;
    }[];
}
export declare const DEEPSEEK_PRESET: ProviderPreset;
export declare const PROVIDER_PRESETS: readonly ProviderPreset[];
export declare function presetById(id: string): ProviderPreset | undefined;
//# sourceMappingURL=provider-presets.d.ts.map