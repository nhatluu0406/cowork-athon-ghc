/**
 * Provider profile persistence and CRUD (application layer).
 */

import { randomUUID } from "node:crypto";
import type { CredentialRef } from "@cowork-ghc/contracts";
import type { SettingsStore } from "../diagnostics/settings-store.js";
import type { PersistedProviderProfile } from "../diagnostics/settings-types.js";
import { credentialAccountForProfile } from "../credential/store.js";
import { upsertLegacyProviderFromProfile } from "./migration.js";
import {
  defaultDisplayNameForType,
  defaultEnvVarForProfile,
  normalizeCreateInput,
} from "./presets.js";
import { assertValidProfileId } from "./profile-id.js";
import type {
  CreateProviderProfileInput,
  ProviderProfile,
  ProviderProfileView,
  UpdateProviderProfileInput,
} from "./types.js";

export class ProviderProfileStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderProfileStoreError";
  }
}

function toProfile(entry: PersistedProviderProfile): ProviderProfile {
  return {
    id: entry.id,
    displayName: entry.displayName,
    providerType: entry.providerType,
    baseUrl: entry.baseUrl,
    modelId: entry.modelId,
    envVar: entry.envVar,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.credentialRef !== undefined ? { credentialRef: entry.credentialRef } : {}),
    ...(entry.presetId !== undefined ? { preset: { presetId: entry.presetId } } : {}),
  };
}

function toView(profile: ProviderProfile, activeProfileId: string | undefined): ProviderProfileView {
  return {
    id: profile.id,
    displayName: profile.displayName,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl,
    modelId: profile.modelId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    credentialConfigured: profile.credentialRef !== undefined,
    ...(profile.credentialRef !== undefined ? { credentialAccount: profile.credentialRef.account } : {}),
    ...(profile.preset !== undefined ? { presetId: profile.preset.presetId } : {}),
    isActive: activeProfileId === profile.id,
  };
}

type MutableSettings = ReturnType<SettingsStore["snapshot"]>;

export interface ProviderProfileStore {
  list(): readonly ProviderProfile[];
  listViews(): readonly ProviderProfileView[];
  get(id: string): ProviderProfile | undefined;
  activeProfile(): ProviderProfile | undefined;
  activeProfileId(): string | undefined;
  create(input: CreateProviderProfileInput): Promise<ProviderProfile>;
  update(id: string, input: UpdateProviderProfileInput): Promise<ProviderProfile>;
  delete(id: string): Promise<void>;
  setActive(id: string): Promise<ProviderProfile>;
  clearActive(): Promise<void>;
  setCredentialRef(id: string, ref: CredentialRef): Promise<ProviderProfile>;
  removeCredentialRef(id: string): Promise<ProviderProfile>;
  replaceProfiles(
    profiles: readonly PersistedProviderProfile[],
    activeProfileId?: string,
  ): Promise<void>;
}

export interface ProviderProfileStoreOptions {
  readonly store: SettingsStore & {
    applyDocument?(next: MutableSettings): Promise<void>;
  };
  readonly now?: () => string;
}

async function applyDocument(
  store: ProviderProfileStoreOptions["store"],
  next: MutableSettings,
): Promise<void> {
  if (store.applyDocument !== undefined) {
    await store.applyDocument(next);
    return;
  }
  throw new ProviderProfileStoreError("Settings store does not support document apply.");
}

function readProfiles(settings: MutableSettings): PersistedProviderProfile[] {
  return [...(settings.providerProfiles ?? [])];
}

function readActiveId(settings: MutableSettings): string | undefined {
  return settings.activeProfileId;
}

export function createProviderProfileStore(options: ProviderProfileStoreOptions): ProviderProfileStore {
  const clock = options.now ?? (() => new Date().toISOString());
  const { store } = options;

  async function writeProfiles(
    profiles: readonly PersistedProviderProfile[],
    activeProfileId: string | undefined,
    syncLegacy: PersistedProviderProfile | undefined,
  ): Promise<void> {
    const snapshot = store.snapshot();
    const providers =
      syncLegacy !== undefined
        ? upsertLegacyProviderFromProfile(snapshot.providers, syncLegacy)
        : snapshot.providers;
    const modelPreference =
      syncLegacy !== undefined
        ? {
            default: {
              providerID: "custom-openai-compat",
              modelID: syncLegacy.modelId,
            },
          }
        : snapshot.modelPreference;
    await applyDocument(store, {
      ...snapshot,
      providerProfiles: profiles,
      ...(activeProfileId !== undefined ? { activeProfileId } : {}),
      providers,
      modelPreference,
    });
  }

  return {
    list() {
      return readProfiles(store.snapshot()).map(toProfile);
    },

    listViews() {
      const activeId = readActiveId(store.snapshot());
      return readProfiles(store.snapshot()).map((p) => toView(toProfile(p), activeId));
    },

    get(id) {
      assertValidProfileId(id);
      const found = readProfiles(store.snapshot()).find((p) => p.id === id);
      return found === undefined ? undefined : toProfile(found);
    },

    activeProfileId() {
      return readActiveId(store.snapshot());
    },

    activeProfile() {
      const activeId = readActiveId(store.snapshot());
      if (activeId === undefined) return undefined;
      return this.get(activeId);
    },

    async create(input) {
      const normalized = normalizeCreateInput(input);
      const id = randomUUID();
      assertValidProfileId(id);
      const now = clock();
      const profile: PersistedProviderProfile = {
        id,
        displayName: normalized.displayName,
        providerType: normalized.providerType,
        baseUrl: normalized.baseUrl,
        modelId: normalized.modelId,
        envVar: defaultEnvVarForProfile(id),
        createdAt: now,
        updatedAt: now,
        ...(normalized.presetId !== undefined ? { presetId: normalized.presetId } : {}),
      };
      const profiles = [...readProfiles(store.snapshot()), profile];
      const activeId = readActiveId(store.snapshot()) ?? profile.id;
      const syncLegacy = activeId === profile.id ? profile : undefined;
      await writeProfiles(profiles, activeId, syncLegacy);
      return toProfile(profile);
    },

    async update(id, input) {
      assertValidProfileId(id);
      const profiles = readProfiles(store.snapshot());
      const idx = profiles.findIndex((p) => p.id === id);
      if (idx < 0) throw new ProviderProfileStoreError(`Profile not found: ${id}`);
      const existing = profiles[idx]!;
      const next: PersistedProviderProfile = {
        ...existing,
        ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl.trim() } : {}),
        ...(input.modelId !== undefined ? { modelId: input.modelId.trim() } : {}),
        updatedAt: clock(),
      };
      if (next.displayName.length === 0) {
        throw new ProviderProfileStoreError("displayName must be non-empty.");
      }
      if (next.baseUrl.length === 0) {
        throw new ProviderProfileStoreError("baseUrl must be non-empty.");
      }
      if (next.modelId.length === 0) {
        throw new ProviderProfileStoreError("modelId must be non-empty.");
      }
      const updated = [...profiles];
      updated[idx] = next;
      const activeId = readActiveId(store.snapshot());
      const syncLegacy = activeId === id ? next : undefined;
      await writeProfiles(updated, activeId, syncLegacy);
      return toProfile(next);
    },

    async delete(id) {
      assertValidProfileId(id);
      const profiles = readProfiles(store.snapshot());
      if (profiles.length <= 1) {
        throw new ProviderProfileStoreError(
          "Bạn cần tạo một profile khác trước khi xóa profile này.",
        );
      }
      const activeId = readActiveId(store.snapshot());
      if (activeId === id) {
        throw new ProviderProfileStoreError(
          "Hãy đặt một profile khác làm active trước khi xóa profile này.",
        );
      }
      const remaining = profiles.filter((p) => p.id !== id);
      const syncLegacy = activeId !== undefined ? remaining.find((p) => p.id === activeId) : undefined;
      await writeProfiles(remaining, activeId, syncLegacy);
    },

    async setActive(id) {
      assertValidProfileId(id);
      const profile = readProfiles(store.snapshot()).find((p) => p.id === id);
      if (profile === undefined) throw new ProviderProfileStoreError(`Profile not found: ${id}`);
      await writeProfiles(readProfiles(store.snapshot()), id, profile);
      return toProfile(profile);
    },

    async clearActive() {
      await writeProfiles(readProfiles(store.snapshot()), undefined, undefined);
    },

    async setCredentialRef(id, ref) {
      assertValidProfileId(id);
      const expected = credentialAccountForProfile(id);
      if (ref.account !== expected) {
        throw new ProviderProfileStoreError("Credential account must match profile namespace.");
      }
      const profiles = readProfiles(store.snapshot());
      const idx = profiles.findIndex((p) => p.id === id);
      if (idx < 0) throw new ProviderProfileStoreError(`Profile not found: ${id}`);
      const next: PersistedProviderProfile = {
        ...profiles[idx]!,
        credentialRef: { store: ref.store, account: ref.account },
        updatedAt: clock(),
      };
      const updated = [...profiles];
      updated[idx] = next;
      const activeId = readActiveId(store.snapshot());
      const syncLegacy = activeId === id ? next : undefined;
      await writeProfiles(updated, activeId, syncLegacy);
      return toProfile(next);
    },

    async removeCredentialRef(id) {
      assertValidProfileId(id);
      const profiles = readProfiles(store.snapshot());
      const idx = profiles.findIndex((p) => p.id === id);
      if (idx < 0) throw new ProviderProfileStoreError(`Profile not found: ${id}`);
      const { credentialRef: _drop, ...rest } = profiles[idx]!;
      const next = { ...rest, updatedAt: clock() };
      const updated = [...profiles];
      updated[idx] = next;
      const activeId = readActiveId(store.snapshot());
      const syncLegacy = activeId === id ? next : undefined;
      await writeProfiles(updated, activeId, syncLegacy);
      return toProfile(next);
    },

    async replaceProfiles(profiles, activeProfileId) {
      const syncLegacy =
        activeProfileId !== undefined
          ? profiles.find((p) => p.id === activeProfileId)
          : undefined;
      await writeProfiles(profiles, activeProfileId, syncLegacy);
    },
  };
}

export function createDeepSeekPresetInput(): CreateProviderProfileInput {
  return {
    displayName: defaultDisplayNameForType("deepseek"),
    providerType: "deepseek",
    presetId: "deepseek",
  };
}

export function createCustomProfileInput(displayName: string, baseUrl: string, modelId: string): CreateProviderProfileInput {
  return {
    displayName,
    providerType: "custom-openai-compat",
    baseUrl,
    modelId,
  };
}
