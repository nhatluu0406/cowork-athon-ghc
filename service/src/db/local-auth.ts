/**
 * Local app lock — first-run setup + unlock (ADR 0007).
 * Password verifier and vault key never leave the service process.
 */

import { randomUUID } from "node:crypto";
import type { LocalUserRepository, VaultKeyRepository } from "./repositories.js";
import {
  deriveKeyFromPassword,
  generateMasterKey,
  generateSalt,
  hashPassword,
  unwrapMasterKey,
  verifyPassword,
  wrapMasterKey,
} from "./vault-crypto.js";

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
}

export interface LocalAuthDeps {
  readonly users: LocalUserRepository;
  readonly vaultKeys: VaultKeyRepository;
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
  };
}
