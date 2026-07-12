/**
 * CredentialStore port (ADR 0006 / SEC-1, PR9).
 *
 * The single, provider-neutral seam over the ONE at-rest credential store (Windows
 * Credential Manager via `@napi-rs/keyring`). App/session state and the renderer never
 * hold key bytes — only a {@link CredentialRef} handle. The port makes the credential
 * logic testable with an in-memory fake while production uses the real keyring adapter.
 *
 * SECURITY: implementations must NEVER write key material to `auth.json`/`env.json`, an
 * app-state file, `.runtime/`, or any diagnostics/backup location. The only place a key
 * value ever leaves the store is the launch-time injection boundary (see credential-service).
 */

import type { CredentialRef } from "@cowork-ghc/contracts";

/** Which backing store an adapter is. The persisted {@link CredentialRef} stays `"os"`. */
export type CredentialStoreKind = "os" | "memory";

/**
 * Provider-neutral credential store port. Every method is async so the real OS-backed
 * adapter (native, potentially slow) and an in-memory fake share one interface.
 */
export interface CredentialStore {
  /** Which backing store this is (diagnostics/tests only; never affects the ref shape). */
  readonly kind: CredentialStoreKind;
  /** Store (or overwrite) the secret for `account`. The value is never logged. */
  set(account: string, secret: string): Promise<void>;
  /** Resolve the secret for `account`, or `null` when there is no entry. */
  get(account: string): Promise<string | null>;
  /** Delete the entry for `account`; `true` if one existed and was removed. */
  delete(account: string): Promise<boolean>;
}

/**
 * The Windows Credential Manager "service"/target name under which every Cowork GHC
 * credential entry is stored. One store, one namespace.
 */
export const CREDENTIAL_SERVICE_NAME = "cowork-ghc" as const;

/** A store-level failure. Messages NEVER contain secret material (account name only). */
export class CredentialStoreError extends Error {
  readonly account: string;
  constructor(message: string, account: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CredentialStoreError";
    this.account = account;
  }
}

/** Raised when a ref resolves to no entry at the injection boundary. */
export class CredentialNotFoundError extends Error {
  readonly account: string;
  constructor(account: string) {
    super(`No credential stored for account ${JSON.stringify(account)}.`);
    this.name = "CredentialNotFoundError";
    this.account = account;
  }
}

// A plain account string only — no control chars, no leading/trailing whitespace.
const ACCOUNT_RE = /^[A-Za-z0-9:._-]+$/;

/**
 * Derive the stable store account for a provider credential, or validate a caller-
 * supplied override. Deterministic and secret-free — this string IS `CredentialRef.account`.
 */
export function credentialAccountFor(providerId: string, account?: string): string {
  const raw = (account ?? `provider:${providerId.trim()}`).trim();
  if (!raw) {
    throw new Error("Credential account must be a non-empty string.");
  }
  if (raw.length > 256 || !ACCOUNT_RE.test(raw)) {
    throw new Error(`Invalid credential account: ${JSON.stringify(raw)}.`);
  }
  return raw;
}

/** Build the handle persisted in app state. It is NOT a key — only a lookup handle. */
export function credentialRef(account: string): CredentialRef {
  return { store: "os", account };
}
