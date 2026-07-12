/**
 * Shared validation for environment variable NAMES (not values).
 *
 * A valid name starts with a letter or underscore and contains only letters, digits,
 * and underscores — the POSIX-style identifier shape. This is the single source of
 * truth reused by both the provider-env map and the launch-config injector so an
 * unsafe name (spaces, shell metacharacters, leading digit) can never reach a spawn.
 */

const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/i;

/** True when `name` is a safe environment variable identifier. */
export function isValidEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name);
}
