/**
 * Runtime process identity (design §8, ADR 0004). Identity is the tuple
 * `{ pid, startTime, exePath, port, host, runtimeVersion }`. It is captured at spawn
 * and re-matched before any kill (PID + start-time + exePath) so a reused PID can
 * never be mis-killed. There is NO identityToken: Win32_Process exposes no env, and
 * OpenCode `/global/health` returns only `{ healthy, version }`.
 *
 * This module is deterministic and pure: capture takes explicit inputs and parse
 * validates an untrusted record with no I/O, so it is unit-testable without a binary.
 */

import { OPENCODE_PIN } from "./pin.js";

/** The durable identity of a supervised OpenCode child. */
export interface RuntimeProcessIdentity {
  readonly pid: number;
  /** Process start time as an ISO-8601 string (Win32_Process CreationDate on Windows). */
  readonly startTime: string;
  /** Absolute path to the resolved runtime binary. */
  readonly exePath: string;
  readonly port: number;
  readonly host: string;
  /** The pinned runtime version this identity was launched against (SD7 / pin gate). */
  readonly runtimeVersion: string;
}

export interface CaptureIdentityInput {
  readonly pid: number;
  readonly startTime: Date | string;
  readonly exePath: string;
  readonly port: number;
  readonly host: string;
  /** Defaults to the pin ({@link OPENCODE_PIN}) when omitted. */
  readonly runtimeVersion?: string;
}

function toIsoStartTime(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("startTime is an invalid Date");
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`startTime is not a valid date: ${value}`);
  return parsed.toISOString();
}

/**
 * Capture a runtime process identity deterministically from explicit inputs. The
 * result is frozen so it cannot be mutated after capture.
 */
export function captureIdentity(input: CaptureIdentityInput): RuntimeProcessIdentity {
  if (!Number.isInteger(input.pid) || input.pid <= 0) {
    throw new Error(`Invalid pid: ${String(input.pid)}`);
  }
  if (!Number.isInteger(input.port) || input.port <= 0 || input.port > 65535) {
    throw new Error(`Invalid port: ${String(input.port)}`);
  }
  if (!input.exePath.trim()) throw new Error("exePath must be a non-empty string");
  if (!input.host.trim()) throw new Error("host must be a non-empty string");

  return Object.freeze({
    pid: input.pid,
    startTime: toIsoStartTime(input.startTime),
    exePath: input.exePath,
    port: input.port,
    host: input.host,
    runtimeVersion: (input.runtimeVersion ?? OPENCODE_PIN).trim(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`identity record field "${key}" must be a non-empty string`);
  }
  return value;
}

function requireInt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`identity record field "${key}" must be an integer`);
  }
  return value;
}

/**
 * Parse and validate an untrusted identity record (e.g. from `.runtime/pids/*.json`).
 * Deterministic and total: every field is checked; malformed input throws rather than
 * yielding a partially-typed object.
 */
export function parseIdentityRecord(input: unknown): RuntimeProcessIdentity {
  if (!isRecord(input)) throw new Error("identity record must be an object");
  return captureIdentity({
    pid: requireInt(input, "pid"),
    startTime: requireString(input, "startTime"),
    exePath: requireString(input, "exePath"),
    port: requireInt(input, "port"),
    host: requireString(input, "host"),
    runtimeVersion: requireString(input, "runtimeVersion"),
  });
}

/**
 * Re-match a candidate live process against a captured identity before a kill.
 * A reused PID is rejected because start-time and exePath must also match (LC3).
 */
export function identityMatches(
  captured: RuntimeProcessIdentity,
  candidate: Pick<RuntimeProcessIdentity, "pid" | "startTime" | "exePath">,
): boolean {
  return (
    captured.pid === candidate.pid &&
    captured.startTime === candidate.startTime &&
    captured.exePath === candidate.exePath
  );
}
