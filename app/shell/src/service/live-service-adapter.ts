/**
 * The DEFAULT shell {@link StartService}: a thin normalizer over `startLiveCoworkService`
 * (CGHC-028 Wave B1).
 *
 * `startLiveCoworkService` (Wave A2) starts the loopback service + the supervised OpenCode
 * child and returns a {@link LiveCoworkService} whose running handle carries the loopback
 * `baseUrl` + per-launch `clientToken` and whose `stop()` owns BOTH the socket and the
 * child. This module maps that rich handle onto the shell's minimal
 * {@link StartedService} shape ({ baseUrl, token, stop }) that the ServiceController holds.
 *
 * The launch OPTIONS (the OpenCode supervisor + start spec + workspace) are resolved by an
 * injectable {@link ResolveLiveOptions} seam. `startLive` is injectable too, so the mapping
 * is unit-tested WITHOUT spawning real OpenCode or opening a real socket.
 */

import {
  startLiveCoworkService,
  type LiveCoworkService,
  type LiveCoworkServiceOptions,
} from "@cowork-ghc/service";

import type { StartService, StartedService } from "./service-controller.js";

/** Injectable seam over `startLiveCoworkService` (real by default, fake in tests). */
export type StartLiveService = (
  options: LiveCoworkServiceOptions,
) => Promise<LiveCoworkService>;

/** Resolve the production launch options (supervisor + start spec + workspace). */
export type ResolveLiveOptions = () => Promise<LiveCoworkServiceOptions>;

/** Normalize a running {@link LiveCoworkService} to the shell's minimal handle. */
export function toStartedService(live: LiveCoworkService): StartedService {
  return {
    baseUrl: live.running.baseUrl,
    token: live.running.clientToken,
    stop: () => live.stop(),
  };
}

/**
 * Build the default shell StartService: resolve launch options, start the live service, and
 * normalize the handle. `startLive` defaults to the real `startLiveCoworkService`.
 */
export function createLiveStartService(
  resolveOptions: ResolveLiveOptions,
  startLive: StartLiveService = startLiveCoworkService,
): StartService {
  return async (): Promise<StartedService> => {
    const options = await resolveOptions();
    const live = await startLive(options);
    return toStartedService(live);
  };
}
