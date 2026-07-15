/**
 * One-time migration of legacy JSON settings + OS keyring secrets into SQLite vault (ADR 0007).
 *
 * Order:
 * 1. Import non-secret settings.json into SQLite (before unlock is fine).
 * 2. After unlock, copy keyring secrets into encrypted `secrets` (verify, then delete keyring).
 * 3. Rename JSON to `.migrated-backup` only after a successful import.
 *
 * Conversation JSON is intentionally NOT migrated in Wave 0A.
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import type { CredentialStore } from "../credential/store.js";
import type { CoworkSettings } from "../diagnostics/settings-types.js";
import type { AppMetaRepository, SettingsRepository } from "./repositories.js";
import { SETTINGS_DOCUMENT_KEY } from "./sqlite-settings-fs.js";
import type { LocalAuthService } from "./local-auth.js";
import type { VaultCredentialStore } from "./vault-credential-store.js";

export const META_JSON_SETTINGS_MIGRATED = "legacy.json_settings_migrated";
export const META_KEYRING_MIGRATED = "legacy.keyring_migrated";

export interface JsonSettingsMigrationResult {
  readonly imported: boolean;
  readonly backedUp: boolean;
  readonly reason?: string;
}

/** Import settings.json into SQLite when the document key is empty. */
export function migrateJsonSettingsToSqlite(deps: {
  readonly settingsFilePath: string;
  readonly settings: SettingsRepository;
  readonly appMeta: AppMetaRepository;
  readonly now?: () => string;
}): JsonSettingsMigrationResult {
  const now = deps.now ?? (() => new Date().toISOString());
  if (deps.appMeta.get(META_JSON_SETTINGS_MIGRATED) === "1") {
    return { imported: false, backedUp: false, reason: "already_migrated" };
  }
  if (deps.settings.getJson(SETTINGS_DOCUMENT_KEY) !== null) {
    deps.appMeta.set(META_JSON_SETTINGS_MIGRATED, "1");
    return { imported: false, backedUp: false, reason: "sqlite_already_has_settings" };
  }
  if (!existsSync(deps.settingsFilePath)) {
    deps.appMeta.set(META_JSON_SETTINGS_MIGRATED, "1");
    return { imported: false, backedUp: false, reason: "no_legacy_file" };
  }

  let raw: string;
  try {
    raw = readFileSync(deps.settingsFilePath, "utf8");
  } catch {
    return { imported: false, backedUp: false, reason: "read_failed" };
  }
  try {
    JSON.parse(raw) as CoworkSettings;
  } catch {
    return { imported: false, backedUp: false, reason: "corrupt_json" };
  }

  deps.settings.setJson(SETTINGS_DOCUMENT_KEY, raw, now());
  deps.appMeta.set(META_JSON_SETTINGS_MIGRATED, "1");

  const backupPath = `${deps.settingsFilePath}.migrated-backup`;
  let backedUp = false;
  try {
    if (!existsSync(backupPath)) {
      renameSync(deps.settingsFilePath, backupPath);
      backedUp = true;
    }
  } catch {
    // Keep original file if rename fails; SQLite already holds the document.
  }
  return { imported: true, backedUp };
}

export interface KeyringMigrationResult {
  readonly migrated: boolean;
  readonly accounts: readonly string[];
  readonly deletedFromKeyring: readonly string[];
  readonly reason?: string;
}

/** Collect credential account handles from a settings document (never secret values). */
export function collectCredentialAccounts(settings: CoworkSettings): readonly string[] {
  const accounts = new Set<string>();
  for (const provider of settings.providers) {
    if (provider.credentialRef?.account) accounts.add(provider.credentialRef.account);
  }
  for (const profile of settings.providerProfiles ?? []) {
    if (profile.credentialRef?.account) accounts.add(profile.credentialRef.account);
  }
  // Historical MS365 accounts used by the token provider.
  accounts.add("provider:ms365");
  accounts.add("ms365");
  return [...accounts].sort();
}

/**
 * Copy secrets from a legacy store (keyring or memory stand-in) into the unlocked vault.
 * Deletes legacy entries ONLY after each target decrypts successfully.
 * On failure, leaves legacy entries intact and rolls back vault writes for this batch.
 */
export async function migrateKeyringSecretsToVault(deps: {
  readonly auth: LocalAuthService;
  readonly vault: VaultCredentialStore;
  readonly legacy: CredentialStore;
  readonly appMeta: AppMetaRepository;
  readonly accounts: readonly string[];
}): Promise<KeyringMigrationResult> {
  if (deps.appMeta.get(META_KEYRING_MIGRATED) === "1") {
    return { migrated: false, accounts: [], deletedFromKeyring: [], reason: "already_migrated" };
  }
  if (deps.auth.masterKey() === null) {
    return { migrated: false, accounts: [], deletedFromKeyring: [], reason: "vault_locked" };
  }

  const toMigrate: Array<{ account: string; secret: string }> = [];
  for (const account of deps.accounts) {
    let secret: string | null;
    try {
      secret = await deps.legacy.get(account);
    } catch {
      continue;
    }
    if (secret !== null && secret.length > 0) {
      toMigrate.push({ account, secret });
    }
  }

  if (toMigrate.length === 0) {
    deps.appMeta.set(META_KEYRING_MIGRATED, "1");
    return { migrated: false, accounts: [], deletedFromKeyring: [], reason: "nothing_to_migrate" };
  }

  const written: string[] = [];
  try {
    for (const item of toMigrate) {
      await deps.vault.set(item.account, item.secret);
      written.push(item.account);
      const roundTrip = await deps.vault.get(item.account);
      if (roundTrip !== item.secret) {
        throw new Error(`Vault verification failed for account ${item.account}.`);
      }
    }
  } catch (err) {
    for (const account of written) {
      await deps.vault.delete(account).catch(() => false);
    }
    throw err;
  }

  const deletedFromKeyring: string[] = [];
  for (const account of written) {
    const removed = await deps.legacy.delete(account);
    if (removed) deletedFromKeyring.push(account);
  }

  deps.appMeta.set(META_KEYRING_MIGRATED, "1");
  return { migrated: true, accounts: written, deletedFromKeyring };
}
