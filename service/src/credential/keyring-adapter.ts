/**
 * Real `@napi-rs/keyring` adapter — the ONE OS-backed credential store (ADR 0006).
 *
 * Backed by Windows Credential Manager. The key material lives ONLY in the OS vault; this
 * adapter reads/writes vault entries and never persists anything to disk itself. The
 * native module is loaded lazily so a sandbox/CI host without the native binding (or
 * without an accessible Credential Manager) can skip the real round-trip gracefully while
 * every other test runs against {@link createMemoryStore}.
 */

import type { Entry as KeyringEntry } from "@napi-rs/keyring";
import { CREDENTIAL_SERVICE_NAME, CredentialStoreError, type CredentialStore } from "./store.js";

type KeyringEntryCtor = new (service: string, username: string) => KeyringEntry;

/** Raised when the native keyring module / OS credential store cannot be used here. */
export class KeyringUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Windows Credential Manager (@napi-rs/keyring) is unavailable in this environment.");
    this.name = "KeyringUnavailableError";
    this.cause = cause;
  }
}

let cachedCtor: KeyringEntryCtor | undefined;

/** Lazily load the native `Entry` constructor, mapping any load failure to a typed error. */
async function loadEntryCtor(): Promise<KeyringEntryCtor> {
  if (cachedCtor) return cachedCtor;
  try {
    const mod = await import("@napi-rs/keyring");
    cachedCtor = mod.Entry as unknown as KeyringEntryCtor;
    return cachedCtor;
  } catch (cause) {
    throw new KeyringUnavailableError(cause);
  }
}

/**
 * Probe whether the real store works here (native binding present AND a benign
 * set/get/delete round-trip succeeds). Used by the gated integration test to skip
 * gracefully. Cleans up its own probe entry and never throws.
 */
export async function keyringAvailable(): Promise<boolean> {
  try {
    const Entry = await loadEntryCtor();
    const probe = new Entry(CREDENTIAL_SERVICE_NAME, "__cowork_ghc_probe__");
    probe.setPassword("probe");
    const value = probe.getPassword();
    probe.deletePassword();
    return value === "probe";
  } catch {
    return false;
  }
}

/**
 * Create the OS-backed credential store. Rejects with {@link KeyringUnavailableError} if
 * the native module cannot load. One `Entry` per (service, account); service name is the
 * single Cowork GHC namespace.
 */
export async function createKeyringStore(
  serviceName: string = CREDENTIAL_SERVICE_NAME,
): Promise<CredentialStore> {
  const Entry = await loadEntryCtor();
  const entryFor = (account: string): KeyringEntry => new Entry(serviceName, account);

  return {
    kind: "os",
    set(account: string, secret: string): Promise<void> {
      try {
        entryFor(account).setPassword(secret);
        return Promise.resolve();
      } catch (cause) {
        return Promise.reject(
          new CredentialStoreError("Failed to store credential in the OS store.", account, {
            cause,
          }),
        );
      }
    },
    get(account: string): Promise<string | null> {
      try {
        // getPassword() returns the value or null when there is no entry.
        return Promise.resolve(entryFor(account).getPassword() ?? null);
      } catch (cause) {
        return Promise.reject(
          new CredentialStoreError("Failed to read credential from the OS store.", account, {
            cause,
          }),
        );
      }
    },
    delete(account: string): Promise<boolean> {
      try {
        return Promise.resolve(entryFor(account).deletePassword());
      } catch {
        // A missing entry is not an error for delete — report "nothing removed".
        return Promise.resolve(false);
      }
    },
  };
}
