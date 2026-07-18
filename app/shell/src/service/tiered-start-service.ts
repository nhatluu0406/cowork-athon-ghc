/**
 * Mode-aware {@link StartService} for the shell: boot an ONBOARDING-capable service even when
 * nothing is configured yet (first-run onboarding fix).
 */

import { startCoworkService, RuntimeSpawnError } from "@cowork-ghc/service";

import type { StartService, StartedService } from "./service-controller.js";
import { ServiceLaunchNotConfiguredError } from "./launch-config.js";
import { peekRememberedUnlock, rememberUnlock } from "./session-unlock.js";

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
  /** Absolute path to the local SQLite database (ADR 0007). */
  readonly dbPath: string;
  readonly conversationsDir?: string;
  readonly skillsStateFilePath?: string;
  readonly skillRoots?: readonly {
    readonly path: string;
    readonly source: "built_in" | "user_local";
    readonly createIfMissing?: boolean;
  }[];
  readonly allowedOrigins: readonly string[];
  /** Development / verification: enable POST /v1/credentials/import-env on the service. */
  readonly allowEnvCredentialImport?: boolean;
  /** Fixed port for the Gateway proxy (default: an ephemeral bind). See `gatewayProxyPort` on
   * `CoworkServiceOptions` for why production pins this to a stable address. */
  readonly gatewayProxyPort?: number;
}

/**
 * Build the Tier-1 settings-only {@link StartService}: start the fully-wired loopback service with
 * honest not-attached runtime seams. Opens the local SQLite vault + settings store; spawns no child.
 */
export function createSettingsOnlyStartService(options: SettingsOnlyStartOptions): StartService {
  return async (): Promise<StartedService> => {
    const autoUnlock = peekRememberedUnlock();
    const { running } = await startCoworkService({
      dbPath: options.dbPath,
      settingsFilePath: options.settingsFilePath,
      ...(options.conversationsDir !== undefined
        ? { conversationsDir: options.conversationsDir }
        : {}),
      ...(options.skillsStateFilePath !== undefined
        ? { skillsStateFilePath: options.skillsStateFilePath }
        : {}),
      ...(options.skillRoots !== undefined ? { skillRoots: options.skillRoots } : {}),
      ...(autoUnlock !== null ? { autoUnlock } : {}),
      rememberUnlock,
      allowedOrigins: options.allowedOrigins,
      allowEnvCredentialImport: options.allowEnvCredentialImport === true,
      ...(options.gatewayProxyPort !== undefined ? { gatewayProxyPort: options.gatewayProxyPort } : {}),
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
