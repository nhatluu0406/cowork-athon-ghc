/**
 * Idempotent migration from legacy single-provider settings to provider profiles.
 */

import { randomUUID } from "node:crypto";
import type { CredentialStore } from "../credential/store.js";
import { credentialAccountFor, credentialAccountForProfile, credentialRef } from "../credential/store.js";
import { CUSTOM_OPENAI_COMPAT_ID } from "../provider/descriptors.js";
import type { CoworkSettings, PersistedProviderProfile } from "../diagnostics/settings-types.js";
import {
  DEEPSEEK_PRESET_ID,
  defaultEnvVarForProfile,
  inferProviderTypeFromLegacy,
} from "./presets.js";
import { assertValidProfileId } from "./profile-id.js";

const LEGACY_MIGRATED_PROFILE_ID = "migrated-deepseek";

export interface ProfileMigrationResult {
  readonly settings: CoworkSettings;
  readonly migrated: boolean;
  readonly credentialRemapped: boolean;
}

function legacyCustomProvider(settings: CoworkSettings) {
  return settings.providers.find((p) => p.providerId === CUSTOM_OPENAI_COMPAT_ID);
}

function buildMigratedProfile(
  settings: CoworkSettings,
  credentialRefOverride?: PersistedProviderProfile["credentialRef"],
): PersistedProviderProfile {
  const legacy = legacyCustomProvider(settings);
  const model = settings.modelPreference.default;
  const providerType = inferProviderTypeFromLegacy(legacy?.baseUrl, model?.modelID);
  const now = new Date().toISOString();
  const profileId =
    providerType === "deepseek" ? LEGACY_MIGRATED_PROFILE_ID : `migrated-${randomUUID().slice(0, 8)}`;
  assertValidProfileId(profileId);
  const displayName = providerType === "deepseek" ? "DeepSeek" : "Migrated provider";
  const baseUrl = legacy?.baseUrl ?? "https://api.deepseek.com/v1";
  const modelId = model?.modelID ?? "deepseek-chat";
  return {
    id: profileId,
    displayName,
    providerType,
    baseUrl,
    modelId,
    envVar: legacy?.envVar ?? defaultEnvVarForProfile(profileId),
    createdAt: now,
    updatedAt: now,
    ...(credentialRefOverride !== undefined ? { credentialRef: credentialRefOverride } : {}),
    ...(providerType === "deepseek" ? { presetId: DEEPSEEK_PRESET_ID } : {}),
    ...(legacy?.credentialRef !== undefined && credentialRefOverride === undefined
      ? { credentialRef: legacy.credentialRef }
      : {}),
  };
}

/**
 * Migrate legacy provider settings into a default profile when profiles are absent.
 * Idempotent: skips when `providerProfilesMigrated` is true or profiles already exist.
 */
export async function migrateLegacySettingsToProfiles(
  settings: CoworkSettings,
  credentialStore?: CredentialStore,
): Promise<ProfileMigrationResult> {
  if (settings.providerProfilesMigrated === true) {
    return { settings, migrated: false, credentialRemapped: false };
  }
  const existing = settings.providerProfiles ?? [];
  if (existing.length > 0) {
    return {
      settings: { ...settings, providerProfilesMigrated: true },
      migrated: false,
      credentialRemapped: false,
    };
  }

  const legacy = legacyCustomProvider(settings);
  const model = settings.modelPreference.default;
  const hasLegacyConfig =
    legacy !== undefined &&
    (legacy.baseUrl !== undefined || legacy.credentialRef !== undefined || model !== undefined);
  if (!hasLegacyConfig) {
    return {
      settings: { ...settings, providerProfiles: [], providerProfilesMigrated: true },
      migrated: false,
      credentialRemapped: false,
    };
  }

  let credentialRemapped = false;
  let credentialRefForProfile = legacy?.credentialRef;
  const profileDraft = buildMigratedProfile(settings);
  if (
    credentialStore !== undefined &&
    legacy?.credentialRef !== undefined &&
    legacy.credentialRef.account !== credentialAccountForProfile(profileDraft.id)
  ) {
    const secret = await credentialStore.get(legacy.credentialRef.account);
    if (secret !== null && secret.length > 0) {
      const nextAccount = credentialAccountForProfile(profileDraft.id);
      await credentialStore.set(nextAccount, secret);
      credentialRefForProfile = credentialRef(nextAccount);
      credentialRemapped = true;
    }
  }

  const profile = buildMigratedProfile(settings, credentialRefForProfile);
  const activeProfileId = profile.id;
  const syncedProviders = upsertLegacyProviderFromProfile(settings.providers, profile);

  return {
    settings: {
      ...settings,
      version: settings.version,
      providerProfiles: [profile],
      activeProfileId,
      providerProfilesMigrated: true,
      providers: syncedProviders,
      modelPreference: {
        default: {
          providerID: CUSTOM_OPENAI_COMPAT_ID,
          modelID: profile.modelId,
        },
      },
    },
    migrated: true,
    credentialRemapped,
  };
}

export function upsertLegacyProviderFromProfile(
  providers: CoworkSettings["providers"],
  profile: PersistedProviderProfile,
): CoworkSettings["providers"] {
  const kept = providers.filter((p) => p.providerId !== CUSTOM_OPENAI_COMPAT_ID);
  return [
    ...kept,
    {
      providerId: CUSTOM_OPENAI_COMPAT_ID,
      baseUrl: profile.baseUrl,
      envVar: profile.envVar,
      ...(profile.credentialRef !== undefined ? { credentialRef: profile.credentialRef } : {}),
    },
  ];
}

/** Map a legacy provider-scoped credential account to a profile account when possible. */
export function legacyCredentialAccountForProvider(providerId: string): string {
  return credentialAccountFor(providerId);
}
