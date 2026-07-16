/**
 * Vault-backed CredentialStore (ADR 0007). Requires unlock before get/set.
 * kind remains compatible with the credential port; values never appear in logs.
 */

import { randomUUID } from "node:crypto";
import type { CredentialStore } from "../credential/store.js";
import { CredentialStoreError } from "../credential/store.js";
import type { LocalAuthService } from "./local-auth.js";
import type { SecretsRepository } from "./repositories.js";
import { decryptSecret, encryptSecret } from "./vault-crypto.js";

export type VaultCredentialStoreKind = "vault";

export interface VaultCredentialStore extends CredentialStore {
  readonly kind: VaultCredentialStoreKind;
}

export function createVaultCredentialStore(deps: {
  readonly auth: LocalAuthService;
  readonly secrets: SecretsRepository;
  readonly now?: () => string;
  readonly id?: () => string;
}): VaultCredentialStore {
  const now = deps.now ?? (() => new Date().toISOString());
  const id = deps.id ?? (() => randomUUID());

  const requireMasterKey = (): Buffer => {
    const key = deps.auth.masterKey();
    if (key === null) {
      throw new CredentialStoreError("Vault is locked.", "vault");
    }
    return key;
  };

  return {
    kind: "vault",
    async set(account, secret) {
      const masterKey = requireMasterKey();
      const aad = `secret:${account}`;
      const enc = encryptSecret(masterKey, secret, aad);
      const existing = deps.secrets.get(account);
      const at = now();
      deps.secrets.upsert({
        id: existing?.id ?? id(),
        account,
        ciphertext: enc.ciphertext,
        nonce: enc.nonce,
        tag: enc.tag,
        aad,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      });
    },
    async get(account) {
      const masterKey = requireMasterKey();
      const record = deps.secrets.get(account);
      if (record === null) return null;
      const plain = decryptSecret(
        masterKey,
        {
          ciphertext: record.ciphertext,
          nonce: record.nonce,
          tag: record.tag,
        },
        record.aad,
      );
      if (plain === null) {
        throw new CredentialStoreError("Failed to decrypt vault secret.", account);
      }
      return plain;
    },
    async delete(account) {
      requireMasterKey();
      return deps.secrets.delete(account);
    },
  };
}
