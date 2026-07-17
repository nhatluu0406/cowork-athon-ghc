/**
 * Target fingerprint for provider connection verification.
 *
 * Bound to non-secret profile fields only. Never include raw API key material.
 */

import { createHash } from "node:crypto";

export interface VerificationTargetInput {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly credentialRevision: number;
}

/** Stable sha256 of endpoint + model + credential revision (no secret bytes). */
export function computeVerifiedTargetFingerprint(input: VerificationTargetInput): string {
  const normalized =
    `${input.baseUrl.trim()}|${input.modelId.trim()}|cred:${Math.max(0, Math.floor(input.credentialRevision))}`;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function isVerificationCurrent(
  storedFingerprint: string | undefined,
  current: VerificationTargetInput,
): boolean {
  if (storedFingerprint === undefined || storedFingerprint.length === 0) return false;
  return storedFingerprint === computeVerifiedTargetFingerprint(current);
}
