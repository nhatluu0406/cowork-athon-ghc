/**
 * Scrub-before-emit seam for the boundary error path (CGHC-002 `http-service.ts::fail()`)
 * and the local audit log (CGHC-016). Those layers already fail-safe (generic messages
 * for non-boundary errors), but a boundary-owned error message OR an audit detail could
 * still carry a secret value pulled from an upstream string. This helper wraps any such
 * message with the value-based scrubber before it reaches a client, a log, or an audit
 * record — closing the CGHC-002 carry-forward item "redaction MUST wrap the error path
 * before any handler message reaches the client".
 *
 * It never rethrows and never surfaces a raw stack trace to the caller — it returns a
 * redacted, client-safe string.
 */

import type { SecretScrubber } from "./secret-scrubber.js";

/** Extract a message from an unknown thrown value without leaking a stack trace. */
function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object" && "message" in err) {
    const value = (err as { message: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "Unknown error.";
}

/** Redact a plain message string before it is emitted to a client/log. */
export function redactMessageForEmit(scrubber: SecretScrubber, message: string): string {
  return scrubber.scrub(message);
}

/**
 * Redact an unknown thrown value into a client-safe, secret-free message. Use at the
 * boundary error path before writing an error envelope, and in the audit sink before
 * persisting a detail string.
 */
export function redactErrorForEmit(scrubber: SecretScrubber, err: unknown): string {
  return scrubber.scrub(messageOf(err));
}
