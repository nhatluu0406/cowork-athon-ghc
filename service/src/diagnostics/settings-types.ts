/**
 * Settings data model (CGHC-022, SD1). The service-owned, DURABLE shape for general +
 * provider settings and the default-model preference. It is the persistent SOURCE OF TRUTH
 * for these values (SD4) — never `localStorage`, never renderer state.
 *
 * Secret discipline (SEC-1 / PR9): a provider entry references a {@link CredentialRef}
 * HANDLE only — there is deliberately NO field that can carry raw key bytes. The key stays
 * in the OS credential store (CGHC-009) and is resolved late at the execution boundary. The
 * `baseUrl` for the custom endpoint is non-secret and safe to persist (ADR 0005:48).
 *
 * `SETTINGS_SCHEMA_VERSION` tags the on-disk shape so a corrupt/older file can be migrated
 * or recovered to a safe default (SD5) rather than crashing the service.
 */

import type { CredentialRef, ModelRef, ProviderId } from "@cowork-ghc/contracts";

/** Current on-disk settings schema version. Bump when the persisted shape changes. */
export const SETTINGS_SCHEMA_VERSION = 3;

/** UI theme preference. Non-secret. */
export type ThemePreference = "system" | "light" | "dark";

/** General (non-provider) settings. All non-secret. */
export interface GeneralSettings {
  readonly theme: ThemePreference;
  /** Whether verbose diagnostics logging is enabled (does NOT affect redaction; SD3). */
  readonly verboseLogging: boolean;
  /** Whether local, non-secret telemetry is enabled. */
  readonly telemetryEnabled: boolean;
}

/**
 * Per-provider persisted settings. Carries a credential HANDLE only (never a key) plus the
 * non-secret custom `base_url`. Absent `credentialRef` means the provider has no bound key.
 */
export interface ProviderSettingsEntry {
  readonly providerId: ProviderId;
  /** Handle into the OS credential store — NEVER key bytes. Absent when unbound. */
  readonly credentialRef?: CredentialRef;
  /** Custom OpenAI-compatible endpoint base_url (non-secret). Absent for built-ins. */
  readonly baseUrl?: string;
  /**
   * The environment-variable NAME under which the child receives the resolved key for a
   * custom OpenAI-compatible provider (non-secret — this is the variable name, NEVER the
   * key value). Absent for built-ins. The key itself stays in the OS credential store and
   * is resolved late at the execution boundary.
   */
  readonly envVar?: string;
}

/** The granted workspace root the user selected (non-secret path). */
export interface ActiveWorkspace {
  readonly rootPath: string;
}

/** The persisted default-model preference (the SSOT for the default model; SD4). */
export interface ModelPreference {
  /** The default model applied when a session has no override. Absent when unset. */
  readonly default?: ModelRef;
}

/** Persisted provider profile (secret-free; credential is a handle only). */
export interface PersistedProviderProfile {
  readonly id: string;
  readonly displayName: string;
  readonly providerType: "deepseek" | "custom-openai-compat";
  readonly baseUrl: string;
  readonly modelId: string;
  readonly envVar: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly credentialRef?: CredentialRef;
  readonly presetId?: string;
}

/** The complete, versioned settings document persisted by the service. */
export interface CoworkSettings {
  readonly version: number;
  readonly general: GeneralSettings;
  readonly providers: readonly ProviderSettingsEntry[];
  readonly modelPreference: ModelPreference;
  /** Phase 1 multi-provider profiles. */
  readonly providerProfiles?: readonly PersistedProviderProfile[];
  /** Active profile id at application level. */
  readonly activeProfileId?: string;
  /** Idempotent legacy migration marker. */
  readonly providerProfilesMigrated?: boolean;
  /** The granted workspace root the user selected. Absent until one is granted. */
  readonly activeWorkspace?: ActiveWorkspace;
}

/** The safe general defaults used on first run and on corrupt recovery. */
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = Object.freeze({
  theme: "system",
  verboseLogging: false,
  telemetryEnabled: false,
});

/** A fresh, valid settings document. Used on first run and as the SD5 safe default. */
export function defaultSettings(): CoworkSettings {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    general: { ...DEFAULT_GENERAL_SETTINGS },
    providers: [],
    providerProfiles: [],
    modelPreference: {},
  };
}
