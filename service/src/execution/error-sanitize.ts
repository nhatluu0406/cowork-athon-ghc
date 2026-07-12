/**
 * Shared, browser-safe EV error-message sanitizer (CGHC-015 security co-sign, HIGH-S1/HIGH-S2).
 *
 * A single source of truth for turning an UNTRUSTED runtime error string into a user-safe,
 * single-line message with no stack frame and no secret-looking substring. It is a PURE
 * string transform with NO side effects and NO `node:` imports, so it is importable both by
 * the service (mapper choke point — the real server-side redaction) and by the renderer
 * (defense in depth). Promoting this from the old renderer-only `app/ui/src/ev-error-scrub.ts`
 * removes the duplicate/divergent copy and fixes the reviewer-found pattern bugs.
 *
 * This is SHAPE-based redaction (it recognises secret-looking shapes). It complements — and
 * does NOT replace — the VALUE-based `SecretScrubber` (redacts a known secret by its literal
 * value regardless of shape). The composition root composes both: `SecretScrubber.scrub` THEN
 * `sanitizeErrorMessage` (see `ev-mapper.ts` `redactError`).
 *
 *  - Only the FIRST line survives (stack frames on later lines are dropped); an inline
 *    `at file:line:col` frame on that first line is stripped.
 *  - Secret-looking substrings are replaced with a fixed, non-secret placeholder — the
 *    matched value is NEVER echoed back.
 *  - All quantifiers are bounded and the input is length-capped, so a hostile/huge message
 *    cannot cause catastrophic backtracking or a pathological scrub cost (anti-DoS).
 */

/** Placeholder written in place of any redacted secret-looking substring. Never reversible. */
export const REDACTED = "[redacted]";

/**
 * Hard cap applied to the raw input BEFORE any regex work, bounding worst-case scrub cost on a
 * hostile/huge message (anti-DoS). Well above any legitimate one-line runtime error.
 */
export const MAX_INPUT_LENGTH = 20_000;

/** Display cap applied AFTER scrubbing, so a redacted-but-still-long line stays presentable. */
export const MAX_OUTPUT_LENGTH = 2_000;

/** Fallback when the message is empty after stripping (never return an empty string). */
const EMPTY_FALLBACK = "An error occurred.";

/**
 * A real stack frame appended INLINE to the first line: `… at fn (path:line:col)` or
 * `… at path:line:col`. Bounded: `[^\n]*?` (no newline, lazy) up to the first `:line:col`.
 */
const INLINE_STACK = /\s+at\s+[^\n]*?:\d+:\d+[^\n]*$/i;

/**
 * Secret shapes to redact. All quantifiers are bounded or linear (no nested/ambiguous
 * quantifiers), so none can trigger catastrophic backtracking. Ordered specific → generic;
 * key=value runs first so `access_token=<jwt>` is redacted whole before the inner JWT is
 * examined. Each is global + case-insensitive where appropriate.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // key=value / key: value secrets. Optional key prefix fixes the word-boundary bug where
  // `access_token=`, `refresh_token=`, `id_token=`, `auth_token=`, `api_key=` slipped past
  // a bare `\btoken`. The value run is bounded to avoid pathological input.
  /(?:access|refresh|id|auth|api|client)?[_-]?(?:token|key|secret|password)\s*[=:]\s*\S{1,4096}/gi,
  // `Authorization: Bearer <cred>` — value may contain +, /, =, ., -, _.
  /Bearer\s+[A-Za-z0-9+/=._-]{6,4096}/gi,
  // OpenAI/Anthropic-style keys.
  /sk-[A-Za-z0-9._-]{6,4096}/gi,
  // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ and fine-grained github_pat_.
  /gh[pousr]_[A-Za-z0-9]{20,255}/g,
  /github_pat_[A-Za-z0-9_]{20,255}/g,
  // JSON Web Token (three base64url segments).
  /eyJ[A-Za-z0-9_-]{4,4096}\.[A-Za-z0-9_-]{4,4096}\.[A-Za-z0-9_-]{4,4096}/g,
  // AWS access key id.
  /AKIA[0-9A-Z]{16}/g,
  // Slack tokens.
  /xox[baprs]-[A-Za-z0-9-]{6,4096}/g,
  // Google API key.
  /AIza[0-9A-Za-z_-]{35}/g,
  // Long hex — includes the 64-hex per-launch client token.
  /\b[0-9a-f]{32,4096}\b/gi,
  // Generic long base64/base62 run (catch-all for opaque high-entropy credentials).
  /[A-Za-z0-9+/_-]{40,4096}={0,2}/g,
];

/**
 * Return a user-safe error message: a single line, no stack frame, and no secret-looking
 * substring. Never returns an empty string. Length-capped on input (anti-DoS) and output.
 */
export function sanitizeErrorMessage(raw: string): string {
  const capped = raw.length > MAX_INPUT_LENGTH ? raw.slice(0, MAX_INPUT_LENGTH) : raw;
  const firstLine = (capped.split(/\r\n|\r|\n/, 1)[0] ?? "").trim();
  const noStack = firstLine.replace(INLINE_STACK, "").trim();
  let out = noStack.length > 0 ? noStack : EMPTY_FALLBACK;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.trim();
  if (out.length === 0) return EMPTY_FALLBACK;
  return out.length > MAX_OUTPUT_LENGTH ? `${out.slice(0, MAX_OUTPUT_LENGTH)}…` : out;
}
