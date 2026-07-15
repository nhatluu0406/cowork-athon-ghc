/**
 * Password KDF + AES-256-GCM vault crypto (ADR 0007).
 * Master key never persisted plaintext; held in memory only after unlock.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const SALT_BYTES = 16;

export function generateSalt(bytes: number = SALT_BYTES): Buffer {
  return randomBytes(bytes);
}

export function generateMasterKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** Derive a 32-byte key from password + salt via scrypt. */
export function deriveKeyFromPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

export function hashPassword(password: string, salt: Buffer): Buffer {
  return deriveKeyFromPassword(password, salt);
}

export function verifyPassword(password: string, salt: Buffer, expectedHash: Buffer): boolean {
  const actual = hashPassword(password, salt);
  if (actual.length !== expectedHash.length) return false;
  return timingSafeEqual(actual, expectedHash);
}

export interface WrappedKey {
  readonly wrappedMasterKey: Buffer;
  readonly wrapNonce: Buffer;
  readonly wrapTag: Buffer;
}

/** Wrap the vault master key with a password-derived key (AES-256-GCM). */
export function wrapMasterKey(masterKey: Buffer, passwordKey: Buffer): WrappedKey {
  const wrapNonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", passwordKey, wrapNonce);
  cipher.setAAD(Buffer.from("cowork-ghc-vault-master", "utf8"));
  const wrappedMasterKey = Buffer.concat([cipher.update(masterKey), cipher.final()]);
  const wrapTag = cipher.getAuthTag();
  return { wrappedMasterKey, wrapNonce, wrapTag };
}

/** Unwrap the vault master key. Returns null when authentication fails. */
export function unwrapMasterKey(
  wrapped: WrappedKey,
  passwordKey: Buffer,
): Buffer | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", passwordKey, wrapped.wrapNonce);
    decipher.setAAD(Buffer.from("cowork-ghc-vault-master", "utf8"));
    decipher.setAuthTag(wrapped.wrapTag);
    return Buffer.concat([decipher.update(wrapped.wrappedMasterKey), decipher.final()]);
  } catch {
    return null;
  }
}

export interface EncryptedSecret {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly tag: Buffer;
}

/** Encrypt a secret with the vault master key. AAD binds the account name. */
export function encryptSecret(masterKey: Buffer, plaintext: string, aad: string): EncryptedSecret {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, nonce, tag };
}

/** Decrypt a secret. Returns null when authentication fails. */
export function decryptSecret(
  masterKey: Buffer,
  encrypted: EncryptedSecret,
  aad: string,
): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey, encrypted.nonce);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(encrypted.tag);
    return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
