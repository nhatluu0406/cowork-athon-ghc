/**
 * Reference handles — the shared "point-to-it, never-carry-the-secret" types.
 *
 * Consumed by: CGHC-009/010 (provider + credential), CGHC-019/020 (model config).
 *
 * Invariant (SEC-1 / PR9, ADR 0006): a credential is referenced by a handle only.
 * There is deliberately NO type here that can carry raw key bytes — the material is
 * resolved from the OS store and injected at the execution boundary at launch/call
 * time, never in the renderer, never persisted into app state (ADR 0005:52-55).
 */

/**
 * A logical, late-resolved model reference. Secret-free and safe to persist
 * (ADR 0001, ADR 0005:48). Provider-specific naming (e.g. an OpenRouter `vendor/`
 * prefix) is applied only at the adapter edge, never stored in app state.
 */
export interface ModelRef {
  /** Logical provider id (see `ProviderId` in provider.ts). */
  readonly providerID: string;
  /** Logical model id as understood by the provider. */
  readonly modelID: string;
}

/**
 * A handle into the OS-backed credential store (ADR 0006). This is NOT a key.
 * `store` is fixed to `"os"` today; it is a discriminant so a future ADR can add
 * another backing store without breaking existing refs.
 */
export interface CredentialRef {
  readonly store: "os";
  /** Account/entry name used to look the secret up in the OS store. */
  readonly account: string;
}
