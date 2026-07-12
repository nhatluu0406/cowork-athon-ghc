/**
 * Settings diagnostics export (CGHC-022, SD4). Produces a truthful, NON-SECRET snapshot of
 * the current settings for a support bundle / troubleshooting view, exported through the
 * SAME value-based scrubber CGHC-021 owns — so a registered secret value can never surface
 * in the artifact even if one somehow reached a settings field.
 *
 * By construction the settings document holds no key bytes (a provider references a
 * {@link import("@cowork-ghc/contracts").CredentialRef} HANDLE only). This export adds a
 * second, defense-in-depth guarantee: it reuses {@link SecretScrubber} rather than
 * re-implementing redaction (task constraint) and re-scrubs every string on the way out,
 * so a planted secret-shaped value in ANY string field is redacted to the fixed placeholder.
 */

import type { CoworkSettings } from "./settings-types.js";
import type { SecretScrubber } from "./secret-scrubber.js";
import type { SettingsRecoveryReason, SettingsSource } from "./settings-recovery.js";

/** A truthful, non-secret settings snapshot for diagnostics. Credential handles only. */
export interface SettingsDiagnostics {
  readonly version: number;
  readonly general: CoworkSettings["general"];
  /** Per-provider: whether a credential is bound + the non-secret account label + base_url. */
  readonly providers: readonly {
    readonly providerId: string;
    readonly hasCredential: boolean;
    /** The non-secret credential-store account label (the handle), when bound. */
    readonly credentialAccount?: string;
    readonly baseUrl?: string;
  }[];
  /** Whether a default model is configured, and its non-secret ref when present. */
  readonly defaultModel: CoworkSettings["modelPreference"]["default"] | null;
  /** SD5 provenance so a support bundle shows if settings were recovered. */
  readonly loadSource: SettingsSource;
  readonly recoveryReason?: SettingsRecoveryReason;
}

export interface SettingsDiagnosticsInputs {
  readonly settings: CoworkSettings;
  readonly loadSource: SettingsSource;
  readonly recoveryReason?: SettingsRecoveryReason;
}

/** Compose the structured (still-to-be-scrubbed) settings diagnostics snapshot. */
export function composeSettingsDiagnostics(input: SettingsDiagnosticsInputs): SettingsDiagnostics {
  const providers = input.settings.providers.map((p) => ({
    providerId: p.providerId,
    hasCredential: p.credentialRef !== undefined,
    ...(p.credentialRef !== undefined ? { credentialAccount: p.credentialRef.account } : {}),
    ...(p.baseUrl !== undefined ? { baseUrl: p.baseUrl } : {}),
  }));
  return {
    version: input.settings.version,
    general: input.settings.general,
    providers,
    defaultModel: input.settings.modelPreference.default ?? null,
    loadSource: input.loadSource,
    ...(input.recoveryReason !== undefined ? { recoveryReason: input.recoveryReason } : {}),
  };
}

/**
 * Export the settings diagnostics as scrubbed JSON. `scrubJson` runs every raw string
 * through the registered secret scrubber during serialization, so a planted secret value
 * is replaced by the fixed placeholder in every string-valued field of the returned JSON.
 */
export function exportSettingsDiagnosticsJson(
  input: SettingsDiagnosticsInputs,
  scrubber: SecretScrubber,
  space = 2,
): string {
  return scrubber.scrubJson(composeSettingsDiagnostics(input), space);
}
