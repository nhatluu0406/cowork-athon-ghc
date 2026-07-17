/**
 * Failure isolation (CGHC-026 RE5) — the load-bearing safety property of this layer.
 *
 * `runIsolated` wraps any fallible extension op (a skill run, an MCP connect, a template
 * resolution). If the op THROWS or REJECTS, the error is:
 *  1. reduced to a single, secret-free line via the injected redactor (default: the shared
 *     shape-based {@link sanitizeErrorMessage}; the composition root injects the composed
 *     VALUE-scrub-then-shape redactor so a known key value is redacted too),
 *  2. recorded as an {@link ExtensionDiagnostic} in the ONE {@link ExtensionState} (which also
 *     marks the extension `failed`/quarantined),
 *  3. returned as a typed {@link ExtOutcome} `err`.
 *
 * The exception NEVER propagates past this boundary, so a broken skill/plugin/MCP cannot crash
 * the registry or the session that uses it. A quarantined extension is skipped by its registry
 * (not re-invoked), so there is no crash/retry loop.
 */

import { sanitizeErrorMessage } from "../execution/index.js";
import type { ExtensionState } from "./extension-state.js";
import { err, type ExtensionDiagnostic, type ExtensionKind, type ExtOutcome } from "./types.js";

/** Injected redactor: raw error text → secret-free single line. */
export type ExtRedactor = (message: string) => string;

/** Extract a message from an unknown throw without echoing a stack or a secret. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return "The extension operation failed.";
}

export interface IsolateContext {
  readonly state: ExtensionState;
  readonly kind: ExtensionKind;
  readonly id: string;
  readonly name: string;
  /** Defaults to the shared shape-based sanitizer. */
  readonly redact?: ExtRedactor;
}

/**
 * The shared failure path for both the async and sync isolators. The catch body itself is
 * hardened: an injected `redact` that THROWS falls back to a constant `"[redacted]"`, and a
 * `state.fail` that THROWS is swallowed (the outcome still comes back typed). This keeps the
 * "isolation never re-throws" guarantee even for an arbitrary/hostile redactor or state.
 */
function captureFailure<T>(ctx: IsolateContext, error: unknown): ExtOutcome<T> {
  const redact = ctx.redact ?? sanitizeErrorMessage;
  let reason: string;
  try {
    reason = redact(describeError(error));
  } catch {
    reason = "[redacted]";
  }
  let diagnostic: ExtensionDiagnostic | undefined;
  try {
    diagnostic = ctx.state.fail(ctx.kind, ctx.id, ctx.name, reason);
  } catch {
    diagnostic = undefined; // a throwing injected state cannot break the no-throw guarantee.
  }
  return err<T>("extension_failed", `Extension "${ctx.name}" failed and was quarantined.`, diagnostic);
}

/**
 * Run `op` under RE5 isolation. On throw/reject: redact → diagnostic (quarantine) → typed
 * `extension_failed` error. On success: `ok(value)`. Never re-throws.
 */
export async function runIsolated<T>(
  ctx: IsolateContext,
  op: () => T | Promise<T>,
): Promise<ExtOutcome<T>> {
  try {
    const value = await op();
    return { ok: true, value };
  } catch (error) {
    return captureFailure<T>(ctx, error);
  }
}

/**
 * Synchronous sibling of {@link runIsolated} for a fallible SYNC seam (e.g. a persistent
 * {@link import("./template-store.js").TemplateStore} whose `save`/`get` may throw on a locked
 * or full disk). Same guarantee: a throw becomes a redacted diagnostic + typed error, never an
 * escape.
 */
export function runIsolatedSync<T>(ctx: IsolateContext, op: () => T): ExtOutcome<T> {
  try {
    return { ok: true, value: op() };
  } catch (error) {
    return captureFailure<T>(ctx, error);
  }
}
