/**
 * Settings parse / migrate / recover (CGHC-022, SD5).
 *
 * The single, NEVER-THROWS entry point for turning raw persisted bytes into a usable
 * {@link CoworkSettings}. A corrupt or unparseable file MUST NOT crash the service: it
 * recovers to a SAFE DEFAULT and reports WHY, so the caller can surface a reset offer.
 *
 * Recovery ladder:
 *  - no file (first run)        → `source: "default"`   (not an error)
 *  - valid JSON, valid shape    → `source: "loaded"`    (migrated forward if older)
 *  - unparseable / invalid shape→ `source: "recovered"` + a non-secret `reason`
 *
 * Coercion is field-by-field and conservative: a present-but-invalid field falls back to
 * its default rather than rejecting the whole document, so a single bad field never wipes
 * otherwise-good settings. Unknown/extra fields are dropped (never trusted).
 */

import type { CredentialRef, ModelRef } from "@cowork-ghc/contracts";
import {
  DEFAULT_GENERAL_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  defaultSettings,
  type ActiveWorkspace,
  type CoworkSettings,
  type GeneralSettings,
  type ModelPreference,
  type ProviderSettingsEntry,
  type PersistedProviderProfile,
  type ThemePreference,
} from "./settings-types.js";

/** Where the loaded settings came from — drives the SD5 reset offer in the UI. */
export type SettingsSource = "default" | "loaded" | "recovered";

/** Non-secret reason a load fell back to a safe default. */
export type SettingsRecoveryReason = "unparseable" | "invalid_shape" | "empty";

/** Outcome of {@link recoverSettings}: always a usable document, plus provenance. */
export interface SettingsLoadResult {
  readonly settings: CoworkSettings;
  readonly source: SettingsSource;
  /** Present only when `source` is `"recovered"`. Non-secret. */
  readonly reason?: SettingsRecoveryReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

function coerceGeneral(raw: unknown): GeneralSettings {
  if (!isRecord(raw)) return { ...DEFAULT_GENERAL_SETTINGS };
  const theme = THEMES.includes(raw.theme as ThemePreference)
    ? (raw.theme as ThemePreference)
    : DEFAULT_GENERAL_SETTINGS.theme;
  return {
    theme,
    verboseLogging:
      typeof raw.verboseLogging === "boolean"
        ? raw.verboseLogging
        : DEFAULT_GENERAL_SETTINGS.verboseLogging,
    telemetryEnabled:
      typeof raw.telemetryEnabled === "boolean"
        ? raw.telemetryEnabled
        : DEFAULT_GENERAL_SETTINGS.telemetryEnabled,
  };
}

/** A CredentialRef is a HANDLE — reject anything carrying unexpected key-shaped fields. */
function coerceCredentialRef(raw: unknown): CredentialRef | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.store !== "os") return undefined;
  if (typeof raw.account !== "string" || raw.account.length === 0) return undefined;
  return { store: "os", account: raw.account };
}

function coerceModelRef(raw: unknown): ModelRef | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.providerID !== "string" || raw.providerID.length === 0) return undefined;
  if (typeof raw.modelID !== "string" || raw.modelID.length === 0) return undefined;
  return { providerID: raw.providerID, modelID: raw.modelID };
}

function coerceProvider(raw: unknown): ProviderSettingsEntry | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.providerId !== "string" || raw.providerId.length === 0) return undefined;
  const credentialRef = coerceCredentialRef(raw.credentialRef);
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl : undefined;
  // envVar is the non-secret variable NAME (never the key). A v1 entry omits it → undefined.
  const envVar =
    typeof raw.envVar === "string" && raw.envVar.length > 0 ? raw.envVar : undefined;
  return {
    providerId: raw.providerId,
    ...(credentialRef !== undefined ? { credentialRef } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(envVar !== undefined ? { envVar } : {}),
  };
}

/** Coerce the granted workspace root. A v1 doc omits it → undefined (not an error). */
function coerceActiveWorkspace(raw: unknown): ActiveWorkspace | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.rootPath !== "string" || raw.rootPath.length === 0) return undefined;
  return { rootPath: raw.rootPath };
}

function coerceProviders(raw: unknown): readonly ProviderSettingsEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProviderSettingsEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = coerceProvider(item);
    if (entry === undefined || seen.has(entry.providerId)) continue;
    seen.add(entry.providerId);
    out.push(entry);
  }
  return out;
}

function coerceModelPreference(raw: unknown): ModelPreference {
  if (!isRecord(raw)) return {};
  const model = coerceModelRef(raw.default);
  return model === undefined ? {} : { default: model };
}

function coerceProviderProfile(raw: unknown): PersistedProviderProfile | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string" || raw.id.length === 0) return undefined;
  if (typeof raw.displayName !== "string" || raw.displayName.length === 0) return undefined;
  if (raw.providerType !== "deepseek" && raw.providerType !== "custom-openai-compat") return undefined;
  if (typeof raw.baseUrl !== "string" || raw.baseUrl.length === 0) return undefined;
  if (typeof raw.modelId !== "string" || raw.modelId.length === 0) return undefined;
  if (typeof raw.envVar !== "string" || raw.envVar.length === 0) return undefined;
  if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") return undefined;
  const credentialRef = coerceCredentialRef(raw.credentialRef);
  const presetId = typeof raw.presetId === "string" ? raw.presetId : undefined;
  const credentialRevision =
    typeof raw.credentialRevision === "number" && Number.isFinite(raw.credentialRevision)
      ? Math.max(0, Math.floor(raw.credentialRevision))
      : undefined;
  const lastVerifiedAt = typeof raw.lastVerifiedAt === "string" ? raw.lastVerifiedAt : undefined;
  const lastVerifiedOk = typeof raw.lastVerifiedOk === "boolean" ? raw.lastVerifiedOk : undefined;
  const verifiedTargetFingerprint =
    typeof raw.verifiedTargetFingerprint === "string" ? raw.verifiedTargetFingerprint : undefined;
  return {
    id: raw.id,
    displayName: raw.displayName,
    providerType: raw.providerType,
    baseUrl: raw.baseUrl,
    modelId: raw.modelId,
    envVar: raw.envVar,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(credentialRef !== undefined ? { credentialRef } : {}),
    ...(presetId !== undefined ? { presetId } : {}),
    ...(credentialRevision !== undefined ? { credentialRevision } : {}),
    ...(lastVerifiedAt !== undefined ? { lastVerifiedAt } : {}),
    ...(lastVerifiedOk !== undefined ? { lastVerifiedOk } : {}),
    ...(verifiedTargetFingerprint !== undefined ? { verifiedTargetFingerprint } : {}),
  };
}

function coerceProviderProfiles(raw: unknown): readonly PersistedProviderProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: PersistedProviderProfile[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = coerceProviderProfile(item);
    if (entry === undefined || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/**
 * Migrate + coerce a parsed object into a valid, current-version document. Missing or
 * absent-version files are treated as legacy and upgraded. Field coercion is conservative
 * so one bad field never discards the rest.
 */
function migrate(raw: Record<string, unknown>): CoworkSettings {
  // Version is advisory: even an unknown/newer version is coerced down to the known shape,
  // so a forward-incompatible file degrades gracefully instead of crashing.
  const activeWorkspace = coerceActiveWorkspace(raw.activeWorkspace);
  const providerProfiles = coerceProviderProfiles(raw.providerProfiles);
  const activeProfileId =
    typeof raw.activeProfileId === "string" && raw.activeProfileId.length > 0
      ? raw.activeProfileId
      : undefined;
  const providerProfilesMigrated = raw.providerProfilesMigrated === true;
  return {
    version: SETTINGS_SCHEMA_VERSION,
    general: coerceGeneral(raw.general),
    providers: coerceProviders(raw.providers),
    modelPreference: coerceModelPreference(raw.modelPreference),
    ...(providerProfiles.length > 0 ? { providerProfiles } : { providerProfiles: [] }),
    ...(activeProfileId !== undefined ? { activeProfileId } : {}),
    ...(providerProfilesMigrated ? { providerProfilesMigrated: true } : {}),
    ...(activeWorkspace !== undefined ? { activeWorkspace } : {}),
  };
}

/**
 * Turn raw persisted bytes into a usable settings document. NEVER throws. `raw` is
 * `undefined` when the file does not exist yet (first run).
 */
export function recoverSettings(raw: string | undefined): SettingsLoadResult {
  if (raw === undefined) return { settings: defaultSettings(), source: "default" };
  if (raw.trim().length === 0) {
    return { settings: defaultSettings(), source: "recovered", reason: "empty" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt/unparseable bytes — recover to a safe default (SD5), never crash.
    return { settings: defaultSettings(), source: "recovered", reason: "unparseable" };
  }
  if (!isRecord(parsed)) {
    return { settings: defaultSettings(), source: "recovered", reason: "invalid_shape" };
  }
  return { settings: migrate(parsed), source: "loaded" };
}
