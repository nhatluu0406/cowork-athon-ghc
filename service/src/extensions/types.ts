/**
 * Shared extension types (CGHC-026, RE1/RE2/RE4/RE5).
 *
 * The runtime-extension layer is a SEAM-based POC: the skill registry, MCP lifecycle, and
 * workflow templates each drive a fallible, injectable adapter (SkillRunner / McpAdapter /
 * TemplateStore) whose HONEST default never fabricates a live result. Every fallible op is
 * wrapped so a broken extension surfaces a structured {@link ExtensionDiagnostic} and is
 * quarantined — it can NEVER throw out of the registry and crash a session (RE5).
 *
 * These types are pure (no `node:` imports) so both the service and a future router/UI can
 * import them. Live skill execution / a live MCP process are Tier 2 (CGHC-028) — not here.
 */

/** The three extension kinds this layer manages. */
export type ExtensionKind = "skill" | "mcp" | "template";

/**
 * The ONE status vocabulary for every extension, in the single {@link
 * import("./extension-state.js").ExtensionState} source of truth:
 *  - `enabled`  — active / usable.
 *  - `disabled` — present but intentionally off.
 *  - `failed`   — quarantined after a captured failure (RE5); skipped, NOT retried.
 */
export type ExtensionStatus = "enabled" | "disabled" | "failed";

/**
 * A structured, SECRET-FREE record of one extension failure (RE5). `reason` is always run
 * through the redaction discipline (`sanitizeErrorMessage` + optional value-scrub) before it
 * is stored, so raw runtime error text / a leaked key never lands here.
 */
export interface ExtensionDiagnostic {
  readonly kind: ExtensionKind;
  /** The extension's human name/id (what surfaces to the operator). */
  readonly name: string;
  /** A redacted, single-line reason — never a raw stack, never a secret. */
  readonly reason: string;
  /** When the failure was captured (ISO-8601, from the injected clock). */
  readonly at: string;
}

/** Typed error codes returned by extension operations (never a thrown escape). */
export type ExtensionErrorCode =
  | "unknown_extension"
  | "extension_disabled"
  | "extension_failed"
  | "duplicate_extension"
  | "invalid_input"
  | "endpoint_blocked"
  | "unavailable"
  | "quarantined";

/** An honest, typed operation error. Carries the diagnostic when the cause was a failure. */
export interface ExtensionError {
  readonly code: ExtensionErrorCode;
  /** A user-safe, secret-free message. */
  readonly message: string;
  /** Present when the error was produced by capturing a runtime failure (RE5). */
  readonly diagnostic?: ExtensionDiagnostic;
}

/** The result of any fallible extension operation: a value, or a typed error (never a throw). */
export type ExtOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ExtensionError };

/** Construct a success outcome. */
export function ok<T>(value: T): ExtOutcome<T> {
  return { ok: true, value };
}

/** Construct a typed-error outcome. */
export function err<T>(
  code: ExtensionErrorCode,
  message: string,
  diagnostic?: ExtensionDiagnostic,
): ExtOutcome<T> {
  return {
    ok: false,
    error: diagnostic ? { code, message, diagnostic } : { code, message },
  };
}
