/**
 * SQLite-backed repository implementations (ADR 0007).
 */

import type { SqliteDatabase } from "./sqlite.js";
import type {
  AppMetaRepository,
  LocalUserRecord,
  LocalUserRepository,
  ProviderProfileRepository,
  ProviderVerificationRepository,
  SecretRecord,
  SecretsRepository,
  SettingsRepository,
  VaultKeyRecord,
  VaultKeyRepository,
} from "./repositories.js";

export function createSettingsRepository(db: SqliteDatabase): SettingsRepository {
  const getStmt = db.prepare("SELECT value_json AS valueJson FROM settings WHERE key = ?");
  const setStmt = db.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (@key, @valueJson, @updatedAt) " +
      "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  );
  const delStmt = db.prepare("DELETE FROM settings WHERE key = ?");
  const listStmt = db.prepare("SELECT key FROM settings ORDER BY key ASC");
  return {
    getJson(key) {
      const row = getStmt.get(key) as { valueJson: string } | undefined;
      return row?.valueJson ?? null;
    },
    setJson(key, valueJson, updatedAt) {
      setStmt.run({ key, valueJson, updatedAt });
    },
    delete(key) {
      delStmt.run(key);
    },
    listKeys() {
      return (listStmt.all() as Array<{ key: string }>).map((r) => r.key);
    },
  };
}

export function createProviderProfileRepository(db: SqliteDatabase): ProviderProfileRepository {
  const getStmt = db.prepare(
    "SELECT document_json AS documentJson FROM provider_profiles WHERE id = ?",
  );
  const upsertStmt = db.prepare(
    "INSERT INTO provider_profiles (id, document_json, updated_at) VALUES (@id, @documentJson, @updatedAt) " +
      "ON CONFLICT(id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at",
  );
  const delStmt = db.prepare("DELETE FROM provider_profiles WHERE id = ?");
  const listStmt = db.prepare(
    "SELECT id, document_json AS documentJson FROM provider_profiles ORDER BY id ASC",
  );
  const clearStmt = db.prepare("DELETE FROM provider_profiles");
  return {
    get(id) {
      const row = getStmt.get(id) as { documentJson: string } | undefined;
      return row?.documentJson ?? null;
    },
    upsert(id, documentJson, updatedAt) {
      upsertStmt.run({ id, documentJson, updatedAt });
    },
    delete(id) {
      delStmt.run(id);
    },
    list() {
      return listStmt.all() as Array<{ id: string; documentJson: string }>;
    },
    clear() {
      clearStmt.run();
    },
  };
}

export function createProviderVerificationRepository(
  db: SqliteDatabase,
): ProviderVerificationRepository {
  const getStmt = db.prepare(
    "SELECT document_json AS documentJson FROM provider_verifications WHERE profile_id = ?",
  );
  const upsertStmt = db.prepare(
    "INSERT INTO provider_verifications (profile_id, document_json, updated_at) " +
      "VALUES (@profileId, @documentJson, @updatedAt) " +
      "ON CONFLICT(profile_id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at",
  );
  const delStmt = db.prepare("DELETE FROM provider_verifications WHERE profile_id = ?");
  const listStmt = db.prepare(
    "SELECT profile_id AS profileId, document_json AS documentJson FROM provider_verifications ORDER BY profile_id ASC",
  );
  const clearStmt = db.prepare("DELETE FROM provider_verifications");
  return {
    get(profileId) {
      const row = getStmt.get(profileId) as { documentJson: string } | undefined;
      return row?.documentJson ?? null;
    },
    upsert(profileId, documentJson, updatedAt) {
      upsertStmt.run({ profileId, documentJson, updatedAt });
    },
    delete(profileId) {
      delStmt.run(profileId);
    },
    list() {
      return listStmt.all() as Array<{ profileId: string; documentJson: string }>;
    },
    clear() {
      clearStmt.run();
    },
  };
}

export function createAppMetaRepository(db: SqliteDatabase): AppMetaRepository {
  const getStmt = db.prepare("SELECT value FROM app_meta WHERE key = ?");
  const setStmt = db.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  return {
    get(key) {
      const row = getStmt.get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
    set(key, value) {
      setStmt.run(key, value);
    },
  };
}

export function createSecretsRepository(db: SqliteDatabase): SecretsRepository {
  const getStmt = db.prepare(
    "SELECT id, account, ciphertext, nonce, tag, aad, created_at AS createdAt, updated_at AS updatedAt FROM secrets WHERE account = ?",
  );
  const upsertStmt = db.prepare(
    "INSERT INTO secrets (id, account, ciphertext, nonce, tag, aad, created_at, updated_at) " +
      "VALUES (@id, @account, @ciphertext, @nonce, @tag, @aad, @createdAt, @updatedAt) " +
      "ON CONFLICT(account) DO UPDATE SET " +
      "ciphertext = excluded.ciphertext, nonce = excluded.nonce, tag = excluded.tag, " +
      "aad = excluded.aad, updated_at = excluded.updated_at",
  );
  const delStmt = db.prepare("DELETE FROM secrets WHERE account = ?");
  const listStmt = db.prepare("SELECT account FROM secrets ORDER BY account ASC");
  return {
    get(account) {
      const row = getStmt.get(account) as
        | {
            id: string;
            account: string;
            ciphertext: Buffer;
            nonce: Buffer;
            tag: Buffer;
            aad: string;
            createdAt: string;
            updatedAt: string;
          }
        | undefined;
      if (row === undefined) return null;
      return {
        id: row.id,
        account: row.account,
        ciphertext: Buffer.from(row.ciphertext),
        nonce: Buffer.from(row.nonce),
        tag: Buffer.from(row.tag),
        aad: row.aad,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
    upsert(record) {
      upsertStmt.run({
        id: record.id,
        account: record.account,
        ciphertext: record.ciphertext,
        nonce: record.nonce,
        tag: record.tag,
        aad: record.aad,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    },
    delete(account) {
      const result = delStmt.run(account);
      return result.changes > 0;
    },
    listAccounts() {
      return (listStmt.all() as Array<{ account: string }>).map((r) => r.account);
    },
  };
}

export function createLocalUserRepository(db: SqliteDatabase): LocalUserRepository {
  const byName = db.prepare(
    "SELECT id, username, password_salt AS passwordSalt, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt FROM local_users WHERE username = ?",
  );
  const first = db.prepare(
    "SELECT id, username, password_salt AS passwordSalt, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt FROM local_users ORDER BY created_at ASC LIMIT 1",
  );
  const insert = db.prepare(
    "INSERT INTO local_users (id, username, password_salt, password_hash, created_at, updated_at) VALUES (@id, @username, @passwordSalt, @passwordHash, @createdAt, @updatedAt)",
  );
  const updatePwStmt = db.prepare(
    "UPDATE local_users SET password_salt = @salt, password_hash = @hash, updated_at = @updatedAt WHERE id = @id",
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM local_users");
  const mapRow = (row: {
    id: string;
    username: string;
    passwordSalt: Buffer;
    passwordHash: Buffer;
    createdAt: string;
    updatedAt: string;
  }): LocalUserRecord => ({
    id: row.id,
    username: row.username,
    passwordSalt: Buffer.from(row.passwordSalt),
    passwordHash: Buffer.from(row.passwordHash),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return {
    getByUsername(username) {
      const row = byName.get(username) as Parameters<typeof mapRow>[0] | undefined;
      return row === undefined ? null : mapRow(row);
    },
    getFirst() {
      const row = first.get() as Parameters<typeof mapRow>[0] | undefined;
      return row === undefined ? null : mapRow(row);
    },
    insert(user) {
      insert.run({
        id: user.id,
        username: user.username,
        passwordSalt: user.passwordSalt,
        passwordHash: user.passwordHash,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    },
    count() {
      const row = countStmt.get() as { n: number };
      return row.n;
    },
    updatePassword(userId, newSalt, newHash, updatedAt) {
      updatePwStmt.run({ id: userId, salt: newSalt, hash: newHash, updatedAt });
    },
  };
}

export function createVaultKeyRepository(db: SqliteDatabase): VaultKeyRepository {
  const getStmt = db.prepare(
    "SELECT id, user_id AS userId, kdf_salt AS kdfSalt, wrapped_master_key AS wrappedMasterKey, " +
      "wrap_nonce AS wrapNonce, wrap_tag AS wrapTag, created_at AS createdAt FROM vault_keys WHERE user_id = ?",
  );
  const insert = db.prepare(
    "INSERT INTO vault_keys (id, user_id, kdf_salt, wrapped_master_key, wrap_nonce, wrap_tag, created_at) " +
      "VALUES (@id, @userId, @kdfSalt, @wrappedMasterKey, @wrapNonce, @wrapTag, @createdAt)",
  );
  const updateKeyStmt = db.prepare(
    "UPDATE vault_keys SET kdf_salt = @kdfSalt, wrapped_master_key = @wrappedMasterKey, " +
      "wrap_nonce = @wrapNonce, wrap_tag = @wrapTag WHERE user_id = @userId",
  );
  return {
    getByUserId(userId) {
      const row = getStmt.get(userId) as
        | {
            id: string;
            userId: string;
            kdfSalt: Buffer;
            wrappedMasterKey: Buffer;
            wrapNonce: Buffer;
            wrapTag: Buffer;
            createdAt: string;
          }
        | undefined;
      if (row === undefined) return null;
      return {
        id: row.id,
        userId: row.userId,
        kdfSalt: Buffer.from(row.kdfSalt),
        wrappedMasterKey: Buffer.from(row.wrappedMasterKey),
        wrapNonce: Buffer.from(row.wrapNonce),
        wrapTag: Buffer.from(row.wrapTag),
        createdAt: row.createdAt,
      };
    },
    insert(record) {
      insert.run({
        id: record.id,
        userId: record.userId,
        kdfSalt: record.kdfSalt,
        wrappedMasterKey: record.wrappedMasterKey,
        wrapNonce: record.wrapNonce,
        wrapTag: record.wrapTag,
        createdAt: record.createdAt,
      });
    },
    updateByUserId(userId, update) {
      updateKeyStmt.run({
        userId,
        kdfSalt: update.kdfSalt,
        wrappedMasterKey: update.wrappedMasterKey,
        wrapNonce: update.wrapNonce,
        wrapTag: update.wrapTag,
      });
    },
  };
}
