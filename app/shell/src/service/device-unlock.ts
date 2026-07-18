/**
 * Device-bound secure auto-unlock — the shell half (Electron safeStorage / Windows DPAPI).
 *
 * When "Require login at startup" is OFF, the vault master key is re-wrapped by the SERVICE under a
 * random `deviceSecret` (an app_meta envelope). That deviceSecret is sealed HERE with safeStorage
 * (DPAPI, bound to the current OS user + machine) and written to `<appDataRoot>/auto-unlock.seal`.
 *
 * Neither half alone can open the vault: the envelope needs the deviceSecret, which is only
 * recoverable by safeStorage on this exact device+user. No plaintext key (or deviceSecret) is ever
 * written to disk; the master key never leaves the service. Not the Windows Credential Manager.
 */

import { safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SEAL_FILENAME = "auto-unlock.seal";

export function sealPath(appDataRoot: string): string {
  return join(appDataRoot, SEAL_FILENAME);
}

/** Whether safeStorage (DPAPI) can seal secrets on this machine. */
export function isSecureAutoUnlockAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** A fresh 32-byte deviceSecret as base64 (>= the auth service's 16-char minimum). */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString("base64");
}

/** DPAPI-seal `deviceSecret` to disk. Returns false when unavailable or the write failed. */
export function sealDeviceSecret(appDataRoot: string, deviceSecret: string): boolean {
  if (!isSecureAutoUnlockAvailable()) return false;
  try {
    const encrypted = safeStorage.encryptString(deviceSecret);
    const path = sealPath(appDataRoot);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encrypted);
    return true;
  } catch {
    return false;
  }
}

/** Read + DPAPI-decrypt the sealed deviceSecret; null when absent / unavailable / corrupt. */
export function readSealedDeviceSecret(appDataRoot: string): string | null {
  if (!isSecureAutoUnlockAvailable()) return null;
  const path = sealPath(appDataRoot);
  if (!existsSync(path)) return null;
  try {
    const secret = safeStorage.decryptString(readFileSync(path));
    return secret.length > 0 ? secret : null;
  } catch {
    // A seal written on a different device/user (or corrupted) fails to decrypt → password gate.
    return null;
  }
}

/** Remove the sealed deviceSecret (returning to password-only startup). Best-effort. */
export function clearSealedDeviceSecret(appDataRoot: string): void {
  try {
    rmSync(sealPath(appDataRoot), { force: true });
  } catch {
    // best-effort
  }
}
