/**
 * Provider contract types (PR1–PR10).
 *
 * Consumed by: CGHC-009/010 (ProviderPort + credential wiring) and CGHC-019/020
 * (model config/switch + provider error handling). These are the provider-neutral
 * shapes shared by every surface. The `ProviderPort` INTERFACE itself (streamChat,
 * testConnection, etc.) lives in the service layer, not here — this package holds
 * only the transport-free data types that a UI or web client also needs.
 *
 * Secret discipline: credentials cross the port only as a `CredentialRef` handle
 * (ADR 0005:39,52-55); no type here carries key bytes. The value-bearing redaction
 * pattern used by the scrubber is deliberately NOT in this shared barrel — it holds
 * a plaintext secret and must stay service-private (CGHC-021/022 defines it there).
 */

import type { CredentialRef, ModelRef } from "./refs.js";

/** Logical provider id. Presets below; the list is user-extensible (PR1). */
export type ProviderId = string;

/** The five target providers (PR10); the 5th is a user-defined OpenAI-compatible endpoint. */
export const KNOWN_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "custom-openai-compat",
] as const;

/** How a provider authenticates. */
export type AuthKind = "api_key" | "api_key_custom_header";

/** A field the user must supply to configure a provider (e.g. base_url for custom). */
export interface ProviderField {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  /** Marks a value that must be redacted/stored as a secret (never echoed). */
  readonly secret: boolean;
}

/** A model offered by a provider. */
export interface ModelDescriptor {
  readonly ref: ModelRef;
  readonly displayName: string;
}

/** Provider capability + config descriptor (PR1). */
export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly authKind: AuthKind;
  readonly requiredFields: readonly ProviderField[];
  readonly models: readonly ModelDescriptor[];
  /** Whether this provider has been exercised with a live key (PR10). */
  readonly liveTested: boolean;
}

/** Result of a bounded connection probe (PR3). */
export interface TestResult {
  readonly ok: boolean;
  /** Present when `ok` is false — a mapped, non-secret error. */
  readonly error?: ProviderError;
}

/** Canonical provider error taxonomy, enforced at the boundary (PR7). */
export type ProviderErrorKind =
  | "auth_invalid"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "unknown";

/** A mapped provider error; the UI formats it and never invents semantics (PR7/EV6). */
export interface ProviderError {
  readonly kind: ProviderErrorKind;
  /** Non-secret, user-facing message. */
  readonly message: string;
  /** Whether the boundary may retry (retries are always bounded). */
  readonly retryable: boolean;
  /** Recovery hint surfaced to the UI. */
  readonly recovery: string;
}

/** A credential binding: provider id + the handle used to resolve the secret late. */
export interface ProviderCredentialBinding {
  readonly providerId: ProviderId;
  readonly ref: CredentialRef;
}

/** Scope of a model selection (default vs per-session override, PR4/PR5). */
export type ModelSelectionScope = "default" | "session";

/** A model-selection request (secret-free, safe to persist). */
export interface ModelSelection {
  readonly scope: ModelSelectionScope;
  /** Required when `scope` is `"session"`. */
  readonly sessionId?: string;
  readonly model: ModelRef;
}
