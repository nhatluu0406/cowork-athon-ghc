/**
 * Mode-aware {@link StartService} for the shell: boot an ONBOARDING-capable service even when
 * nothing is configured yet (first-run onboarding fix).
 *
 * The shell previously wired ONLY the live `StartService`: when no workspace + provider was
 * configured, the live options resolver threw {@link ServiceLaunchNotConfiguredError}, the
 * ServiceController surfaced the empty "not connected" handshake, and the renderer never reached
 * `ready` — so the folder picker + provider/model settings UI (which mount only after a real
 * `health()`) were unreachable. Chicken-and-egg: you could not configure because the service was
 * down, and the service was down because it was not configured.
 *
 * This resolves it by falling back to the Tier-1 SETTINGS-ONLY service (`startCoworkService`),
 * which mounts every router — workspace, credential, settings, provider, session — with honest
 * NOT-ATTACHED runtime seams and needs NO workspace/provider to start. It spawns NO OpenCode child
 * and makes NO provider call: it exists so the renderer reaches `ready` and the user can onboard
 * (pick a workspace, enter a key, configure a provider/model). Actually starting the live runtime
 * stays a separate, user-gated step (the "Connect" action → a service restart into the live path).
 *
 * The fallback is keyed on the typed {@link ServiceLaunchNotConfiguredError} ONLY — any other live
 * failure (a real misconfiguration, a spawn error) still propagates so the ServiceController
 * records it honestly. The Tier-1 fallback and the live path share the SAME absolute
 * `settingsFilePath`, so a provider/model the user saves during onboarding is the same persisted
 * state the subsequent live launch reads.
 */

import { startCoworkService, RuntimeSpawnError } from "@cowork-ghc/service";

import type { StartService, StartedService } from "./service-controller.js";
import { ServiceLaunchNotConfiguredError } from "./launch-config.js";

export interface TieredStartServiceOptions {
  /**
   * When true, a live OpenCode spawn failure falls back to the settings-only service so the
   * renderer keeps a working onboarding surface (user-gated `connectLive` only).
   */
  readonly fallbackOnLiveSpawnFailure?: boolean;
}

/** Options for the Tier-1 settings-only fallback start. */
export interface SettingsOnlyStartOptions {
  readonly settingsFilePath: string;
  readonly conversationsDir?: string;
  readonly allowedOrigins: readonly string[];
  /** Development / verification: enable POST /v1/credentials/import-env on the service. */
  readonly allowEnvCredentialImport?: boolean;
}

/**
 * Build the Tier-1 settings-only {@link StartService}: start the fully-wired loopback service with
 * honest not-attached runtime seams and normalize its handle to the shell's minimal shape. It
 * opens the OS keyring + the settings store, but spawns no child and calls no provider.
 */
export function createSettingsOnlyStartService(options: SettingsOnlyStartOptions): StartService {
  return async (): Promise<StartedService> => {
    const { running } = await startCoworkService({
      settingsFilePath: options.settingsFilePath,
      ...(options.conversationsDir !== undefined
        ? { conversationsDir: options.conversationsDir }
        : {}),
      allowedOrigins: options.allowedOrigins,
      allowEnvCredentialImport: options.allowEnvCredentialImport === true,
    });
    return {
      baseUrl: running.baseUrl,
      token: running.clientToken,
      stop: () => running.service.stop(),
    };
  };
}

/**
 * Compose a mode-aware {@link StartService}: try the live path first; if (and ONLY if) it reports
 * {@link ServiceLaunchNotConfiguredError} (nothing configured yet), fall back to the settings-only
 * service so the app boots into an onboarding-ready state. Every other error propagates unchanged.
 */
export function createTieredStartService(
  live: StartService,
  settingsOnly: StartService,
  options: TieredStartServiceOptions = {},
): StartService {
  return async (): Promise<StartedService> => {
    try {
      return await live();
    } catch (err) {
      if (err instanceof ServiceLaunchNotConfiguredError) {
        return settingsOnly();
      }
      if (options.fallbackOnLiveSpawnFailure === true && err instanceof RuntimeSpawnError) {
        return settingsOnly();
      }
      throw err;
    }
  };
}
