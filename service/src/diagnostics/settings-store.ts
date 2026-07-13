/**
 * Persistent settings store (CGHC-022, SD1). Owns general + provider settings and the
 * default-model preference, PERSISTS them across restart, and reloads on construct. It is
 * the durable SOURCE OF TRUTH for these values (SD4) — the renderer reads/writes them only
 * through the service, never `localStorage`.
 *
 * Persistence is write-through: every mutation is applied in memory then flushed via the
 * injected {@link SettingsFs} seam (tests supply an in-memory fake for determinism; the
 * production seam writes atomically). Load delegates to {@link recoverSettings}, so a
 * corrupt file recovers to a safe default and NEVER crashes the service (SD5).
 *
 * Secret discipline: provider settings carry a {@link CredentialRef} HANDLE only. The store
 * API exposes no way to store key bytes — the credential value lives in the OS store
 * (CGHC-009) and is resolved late at the execution boundary.
 *
 * Model-preference ownership: this store is the DURABLE source of truth for the DEFAULT
 * model. The in-memory RUNTIME resolver stays the `ProviderPort` selection map (CGHC-019);
 * the orchestrator seeds the port from `defaultModel()` at boot and mirrors changes — so
 * there is one persistent store and one runtime resolver, not two competing stores.
 */

import type { CredentialRef, ModelRef, ProviderId } from "@cowork-ghc/contracts";
import type {
  ActiveWorkspace,
  CoworkSettings,
  GeneralSettings,
  ModelPreference,
  PersistedProviderProfile,
  ProviderSettingsEntry,
} from "./settings-types.js";
import {
  recoverSettings,
  type SettingsRecoveryReason,
  type SettingsSource,
} from "./settings-recovery.js";

/**
 * Minimal filesystem seam for settings persistence. `read` resolves `undefined` when the
 * file does not exist yet; `write` MUST persist atomically. Injected so tests are
 * deterministic and the store never touches `node:fs` directly.
 */
export interface SettingsFs {
  read(): Promise<string | undefined>;
  write(data: string): Promise<void>;
}

export interface SettingsStoreOptions {
  readonly fs: SettingsFs;
}

/** The persistent settings store. All mutations flush through the seam before resolving. */
export interface SettingsStore {
  /** A deep, frozen-safe copy of the whole document. */
  snapshot(): CoworkSettings;
  general(): GeneralSettings;
  /** Patch general settings (partial); persists and returns the new general settings. */
  updateGeneral(patch: Partial<GeneralSettings>): Promise<GeneralSettings>;
  listProviderSettings(): readonly ProviderSettingsEntry[];
  providerSettings(id: ProviderId): ProviderSettingsEntry | undefined;
  /** Bind a credential HANDLE to a provider (never key bytes); persists. */
  setProviderCredentialRef(id: ProviderId, ref: CredentialRef): Promise<void>;
  /** Remove a provider's credential binding; persists. */
  removeProviderCredentialRef(id: ProviderId): Promise<void>;
  /** Set the custom endpoint base_url (non-secret); persists. */
  setProviderBaseUrl(id: ProviderId, baseUrl: string): Promise<void>;
  /** Set the child env-var NAME (non-secret, never a key) for a provider; persists. */
  setProviderEnvVar(id: ProviderId, envVar: string): Promise<void>;
  /** The persisted default-model preference, or `undefined`. */
  defaultModel(): ModelRef | undefined;
  /** Set (or clear with `undefined`) the default-model preference; persists. */
  setDefaultModel(model: ModelRef | undefined): Promise<void>;
  /** The granted workspace root the user selected, or `undefined` until one is granted. */
  activeWorkspace(): ActiveWorkspace | undefined;
  /** Set the granted workspace root (non-secret path); persists write-through. */
  setActiveWorkspace(rootPath: string): Promise<void>;
  /** SD5: how the current in-memory document was loaded (drives a reset offer). */
  loadSource(): SettingsSource;
  /** SD5: the non-secret reason the load recovered, when `loadSource()` is `"recovered"`. */
  recoveryReason(): SettingsRecoveryReason | undefined;
  /** SD5: reset every value to the safe default and persist. */
  reset(): Promise<void>;
  /** Atomic document replace (profiles migration / bulk profile writes). */
  applyDocument(next: CoworkSettings): Promise<void>;
}

function upsertProvider(
  providers: readonly ProviderSettingsEntry[],
  id: ProviderId,
  update: (existing: ProviderSettingsEntry | undefined) => ProviderSettingsEntry,
): ProviderSettingsEntry[] {
  const existing = providers.find((p) => p.providerId === id);
  const next = update(existing);
  const kept = providers.filter((p) => p.providerId !== id);
  return [...kept, next];
}

class SettingsStoreImpl implements SettingsStore {
  private settings: CoworkSettings;
  private source: SettingsSource;
  private reason: SettingsRecoveryReason | undefined;

  constructor(
    private readonly fs: SettingsFs,
    loaded: { settings: CoworkSettings; source: SettingsSource; reason?: SettingsRecoveryReason },
  ) {
    this.settings = loaded.settings;
    this.source = loaded.source;
    this.reason = loaded.reason;
  }

  snapshot(): CoworkSettings {
    // Structured clone keeps callers from mutating the store's internal document.
    return structuredClone(this.settings);
  }

  general(): GeneralSettings {
    return { ...this.settings.general };
  }

  private async persist(next: CoworkSettings): Promise<void> {
    this.settings = next;
    // A successful write means the in-memory doc is now the trusted persisted one.
    this.source = "loaded";
    this.reason = undefined;
    await this.fs.write(JSON.stringify(next, null, 2));
  }

  async updateGeneral(patch: Partial<GeneralSettings>): Promise<GeneralSettings> {
    const general: GeneralSettings = { ...this.settings.general, ...patch };
    await this.persist({ ...this.settings, general });
    return { ...general };
  }

  listProviderSettings(): readonly ProviderSettingsEntry[] {
    return this.settings.providers.map((p) => ({ ...p }));
  }

  providerSettings(id: ProviderId): ProviderSettingsEntry | undefined {
    const found = this.settings.providers.find((p) => p.providerId === id);
    return found === undefined ? undefined : { ...found };
  }

  async setProviderCredentialRef(id: ProviderId, ref: CredentialRef): Promise<void> {
    const providers = upsertProvider(this.settings.providers, id, (existing) => ({
      ...(existing ?? { providerId: id }),
      providerId: id,
      credentialRef: { store: ref.store, account: ref.account },
    }));
    await this.persist({ ...this.settings, providers });
  }

  async removeProviderCredentialRef(id: ProviderId): Promise<void> {
    const providers = this.settings.providers.map((p) => {
      if (p.providerId !== id) return p;
      const { credentialRef: _dropped, ...rest } = p;
      return rest;
    });
    await this.persist({ ...this.settings, providers });
  }

  async setProviderBaseUrl(id: ProviderId, baseUrl: string): Promise<void> {
    const providers = upsertProvider(this.settings.providers, id, (existing) => ({
      ...(existing ?? { providerId: id }),
      providerId: id,
      baseUrl,
    }));
    await this.persist({ ...this.settings, providers });
  }

  async setProviderEnvVar(id: ProviderId, envVar: string): Promise<void> {
    if (envVar.trim().length === 0) {
      throw new Error("envVar must be a non-empty variable name.");
    }
    const providers = upsertProvider(this.settings.providers, id, (existing) => ({
      ...(existing ?? { providerId: id }),
      providerId: id,
      envVar,
    }));
    await this.persist({ ...this.settings, providers });
  }

  defaultModel(): ModelRef | undefined {
    const model = this.settings.modelPreference.default;
    return model === undefined ? undefined : { ...model };
  }

  async setDefaultModel(model: ModelRef | undefined): Promise<void> {
    const modelPreference =
      model === undefined ? {} : { default: { providerID: model.providerID, modelID: model.modelID } };
    await this.persist({ ...this.settings, modelPreference });
  }

  activeWorkspace(): ActiveWorkspace | undefined {
    const ws = this.settings.activeWorkspace;
    return ws === undefined ? undefined : { rootPath: ws.rootPath };
  }

  async setActiveWorkspace(rootPath: string): Promise<void> {
    if (rootPath.trim().length === 0) {
      throw new Error("activeWorkspace rootPath must be a non-empty path.");
    }
    await this.persist({ ...this.settings, activeWorkspace: { rootPath } });
  }

  loadSource(): SettingsSource {
    return this.source;
  }

  recoveryReason(): SettingsRecoveryReason | undefined {
    return this.reason;
  }

  async reset(): Promise<void> {
    const { settings } = recoverSettings(undefined);
    await this.persist(settings);
  }

  async applyDocument(next: CoworkSettings): Promise<void> {
    await this.persist(next);
  }
}

/**
 * Open the settings store, LOADING persisted state through the seam (persist-across-restart,
 * SD1). A corrupt/unreadable file recovers to a safe default (SD5) — this factory never
 * throws for a corrupt payload. A hard read failure (I/O error) is treated as "no file yet"
 * so the service still starts with safe defaults rather than crashing.
 */
export async function openSettingsStore(options: SettingsStoreOptions): Promise<SettingsStore> {
  let raw: string | undefined;
  try {
    raw = await options.fs.read();
  } catch {
    raw = undefined;
  }
  return new SettingsStoreImpl(options.fs, recoverSettings(raw));
}
