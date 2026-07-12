/**
 * Per-launch boundary client token (ADR 0003, MED-1).
 *
 * The service issues one unpredictable token per launch so a co-resident local process
 * cannot trivially call the loopback boundary. The token is a per-launch SECRET and is
 * NON-PERSISTENT: it lives only in process memory. This module imports NO filesystem API
 * by design, so there is no code path here that could write the token to disk. It is
 * distinct from the ADR 0004 supervision identity (a non-secret PID/port tuple).
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** 256 bits of entropy, hex-encoded (64 chars). */
const TOKEN_BYTES = 32;

/** Minimum acceptable length for a caller-supplied token (a fail-closed footgun guard). */
const MIN_CONFIGURED_TOKEN_LENGTH = 32;

/** Generate a fresh, unpredictable per-launch client token. Never persisted. */
export function generateClientToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** Raised when a caller configures an empty/too-short client token. */
export class WeakClientTokenError extends Error {
  readonly code = "weak_client_token";
  constructor() {
    super(
      `Configured clientToken must be a string of at least ${MIN_CONFIGURED_TOKEN_LENGTH} ` +
        `characters; an empty/short token would silently lock out all clients.`,
    );
    this.name = "WeakClientTokenError";
  }
}

/**
 * Validate a caller-supplied token, returning it on success. An empty or too-short token
 * is rejected with {@link WeakClientTokenError} rather than silently accepted (which would
 * fail closed but be an opaque footgun).
 */
export function assertConfiguredToken(token: string): string {
  if (typeof token !== "string" || token.length < MIN_CONFIGURED_TOKEN_LENGTH) {
    throw new WeakClientTokenError();
  }
  return token;
}

/**
 * Constant-time comparison of a presented token against the expected token. Both sides
 * are hashed to a fixed-length digest first so neither length nor content leaks through
 * timing. Returns `false` for an empty/undefined presented token.
 */
export function verifyClientToken(expected: string, provided: string | undefined): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

/**
 * Extract the client token from a request header set. Accepts either
 * `Authorization: Bearer <token>` or the explicit `x-cowork-token` header.
 */
export function extractClientToken(headers: {
  authorization?: string | undefined;
  xCoworkToken?: string | undefined;
}): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match && match[1]) return match[1].trim();
  }
  if (typeof headers.xCoworkToken === "string" && headers.xCoworkToken.length > 0) {
    return headers.xCoworkToken.trim();
  }
  return undefined;
}

/** Result of the token guard check. */
export type TokenCheck = "ok" | "missing" | "invalid";

/** Classify a presented token against the expected per-launch token. */
export function checkClientToken(expected: string, provided: string | undefined): TokenCheck {
  if (provided === undefined) return "missing";
  return verifyClientToken(expected, provided) ? "ok" : "invalid";
}
