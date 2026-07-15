/**
 * Repository interfaces for the local SQLite vault (ADR 0007).
 * Implementations live beside this file; callers depend only on these ports.
 */

export interface SettingsRepository {
  getJson(key: string): string | null;
  setJson(key: string, valueJson: string, updatedAt: string): void;
  delete(key: string): void;
  listKeys(): readonly string[];
}

export interface ProviderProfileRepository {
  get(id: string): string | null;
  upsert(id: string, documentJson: string, updatedAt: string): void;
  delete(id: string): void;
  list(): readonly { id: string; documentJson: string }[];
  clear(): void;
}

export interface ProviderVerificationRepository {
  get(profileId: string): string | null;
  upsert(profileId: string, documentJson: string, updatedAt: string): void;
  delete(profileId: string): void;
  list(): readonly { profileId: string; documentJson: string }[];
  clear(): void;
}

export interface AppMetaRepository {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface SecretRecord {
  readonly id: string;
  readonly account: string;
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly aad: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SecretsRepository {
  get(account: string): SecretRecord | null;
  upsert(record: SecretRecord): void;
  delete(account: string): boolean;
  listAccounts(): readonly string[];
}

export interface LocalUserRecord {
  readonly id: string;
  readonly username: string;
  readonly passwordSalt: Buffer;
  readonly passwordHash: Buffer;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LocalUserRepository {
  getByUsername(username: string): LocalUserRecord | null;
  getFirst(): LocalUserRecord | null;
  insert(user: LocalUserRecord): void;
  count(): number;
}

export interface VaultKeyRecord {
  readonly id: string;
  readonly userId: string;
  readonly kdfSalt: Buffer;
  readonly wrappedMasterKey: Buffer;
  readonly wrapNonce: Buffer;
  readonly wrapTag: Buffer;
  readonly createdAt: string;
}

export interface VaultKeyRepository {
  getByUserId(userId: string): VaultKeyRecord | null;
  insert(record: VaultKeyRecord): void;
}
