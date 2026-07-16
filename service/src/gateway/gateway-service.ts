import type { CredentialRef } from "@cowork-ghc/contracts";
import type { GatewayStore } from "./gateway-store.js";
import type { AddAccountInput, GatewayAccount, GatewayStatus } from "./types.js";

export interface GatewayService {
  listAccounts(): readonly GatewayAccount[];
  addAccount(input: AddAccountInput): Promise<GatewayAccount>;
  removeAccount(id: string): Promise<void>;
  activateAccount(id: string): Promise<void>;
  getStatus(): GatewayStatus;
}

export interface GatewayServiceOptions {
  readonly store: GatewayStore;
  readonly storeCredential: (account: string, key: string) => Promise<CredentialRef>;
  readonly removeCredential: (ref: CredentialRef) => Promise<void>;
  readonly generateId: () => string;
  readonly now: () => string;
}

export function createGatewayService(options: GatewayServiceOptions): GatewayService {
  const { store, storeCredential, removeCredential, generateId, now } = options;

  return {
    listAccounts(): readonly GatewayAccount[] {
      return store.listAccounts();
    },

    async addAccount(input: AddAccountInput): Promise<GatewayAccount> {
      const { providerId, label, apiKey } = input;
      if (typeof providerId !== "string" || providerId.trim().length === 0) {
        throw new Error("providerId is required.");
      }
      if (typeof label !== "string" || label.trim().length === 0) {
        throw new Error("label is required.");
      }
      if (typeof apiKey !== "string" || apiKey.length === 0) {
        throw new Error("apiKey is required.");
      }
      const id = generateId();
      const credentialRef = await storeCredential(`gateway:${id}`, apiKey);
      const account: GatewayAccount = {
        id,
        providerId,
        label,
        credentialRef,
        isActive: false,
        addedAt: now(),
      };
      store.saveAccount(account);
      await store.flush();
      return account;
    },

    async removeAccount(id: string): Promise<void> {
      const accounts = store.listAccounts();
      const account = accounts.find((a) => a.id === id);
      if (account === undefined) {
        throw new Error(`Gateway account not found: ${id}`);
      }
      await removeCredential(account.credentialRef);
      store.deleteAccount(id);
      await store.flush();
    },

    async activateAccount(id: string): Promise<void> {
      const accounts = store.listAccounts();
      const account = accounts.find((a) => a.id === id);
      if (account === undefined) {
        throw new Error(`Gateway account not found: ${id}`);
      }
      store.setActiveAccount(account.providerId, id);
      await store.flush();
    },

    getStatus(): GatewayStatus {
      const accounts = store.listAccounts();
      const activeByProvider: Record<string, string> = {};
      for (const account of accounts) {
        const activeId = store.getActiveAccountId(account.providerId);
        if (activeId !== undefined) {
          activeByProvider[account.providerId] = activeId;
        }
      }
      const health = accounts.length > 0 ? "healthy" : "unknown";
      return { health, accounts, activeByProvider };
    },
  };
}
