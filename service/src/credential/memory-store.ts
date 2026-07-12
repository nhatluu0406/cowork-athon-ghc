/**
 * In-memory CredentialStore fake (ADR 0006 test seam).
 *
 * A process-memory-only double of the OS-backed store, used by unit/contract tests and
 * for CI where Windows Credential Manager is unavailable. It holds secrets in a `Map` and
 * writes NOTHING to disk — so the same no-key-at-rest invariants can be exercised without
 * the native module. The real store is {@link createKeyringStore} (keyring-adapter.ts).
 */

import type { CredentialStore } from "./store.js";

/** Create an empty in-memory credential store. Never touches the filesystem. */
export function createMemoryStore(): CredentialStore {
  const entries = new Map<string, string>();
  return {
    kind: "memory",
    set(account: string, secret: string): Promise<void> {
      entries.set(account, secret);
      return Promise.resolve();
    },
    get(account: string): Promise<string | null> {
      return Promise.resolve(entries.has(account) ? (entries.get(account) as string) : null);
    },
    delete(account: string): Promise<boolean> {
      return Promise.resolve(entries.delete(account));
    },
  };
}
