/**
 * Local app lock — first-run setup + unlock (ADR 0007).
 * Password verifier and vault key never leave the service process.
 */

import { randomUUID } from "node:crypto";
import type { AppMetaRepository, LocalUserRepository, VaultKeyRepository } from "./repositories.js";
import {
  decryptSecret,
  deriveKeyFromPassword,
  encryptSecret,
  generateMasterKey,
  generateSalt,
  hashPassword,
  unwrapMasterKey,
  verifyPassword,
  wrapMasterKey,
} from "./vault-crypto.js";

/**
 * app_meta key holding the DEVICE-BOUND auto-unlock envelope: the vault master key wrapped a SECOND
 * time (AES-256-GCM, independent salt) under a key derived from a random `deviceSecret`. The
 * deviceSecret itself never lives here — the shell keeps it sealed with Electron safeStorage (DPAPI)
 * on disk. Neither the envelope nor the sealed secret alone can unwrap the vault; both, on the same
 * device+user, are required. The password-wrapped `vault_keys` row is never touched, so the password
 * path and recovery always keep working.
 */
const AUTO_UNLOCK_META_KEY = "auto_unlock_envelope_v1";
/** AAD isolates the auto-unlock wrap from the password wrap ("cowork-ghc-vault-master"). */
const AUTO_UNLOCK_AAD = "cowork-ghc-vault-autounlock";

interface AutoUnlockEnvelope {
  readonly v: 1;
  readonly userId: string;
  readonly kdfSalt: string; // base64
  readonly ciphertext: string; // base64 (AES-256-GCM of the master key, base64-encoded)
  readonly nonce: string; // base64
  readonly tag: string; // base64
}

function readEnvelope(appMeta: AppMetaRepository): AutoUnlockEnvelope | null {
  const raw = appMeta.get(AUTO_UNLOCK_META_KEY);
  if (raw === null || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as AutoUnlockEnvelope;
    if (parsed.v !== 1 || typeof parsed.ciphertext !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export type AuthStatus =
  | { readonly state: "needs_setup" }
  | { readonly state: "locked"; readonly username: string }
  | { readonly state: "unlocked"; readonly username: string; readonly userId: string };

export interface LocalAuthService {
  status(): AuthStatus;
  setup(username: string, password: string): Promise<{ readonly userId: string }>;
  unlock(username: string, password: string): Promise<{ readonly userId: string }>;
  lock(): void;
  /** In-memory master key after unlock; null when locked. Never serialize. */
  masterKey(): Buffer | null;
  userId(): string | null;
  /** Verify a password against the stored local account without changing lock state. */
  verifyCurrentPassword(password: string): boolean;
  /** Whether a device-bound auto-unlock envelope is currently persisted. */
  hasAutoUnlockEnvelope(): boolean;
  /**
   * Persist a device-bound auto-unlock envelope: re-wrap the in-memory master key under a key derived
   * from `deviceSecret`. Requires the vault to be unlocked. Never stores the deviceSecret.
   */
  enableAutoUnlock(deviceSecret: string): void;
  /** Remove the device-bound auto-unlock envelope (returns the vault to password-only startup). */
  disableAutoUnlock(): void;
  /**
   * Unlock the vault from the device-bound envelope using `deviceSecret` (no password). Returns the
   * userId on success, or null when there is no envelope / the secret does not authenticate it
   * (a different device/user or a corrupted envelope) — the caller falls back to the password gate.
   */
  unlockWithAutoUnlock(deviceSecret: string): { readonly userId: string } | null;
}

export interface LocalAuthDeps {
  readonly users: LocalUserRepository;
  readonly vaultKeys: VaultKeyRepository;
  /** app_meta store for the device-bound auto-unlock envelope (never holds the deviceSecret). */
  readonly appMeta: AppMetaRepository;
  readonly now?: () => string;
  readonly id?: () => string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function createLocalAuthService(deps: LocalAuthDeps): LocalAuthService {
  const now = deps.now ?? (() => new Date().toISOString());
  const id = deps.id ?? (() => randomUUID());
  let unlockedUserId: string | null = null;
  let unlockedUsername: string | null = null;
  let masterKeyMemory: Buffer | null = null;

  return {
    status() {
      if (unlockedUserId !== null && unlockedUsername !== null) {
        return { state: "unlocked", username: unlockedUsername, userId: unlockedUserId };
      }
      const existing = deps.users.getFirst();
      if (existing === null) return { state: "needs_setup" };
      return { state: "locked", username: existing.username };
    },

    async setup(username, password) {
      const trimmedUser = username.trim();
      if (trimmedUser.length < 1 || trimmedUser.length > 64) {
        throw new AuthError("Username must be 1–64 characters.");
      }
      if (password.length < 8) {
        throw new AuthError("Password must be at least 8 characters.");
      }
      if (deps.users.count() > 0) {
        throw new AuthError("Local account already exists.");
      }

      const at = now();
      const userId = id();
      const passwordSalt = generateSalt();
      const passwordHash = hashPassword(password, passwordSalt);
      deps.users.insert({
        id: userId,
        username: trimmedUser,
        passwordSalt,
        passwordHash,
        createdAt: at,
        updatedAt: at,
      });

      const masterKey = generateMasterKey();
      const kdfSalt = generateSalt();
      const passwordKey = deriveKeyFromPassword(password, kdfSalt);
      const wrapped = wrapMasterKey(masterKey, passwordKey);
      deps.vaultKeys.insert({
        id: id(),
        userId,
        kdfSalt,
        wrappedMasterKey: wrapped.wrappedMasterKey,
        wrapNonce: wrapped.wrapNonce,
        wrapTag: wrapped.wrapTag,
        createdAt: at,
      });

      unlockedUserId = userId;
      unlockedUsername = trimmedUser;
      masterKeyMemory = masterKey;
      return { userId };
    },

    async unlock(username, password) {
      const user = deps.users.getByUsername(username.trim());
      if (user === null) throw new AuthError("Invalid username or password.");
      if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
        throw new AuthError("Invalid username or password.");
      }
      const vaultKey = deps.vaultKeys.getByUserId(user.id);
      if (vaultKey === null) throw new AuthError("Vault key missing for local user.");
      const passwordKey = deriveKeyFromPassword(password, vaultKey.kdfSalt);
      const masterKey = unwrapMasterKey(
        {
          wrappedMasterKey: vaultKey.wrappedMasterKey,
          wrapNonce: vaultKey.wrapNonce,
          wrapTag: vaultKey.wrapTag,
        },
        passwordKey,
      );
      if (masterKey === null) throw new AuthError("Invalid username or password.");

      unlockedUserId = user.id;
      unlockedUsername = user.username;
      masterKeyMemory = masterKey;
      return { userId: user.id };
    },

    lock() {
      unlockedUserId = null;
      unlockedUsername = null;
      if (masterKeyMemory !== null) {
        masterKeyMemory.fill(0);
      }
      masterKeyMemory = null;
    },

    masterKey() {
      return masterKeyMemory;
    },

    userId() {
      return unlockedUserId;
    },

    verifyCurrentPassword(password) {
      const user = deps.users.getFirst();
      if (user === null) return false;
      return verifyPassword(password, user.passwordSalt, user.passwordHash);
    },

    hasAutoUnlockEnvelope() {
      return readEnvelope(deps.appMeta) !== null;
    },

    enableAutoUnlock(deviceSecret) {
      if (masterKeyMemory === null || unlockedUserId === null) {
        throw new AuthError("Vault must be unlocked to enable auto-unlock.");
      }
      if (typeof deviceSecret !== "string" || deviceSecret.length < 16) {
        throw new AuthError("Device secret is too weak for auto-unlock.");
      }
      const kdfSalt = generateSalt();
      const deviceKey = deriveKeyFromPassword(deviceSecret, kdfSalt);
      // Second, independent wrap (distinct AAD) of the master key; the password wrap is untouched.
      const enc = encryptSecret(deviceKey, masterKeyMemory.toString("base64"), AUTO_UNLOCK_AAD);
      deviceKey.fill(0);
      const envelope: AutoUnlockEnvelope = {
        v: 1,
        userId: unlockedUserId,
        kdfSalt: kdfSalt.toString("base64"),
        ciphertext: enc.ciphertext.toString("base64"),
        nonce: enc.nonce.toString("base64"),
        tag: enc.tag.toString("base64"),
      };
      deps.appMeta.set(AUTO_UNLOCK_META_KEY, JSON.stringify(envelope));
    },

    disableAutoUnlock() {
      // Empty value = "no envelope" (readEnvelope treats blank as absent); AppMetaRepository has no
      // delete, and an empty string is inert.
      deps.appMeta.set(AUTO_UNLOCK_META_KEY, "");
    },

    unlockWithAutoUnlock(deviceSecret) {
      const envelope = readEnvelope(deps.appMeta);
      if (envelope === null) return null;
      const user = deps.users.getFirst();
      if (user === null || user.id !== envelope.userId) return null;
      let deviceKey: Buffer;
      try {
        deviceKey = deriveKeyFromPassword(deviceSecret, Buffer.from(envelope.kdfSalt, "base64"));
      } catch {
        return null;
      }
      const decoded = decryptSecret(
        deviceKey,
        {
          ciphertext: Buffer.from(envelope.ciphertext, "base64"),
          nonce: Buffer.from(envelope.nonce, "base64"),
          tag: Buffer.from(envelope.tag, "base64"),
        },
        AUTO_UNLOCK_AAD,
      );
      deviceKey.fill(0);
      if (decoded === null) return null; // wrong secret / different device / corrupted → password gate
      const masterKey = Buffer.from(decoded, "base64");
      if (masterKey.length !== 32) return null;
      unlockedUserId = user.id;
      unlockedUsername = user.username;
      masterKeyMemory = masterKey;
      return { userId: user.id };
    },
  };
}
