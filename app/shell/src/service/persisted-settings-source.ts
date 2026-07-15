/**
 * Production {@link LiveLaunchSource} that assembles a live launch from the PERSISTED settings the
 * user entered during onboarding (first-run onboarding fix) — no launch env vars required.
 *
 * SECRET DISCIPLINE: reads only non-secret credential handles. The encrypted vault (ADR 0007)
 * owns secret values after unlock; `dbPath` is shared with the Tier-1 onboarding service.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { credential, db, diagnostics, readE2eMockLlmBaseUrl } from "@cowork-ghc/service";
import type { CredentialRef, ModelRef } from "@cowork-ghc/contracts";

import type { LiveLaunchConfig, LiveLaunchSource } from "./live-launch-resolver.js";
import { peekRememberedUnlock, rememberUnlock } from "./session-unlock.js";

/** The minimal read surface this source needs from the persistent settings store (testable seam). */
export interface PersistedSettingsReader {
  activeWorkspace(): { readonly rootPath: string } | undefined;
  defaultModel(): ModelRef | undefined;
  listProviderSettings(): readonly {
    readonly providerId: string;
    readonly credentialRef?: CredentialRef;
    readonly baseUrl?: string;
    readonly envVar?: string;
  }[];
}

export interface PersistedSettingsSourceOptions {
  /** Absolute path to the persistent settings file (shared with the Tier-1 onboarding service). */
  readonly settingsFilePath: string;
  /** Absolute path to the local SQLite database (ADR 0007). */
  readonly dbPath: string;
  /** Explicit pinned OpenCode binary path (packaged) — forwarded to `buildLiveCoworkOptions`. */
  readonly binPath?: string;
  /** App install root used to default the binary path (dev). */
  readonly appRoot?: string;
  /** Writable per-launch `.runtime/` root (packaged: userData). */
  readonly runtimeRoot?: string;
  /** Browser origins the live loopback service must allow (the renderer's `app://cowork`). */
  readonly allowedOrigins?: readonly string[];
  readonly skillsStateFilePath?: string;
  readonly skillRoots?: readonly {
    readonly path: string;
    readonly source: "built_in" | "user_local";
    readonly createIfMissing?: boolean;
  }[];
  /** Test-only: inject a credential store instead of the vault-owned default. */
  readonly makeCredentialStore?: () => Promise<credential.CredentialStore>;
  /** Open the persistent settings reader (default: the real Node settings store). Injectable. */
  readonly makeSettingsReader?: () => Promise<PersistedSettingsReader>;
}

/**
 * Build the persisted-settings launch source. Returns a coherent {@link LiveLaunchConfig} when the
 * user has completed onboarding (workspace + a custom provider with a bound key + a default model),
 * else `null`.
 */
export function createPersistedSettingsSource(
  options: PersistedSettingsSourceOptions,
): LiveLaunchSource {
  return async (): Promise<LiveLaunchConfig | null> => {
    const reader = await openReader(options);

    const workspace = reader.activeWorkspace();
    if (workspace === undefined) return null;
    if (!isUsableWorkspaceRoot(workspace.rootPath)) return null;

    const model = reader.defaultModel();
    if (model === undefined) return null;

    const provider = reader.listProviderSettings().find((p) => p.providerId === model.providerID);
    if (
      provider === undefined ||
      provider.credentialRef === undefined ||
      provider.baseUrl === undefined ||
      provider.envVar === undefined
    ) {
      return null;
    }

    const e2eMockBaseUrl = readE2eMockLlmBaseUrl();
    const autoUnlock = peekRememberedUnlock();
    const injectedStore = options.makeCredentialStore
      ? await options.makeCredentialStore()
      : undefined;

    return {
      workspaceRoot: workspace.rootPath,
      ...(injectedStore !== undefined
        ? { credentialService: credential.createCredentialService({ store: injectedStore }) }
        : {}),
      provider: {
        kind: "custom",
        providerId: provider.providerId,
        baseUrl: e2eMockBaseUrl ?? provider.baseUrl,
        model: model.modelID,
        envVar: provider.envVar,
        credentialRef: provider.credentialRef,
      },
      service: {
        dbPath: options.dbPath,
        settingsFilePath: options.settingsFilePath,
        ...(injectedStore !== undefined ? { credentialStore: injectedStore } : {}),
        ...(autoUnlock !== null ? { autoUnlock } : {}),
        rememberUnlock,
        ...(options.runtimeRoot !== undefined
          ? { conversationsDir: join(options.runtimeRoot, ".runtime", "conversations") }
          : {}),
        ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
        ...(options.skillsStateFilePath !== undefined
          ? { skillsStateFilePath: options.skillsStateFilePath }
          : {}),
        ...(options.skillRoots !== undefined ? { skillRoots: options.skillRoots } : {}),
      },
      ...(options.binPath !== undefined ? { binPath: options.binPath } : {}),
      ...(options.appRoot !== undefined ? { appRoot: options.appRoot } : {}),
      ...(options.runtimeRoot !== undefined ? { runtimeRoot: options.runtimeRoot } : {}),
    };
  };
}

/** True when the persisted workspace root still exists and is a writable directory. */
function isUsableWorkspaceRoot(rootPath: string): boolean {
  try {
    if (!existsSync(rootPath)) return false;
    return statSync(rootPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Load a read-only settings snapshot from the SQLite vault (ADR 0007).
 * Returns null when the DB file is missing or has no settings document yet.
 */
async function openSqliteSettingsReader(dbPath: string): Promise<PersistedSettingsReader | null> {
  if (!existsSync(dbPath)) return null;
  const database = db.openSqliteDatabase({ filePath: dbPath, readonly: true });
  try {
    const settingsRepo = db.createSettingsRepository(database);
    const raw = settingsRepo.getJson(db.SETTINGS_DOCUMENT_KEY);
    if (raw === null) return null;
    // Snapshot into an in-memory SettingsFs so the DB handle can close before callers read.
    const fs = {
      async read(): Promise<string | undefined> {
        return raw;
      },
      async write(): Promise<void> {
        throw new Error("Persisted settings launch reader is read-only.");
      },
    };
    return await diagnostics.openSettingsStore({ fs });
  } finally {
    db.closeSqliteDatabase(database);
  }
}

async function openReader(options: PersistedSettingsSourceOptions): Promise<PersistedSettingsReader> {
  if (options.makeSettingsReader !== undefined) return options.makeSettingsReader();

  // After Wave 0A, settings live in SQLite; settings.json may be renamed to `.migrated-backup`.
  // Reading only the JSON path made live transition report "not configured" despite a working
  // provider in the vault — which then failed permission polls after Connect.
  if (options.dbPath !== undefined) {
    const fromSqlite = await openSqliteSettingsReader(options.dbPath);
    if (fromSqlite !== null) return fromSqlite;
  }

  const store = await diagnostics.openSettingsStore({
    fs: diagnostics.createNodeSettingsFs(options.settingsFilePath),
  });
  return store;
}

/**
 * Compose sources in priority order; first non-null wins.
 */
export function createFirstConfiguredSource(sources: readonly LiveLaunchSource[]): LiveLaunchSource {
  return async () => {
    for (const source of sources) {
      const config = await source();
      if (config !== null) return config;
    }
    return null;
  };
}
