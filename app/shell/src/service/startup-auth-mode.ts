/**
 * Startup-auth-mode orchestration — the shell half of the "Require login at startup" toggle,
 * extracted from the IPC handler so the crash/interruption + rollback behaviour is unit-testable
 * without an Electron main process.
 *
 * The two-step OFF transition (create the app_meta envelope in the SERVICE, then seal the
 * deviceSecret with safeStorage in the SHELL) must never leave a half-configured state:
 *  - envelope written, seal FAILS  → roll the envelope back (disable) so the vault is password-only
 *    again; report `seal_failed`. The transient orphan envelope is inert regardless (boot only
 *    auto-unlocks when a *sealed* deviceSecret exists — no seal ⇒ password gate).
 *  - envelope NOT written (wrong password) → nothing is sealed (envelope is created first).
 *  - secure storage unavailable → OFF is refused up front; the password gate stays in place.
 *
 * No secret is returned or logged: the deviceSecret is generated + sealed here and handed to the
 * service over the loopback boundary only; the master key never leaves the service.
 */

import type { StartupAuthModeResult } from "@cowork-ghc/contracts";

/** Injectable side-effects so the orchestration can be exercised deterministically in tests. */
export interface StartupAuthModeSeams {
  /** One authenticated call to the loopback service; returns whether the envelope succeeded. */
  readonly serviceCall: (method: string, path: string, body: unknown) => Promise<{ ok: boolean }>;
  /** Whether Electron safeStorage / DPAPI can seal secrets on this machine. */
  readonly isSecureAvailable: () => boolean;
  /** A fresh random deviceSecret (never persisted in plaintext). */
  readonly generateDeviceSecret: () => string;
  /** DPAPI-seal the deviceSecret to disk. Returns false when it could not be written. */
  readonly sealDeviceSecret: (deviceSecret: string) => boolean;
  /** Remove the sealed deviceSecret (return to password-only startup). Best-effort. */
  readonly clearSealedDeviceSecret: () => void;
}

const AUTO_UNLOCK_ENABLE_PATH = "/v1/auth/auto-unlock/enable";
const AUTO_UNLOCK_DISABLE_PATH = "/v1/auth/auto-unlock/disable";
const SETTINGS_GENERAL_PATH = "/v1/settings/general";

/**
 * Apply the requested startup-auth mode. `password` confirms the local account for BOTH directions
 * (the service verifies it); it is used only for this call and never stored. Returns a non-secret
 * {@link StartupAuthModeResult} the renderer reflects in the toggle.
 */
export async function applyStartupAuthMode(
  seams: StartupAuthModeSeams,
  requireLogin: boolean,
  password: string,
): Promise<StartupAuthModeResult> {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, reason: "password_required", requireLogin: !requireLogin };
  }

  if (requireLogin) {
    // Turn the requirement ON: remove the auto-unlock envelope + sealed secret, persist setting.
    const disabled = await seams.serviceCall("POST", AUTO_UNLOCK_DISABLE_PATH, { password });
    if (!disabled.ok) return { ok: false, reason: "invalid_password", requireLogin: false };
    seams.clearSealedDeviceSecret();
    await seams.serviceCall("PATCH", SETTINGS_GENERAL_PATH, { requireLoginOnStartup: true });
    return { ok: true, requireLogin: true };
  }

  // Turn the requirement OFF: needs device-bound secure storage to fall back on.
  if (!seams.isSecureAvailable()) {
    return { ok: false, reason: "secure_storage_unavailable", requireLogin: true };
  }
  const deviceSecret = seams.generateDeviceSecret();
  const enabled = await seams.serviceCall("POST", AUTO_UNLOCK_ENABLE_PATH, {
    password,
    deviceSecret,
  });
  if (!enabled.ok) return { ok: false, reason: "invalid_password", requireLogin: true };
  if (!seams.sealDeviceSecret(deviceSecret)) {
    // Interruption between the two steps: the envelope exists but the seal did not land. Roll the
    // envelope back so we never leave a half-configured OFF state (and the orphan is inert anyway).
    await seams.serviceCall("POST", AUTO_UNLOCK_DISABLE_PATH, { password });
    return { ok: false, reason: "seal_failed", requireLogin: true };
  }
  await seams.serviceCall("PATCH", SETTINGS_GENERAL_PATH, { requireLoginOnStartup: false });
  return { ok: true, requireLogin: false };
}
