/**
 * Value-based secret redaction for ENV MAPS (design §6, SEC-2).
 *
 * SCOPE — env maps ONLY. These helpers do whole-value equality on the values of a
 * `Record<string, string>` (an environment map). They are correct for env maps because
 * each value is a complete field. They are NOT safe for free-form strings (log lines,
 * command strings): a secret embedded as a substring would NOT be matched and
 * `envMapContainsNoSecret` would return `true` (a false safety signal). The free-form
 * substring scrubber is a separate concern owned by CGHC-021.
 *
 * Redaction matches the secret VALUE, not the env var NAME — name-only matching leaks
 * the value (reference anti-pattern context: `managed-opencode.ts:27,87`).
 */

const REDACTED = "<redacted>";

/**
 * Return a copy of `env` with any value exactly equal to a known secret replaced by
 * `<redacted>`. Env-map only (see module scope). Empty/whitespace secret values are
 * ignored (they cannot be matched safely). `undefined` values are dropped.
 */
export function redactEnvMapValues(
  env: Readonly<Record<string, string | undefined>>,
  secretValues: readonly string[],
): Record<string, string> {
  const secrets = new Set(secretValues.filter((value) => value.length > 0));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    out[key] = secrets.has(value) ? REDACTED : value;
  }
  return out;
}

/**
 * True when no VALUE in the env-map snapshot is exactly equal to any provided secret.
 * Env-map only — do NOT use this on free-form strings; a substring secret would pass.
 */
export function envMapContainsNoSecret(
  snapshot: Readonly<Record<string, string>>,
  secretValues: readonly string[],
): boolean {
  const secrets = new Set(secretValues.filter((value) => value.length > 0));
  return !Object.values(snapshot).some((value) => secrets.has(value));
}
