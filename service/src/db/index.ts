/**
 * Barrel for the local SQLite database layer (ADR 0007).
 */

export {
  openSqliteDatabase,
  openMemorySqliteDatabase,
  closeSqliteDatabase,
  type SqliteDatabase,
  type OpenSqliteOptions,
} from "./sqlite.js";
export {
  MIGRATIONS,
  runMigrations,
  appliedMigrationIds,
  type Migration,
} from "./migrations.js";
export type {
  SettingsRepository,
  ProviderProfileRepository,
  ProviderVerificationRepository,
  AppMetaRepository,
  SecretsRepository,
  SecretRecord,
  LocalUserRepository,
  LocalUserRecord,
  VaultKeyRepository,
  VaultKeyRecord,
} from "./repositories.js";
export {
  createSettingsRepository,
  createProviderProfileRepository,
  createProviderVerificationRepository,
  createAppMetaRepository,
  createSecretsRepository,
  createLocalUserRepository,
  createVaultKeyRepository,
} from "./sqlite-repositories.js";
export {
  deriveKeyFromPassword,
  hashPassword,
  verifyPassword,
  generateSalt,
  generateMasterKey,
  wrapMasterKey,
  unwrapMasterKey,
  encryptSecret,
  decryptSecret,
  type WrappedKey,
  type EncryptedSecret,
} from "./vault-crypto.js";
export {
  createLocalAuthService,
  AuthError,
  type LocalAuthService,
  type AuthStatus,
  type LocalAuthDeps,
} from "./local-auth.js";
export {
  createVaultCredentialStore,
  type VaultCredentialStore,
  type VaultCredentialStoreKind,
} from "./vault-credential-store.js";
export {
  createSqliteSettingsFs,
  SETTINGS_DOCUMENT_KEY,
} from "./sqlite-settings-fs.js";
export {
  createAuthRouter,
  AuthRequestError,
  AUTH_STATUS_PATH,
  AUTH_SETUP_PATH,
  AUTH_UNLOCK_PATH,
  AUTH_LOCK_PATH,
} from "./auth-router.js";
export {
  migrateJsonSettingsToSqlite,
  migrateKeyringSecretsToVault,
  collectCredentialAccounts,
  META_JSON_SETTINGS_MIGRATED,
  META_KEYRING_MIGRATED,
  type JsonSettingsMigrationResult,
  type KeyringMigrationResult,
} from "./legacy-migration.js";
export {
  migrateJsonConversationsToSqlite,
  META_JSON_CONVERSATIONS_MIGRATED,
  type JsonConversationsMigrationResult,
} from "./conversation-json-migration.js";
export {
  createSqliteConversationStore,
  persistConversationRecord,
  META_LAST_ACTIVE_CONVERSATION,
} from "./sqlite-conversation-store.js";
