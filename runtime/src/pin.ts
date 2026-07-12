/**
 * OpenCode version pin — the single source of truth for Cowork GHC (ADR 0001 §1).
 *
 * This constant mirrors the reference `constants.json:2` pattern (`opencodeVersion`)
 * but is Cowork-GHC-owned and NOT copied from the reference source. Upgrading the pin
 * is a gated change (provider contract suite + SSE/event mapping + lifecycle tests must
 * pass on Windows before the pin lands). No floating / `^` range for the runtime binary.
 *
 * SD7: the pinned runtime version is surfaced alongside the app version.
 */

/** The pinned OpenCode version. Do NOT use a range; a single explicit value only. */
export const OPENCODE_PIN = "v1.17.11" as const;

export type OpencodePin = typeof OPENCODE_PIN;

/**
 * Normalize a version string for comparison: trim, lowercase the leading `v`, and
 * drop a single leading `v`/`V`. OpenCode `/global/health` may report `1.17.11`
 * while the pin literal is `v1.17.11` (design §8) — both must compare equal.
 */
export function normalizeVersion(version: string): string {
  const trimmed = version.trim();
  return trimmed.startsWith("v") || trimmed.startsWith("V") ? trimmed.slice(1) : trimmed;
}

/** True when a reported runtime version matches the pin exactly (after normalization). */
export function isPinnedVersion(reportedVersion: string): boolean {
  return normalizeVersion(reportedVersion) === normalizeVersion(OPENCODE_PIN);
}

/** Structured result of gating a reported runtime version against the pin. */
export interface PinGateResult {
  readonly ok: boolean;
  readonly expected: string;
  readonly actual: string;
}

/** Compare a reported runtime version against the pin without throwing. */
export function checkPin(reportedVersion: string): PinGateResult {
  return {
    ok: isPinnedVersion(reportedVersion),
    expected: OPENCODE_PIN,
    actual: reportedVersion.trim(),
  };
}

/** Error raised when a reported runtime version does not match the pin. */
export class PinMismatchError extends Error {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`OpenCode runtime version mismatch: expected pin ${expected}, got ${actual}`);
    this.name = "PinMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Assert a reported runtime version matches the pin, throwing {@link PinMismatchError}
 * on mismatch. Used at launch/health-check time to reject an unexpected binary before
 * any session runs against it.
 */
export function assertPinnedVersion(reportedVersion: string): void {
  const result = checkPin(reportedVersion);
  if (!result.ok) {
    throw new PinMismatchError(result.expected, result.actual);
  }
}

/** Version surface for SD7 (runtime side). The app version is composed by the service. */
export interface RuntimeVersionInfo {
  readonly runtimePin: string;
}

/** Surface the pinned runtime version (SD7 source). */
export function runtimeVersionInfo(): RuntimeVersionInfo {
  return { runtimePin: OPENCODE_PIN };
}
