/**
 * Remote-device pairing + device-token registry (agent-harness-plan.md Task 2.1, MVP slice).
 *
 * A device pairs by presenting a short-lived ONE-TIME pairing code (shown on the desktop) and
 * receives a per-device bearer token. MVP honesty: the registry is IN-MEMORY and per-launch,
 * exactly like the ADR 0003 client token, so devices re-pair after an app restart; keyring
 * persistence is a follow-up slice. Tokens are stored as SHA-256 digests only: the plaintext
 * token exists exactly once, in the exchange response, and never in logs or on disk.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { generateClientToken } from "../server/token.js";

/** Unambiguous pairing-code alphabet (no I/L/O/0/1 look-alikes). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const CODE_LENGTH = 8;
const DEFAULT_CODE_TTL_MS = 2 * 60_000;
const DEFAULT_MAX_FAILED_EXCHANGES = 5;
const DEFAULT_MAX_DEVICES = 8;
const MAX_DEVICE_NAME_LENGTH = 40;

export interface PairingRegistryOptions {
  /** Injectable clock (ms since epoch) for deterministic tests. */
  readonly now?: () => number;
  /** One-time pairing-code lifetime. Default 2 minutes. */
  readonly codeTtlMs?: number;
  /** Failed exchange attempts before the active code locks. Default 5. */
  readonly maxFailedExchanges?: number;
  /** Hard cap on simultaneously paired devices. Default 8. */
  readonly maxDevices?: number;
}

/** Secret-free device view (safe to render in UI / logs). */
export interface PairedDeviceView {
  readonly deviceId: string;
  readonly name: string;
  readonly pairedAtIso: string;
  readonly lastSeenAtIso: string;
}

export type ExchangeFailureReason =
  | "no_active_code"
  | "expired"
  | "mismatch"
  | "locked"
  | "device_limit";

export type ExchangeResult =
  | { readonly ok: true; readonly deviceId: string; readonly token: string }
  | { readonly ok: false; readonly reason: ExchangeFailureReason };

export interface PairingRegistry {
  /** Issue a fresh one-time code, replacing (and unlocking) any previous one. */
  issueCode(): { code: string; expiresAtMs: number };
  /** The currently active code info without the code value (status surfaces). */
  activeCodeInfo(): { active: boolean; expiresAtMs: number | null; locked: boolean };
  /** Exchange a pairing code for a per-device bearer token. Single-use on success. */
  exchange(code: string, deviceName?: string): ExchangeResult;
  /** Resolve a presented bearer token to its device (constant-time), else undefined. */
  verifyToken(token: string | undefined): PairedDeviceView | undefined;
  /** Revoke one device. Returns whether it existed. */
  revoke(deviceId: string): boolean;
  /** Revoke every device and clear the active code (used by `/remote off`). */
  revokeAll(): void;
  /** Secret-free list of paired devices. */
  listDevices(): readonly PairedDeviceView[];
}

interface DeviceRecord {
  readonly deviceId: string;
  readonly name: string;
  readonly tokenDigest: Buffer;
  readonly pairedAtIso: string;
  lastSeenAtIso: string;
}

function digestOf(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** Keep printable characters only (drops ASCII control chars + DEL) without regex escapes. */
function sanitizeDeviceName(raw: string | undefined): string {
  const cleaned = [...(raw ?? "")]
    .filter((ch) => {
      const codePoint = ch.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, MAX_DEVICE_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : "device";
}

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)] as string;
  }
  return code;
}

/** Constant-time equality over the fixed-width code (both sides hashed first). */
function codeMatches(expected: string, presented: string): boolean {
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b);
}

export function createPairingRegistry(options: PairingRegistryOptions = {}): PairingRegistry {
  const now = options.now ?? Date.now;
  const codeTtlMs = options.codeTtlMs ?? DEFAULT_CODE_TTL_MS;
  const maxFailed = options.maxFailedExchanges ?? DEFAULT_MAX_FAILED_EXCHANGES;
  const maxDevices = options.maxDevices ?? DEFAULT_MAX_DEVICES;

  let activeCode: { value: string; expiresAtMs: number } | null = null;
  let failedExchanges = 0;
  let locked = false;
  const devices = new Map<string, DeviceRecord>();

  function toView(record: DeviceRecord): PairedDeviceView {
    return {
      deviceId: record.deviceId,
      name: record.name,
      pairedAtIso: record.pairedAtIso,
      lastSeenAtIso: record.lastSeenAtIso,
    };
  }

  return {
    issueCode() {
      const value = generateCode();
      activeCode = { value, expiresAtMs: now() + codeTtlMs };
      failedExchanges = 0;
      locked = false;
      return { code: value, expiresAtMs: activeCode.expiresAtMs };
    },

    activeCodeInfo() {
      const active = activeCode !== null && now() < activeCode.expiresAtMs && !locked;
      return { active, expiresAtMs: activeCode?.expiresAtMs ?? null, locked };
    },

    exchange(code, deviceName) {
      if (locked) return { ok: false, reason: "locked" };
      if (activeCode === null) return { ok: false, reason: "no_active_code" };
      if (now() >= activeCode.expiresAtMs) {
        activeCode = null;
        return { ok: false, reason: "expired" };
      }
      if (
        typeof code !== "string" ||
        code.length !== CODE_LENGTH ||
        !codeMatches(activeCode.value, code.toUpperCase())
      ) {
        failedExchanges += 1;
        if (failedExchanges >= maxFailed) locked = true;
        return { ok: false, reason: locked ? "locked" : "mismatch" };
      }
      if (devices.size >= maxDevices) return { ok: false, reason: "device_limit" };
      // Single-use: consume the code before minting the token.
      activeCode = null;
      failedExchanges = 0;
      const token = generateClientToken();
      const deviceId = `dev-${randomBytes(4).toString("hex")}`;
      const nowIso = new Date(now()).toISOString();
      devices.set(deviceId, {
        deviceId,
        name: sanitizeDeviceName(deviceName),
        tokenDigest: digestOf(token),
        pairedAtIso: nowIso,
        lastSeenAtIso: nowIso,
      });
      return { ok: true, deviceId, token };
    },

    verifyToken(token) {
      if (typeof token !== "string" || token.length === 0) return undefined;
      const presented = digestOf(token);
      // Compare against EVERY stored digest (no early exit on a hit) so timing does not
      // reveal which device matched, or whether any did.
      let matched: DeviceRecord | undefined;
      for (const record of devices.values()) {
        if (timingSafeEqual(record.tokenDigest, presented)) matched = record;
      }
      if (matched === undefined) return undefined;
      matched.lastSeenAtIso = new Date(now()).toISOString();
      return toView(matched);
    },

    revoke(deviceId) {
      return devices.delete(deviceId);
    },

    revokeAll() {
      devices.clear();
      activeCode = null;
      failedExchanges = 0;
      locked = false;
    },

    listDevices() {
      return [...devices.values()].map(toView);
    },
  };
}
