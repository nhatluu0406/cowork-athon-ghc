/**
 * Production {@link LiveLaunchSource} that assembles a live launch from the PERSISTED settings the
 * user entered during onboarding (first-run onboarding fix) — no launch env vars required.
 *
 * The onboarding flow (Tier-1 settings-only service) writes the granted workspace root, a custom
 * OpenAI-compatible provider (`baseUrl` + `envVar` + bound credential handle), and the default model
 * into `.runtime/settings.json`. This source reads THAT SAME file and, when a coherent + complete
 * selection is present, returns the {@link LiveLaunchConfig} `buildLiveCoworkOptions` needs so the
 * shell can restart into the live path (spawn OpenCode) on the user-gated "Connect".
 *
 * Honest by construction: it returns `null` (never throws) whenever the config is incomplete — no
 * workspace granted, no default model, or the default model's provider has no bound key / base URL /
 * env var — so the tiered start falls back to the onboarding (settings-only) service. It reads the
 * settings file fresh on every call, so a restart after the user saves new settings picks them up.
 *
 * SECRET DISCIPLINE: it reads only the NON-secret credential account handle from settings; the key
 * value never appears here — it is resolved into the child ENV at the supervisor boundary. The ONE
 * keyring store it opens is shared into `service.credentialStore` (the "one store" invariant).
 */

import { credential, diagnostics } from "@cowork-ghc/service";
import type { CredentialRef, ModelRef } from "@cowork-ghc/contracts";

import type { LiveLaunchConfig, LiveLaunchSource } from "./live-launch-resolver.js";

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
  /** Explicit pinned OpenCode binary path (packaged) — forwarded to `buildLiveCoworkOptions`. */
  readonly binPath?: string;
  /** App install root used to default the binary path (dev). */
  readonly appRoot?: string;
  /** Writable per-launch `.runtime/` root (packaged: userData). */
  readonly runtimeRoot?: string;
  /** Browser origins the live loopback service must allow (the renderer's `app://cowork`). */
  readonly allowedOrigins?: readonly string[];
  /** Open the ONE credential store (default: the OS keyring). Injectable for tests. */
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
    if (workspace === undefined) return null; // no workspace granted yet → not configured

    const model = reader.defaultModel();
    if (model === undefined) return null; // no default model chosen yet

    // The active provider is the one backing the default model. It must be a complete custom
    // OpenAI-compatible selection: a bound key handle + a base URL + the injection env var name.
    const provider = reader.listProviderSettings().find((p) => p.providerId === model.providerID);
    if (
      provider === undefined ||
      provider.credentialRef === undefined ||
      provider.baseUrl === undefined ||
      provider.envVar === undefined
    ) {
      return null;
    }

    const store = options.makeCredentialStore
      ? await options.makeCredentialStore()
      : await credential.createKeyringStore();
    const credentialService = credential.createCredentialService({ store });

    return {
      workspaceRoot: workspace.rootPath,
      credentialService,
      provider: {
        kind: "custom",
        providerId: provider.providerId,
        baseUrl: provider.baseUrl,
        model: model.modelID,
        envVar: provider.envVar,
        credentialRef: provider.credentialRef,
      },
      // The credential service + the composed service MUST read the SAME store (one store). The live
      // service also needs the renderer's origin allowed and the SAME settings file the UI writes.
      service: {
        credentialStore: store,
        settingsFilePath: options.settingsFilePath,
        ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
      },
      ...(options.binPath !== undefined ? { binPath: options.binPath } : {}),
      ...(options.appRoot !== undefined ? { appRoot: options.appRoot } : {}),
      ...(options.runtimeRoot !== undefined ? { runtimeRoot: options.runtimeRoot } : {}),
    };
  };
}

/** Open the settings reader: the injected fake in tests, else the real Node settings store. */
async function openReader(options: PersistedSettingsSourceOptions): Promise<PersistedSettingsReader> {
  if (options.makeSettingsReader) return options.makeSettingsReader();
  return diagnostics.openSettingsStore({
    fs: diagnostics.createNodeSettingsFs(options.settingsFilePath),
  });
}

/**
 * Compose several {@link LiveLaunchSource}s: return the first one that yields a config. Used to try
 * the persisted-settings source first, then the launch-env source (bounded tests) as a fallback.
 */
export function createFirstConfiguredSource(
  sources: readonly LiveLaunchSource[],
): LiveLaunchSource {
  return async (): Promise<LiveLaunchConfig | null> => {
    for (const source of sources) {
      const config = await source();
      if (config !== null && config !== undefined) return config;
    }
    return null;
  };
}
