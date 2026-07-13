/**
 * Profile id validation — blocks path/keyring injection via profile identifiers.
 */

const PROFILE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export class InvalidProfileIdError extends Error {
  constructor(id: string) {
    super(`Invalid provider profile id: ${JSON.stringify(id)}.`);
    this.name = "InvalidProfileIdError";
  }
}

/** Validate a caller-supplied profile id. */
export function assertValidProfileId(id: string): string {
  const trimmed = id.trim();
  if (!PROFILE_ID_RE.test(trimmed)) {
    throw new InvalidProfileIdError(id);
  }
  return trimmed;
}

/** Sanitize a fragment for env-var derivation (uppercase identifier). */
export function envVarSuffixForProfileId(profileId: string): string {
  const safe = profileId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return safe.length > 0 ? safe.slice(0, 32) : "PROFILE";
}
