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
 * The fallback is keyed on the typed {@link ServiceLaunchNotConfiguredError} ONLY, plus (when
 * `fallbackOnLiveSpawnFailure` is set) {@link RuntimeSpawnError} and the SSRF boot-lockout case
 * (security-review follow-up): a persisted provider `base_url` can start passing SSRF policy at
 * save time and later fail it (e.g. split-horizon corporate DNS re-resolves the hostname to a
 * private IP after a network change) — `buildLiveCoworkOptions` re-validates it on every boot and
 * throws `SsrfBlockedError`. Without this case the shell RETHROWS it and the packaged app never
 * starts ANY service (not even settings-only) — a full Settings lockout, worse than the composed
 * service's own boot-resilience fix (68d5109) because the shell layer sits in front of it. Any
 * OTHER live failure (a real misconfiguration, an unrelated spawn error) still propagates so the
 * ServiceController records it honestly. The Tier-1 fallback and the live path share the SAME
 * absolute `settingsFilePath`, so a provider/model the user saves during onboarding is the same
 * persisted state the subsequent live launch reads.
 */

import { startCoworkService, RuntimeSpawnError, SsrfBlockedError } from "@cowork-ghc/service";

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
  readonly skillsStateFilePath?: string;
  readonly skillRoots?: readonly {
    readonly path: string;
    readonly source: "built_in" | "user_local";
    readonly createIfMissing?: boolean;
  }[];
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
      ...(options.skillsStateFilePath !== undefined
        ? { skillsStateFilePath: options.skillsStateFilePath }
        : {}),
      ...(options.skillRoots !== undefined ? { skillRoots: options.skillRoots } : {}),
      allowedOrigins: options.allowedOrigins,
      allowEnvCredentialImport: options.allowEnvCredentialImport === true,
    });
    return {
      baseUrl: running.baseUrl,
      token: running.clientToken,
      tier: "settings_only",
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
      // SSRF boot-lockout (security-review follow-up): a persisted provider base_url that no
      // longer passes the SSRF policy (e.g. corporate split-horizon DNS now resolves it to a
      // private IP) makes `buildLiveCoworkOptions` throw this typed error on EVERY boot attempt.
      // Fail closed but not dark: fall back to settings-only (no child spawned, no endpoint
      // held) so the user can still reach Settings and fix/clear the offending URL.
      if (err instanceof SsrfBlockedError) {
        return settingsOnly();
      }
      throw err;
    }
  };
}
