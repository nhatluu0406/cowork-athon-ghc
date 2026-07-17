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

/** Options controlling the launch retry policy. */
export interface LiveStartOptions {
  /** Max launch attempts before giving up (default 3). */
  readonly maxAttempts?: number;
  /** Non-secret log sink for retry telemetry (default: no-op). */
  readonly log?: (line: string) => void;
}

/**
 * A port-busy signal we may safely retry: the child OpenCode port pre-check
 * (`runtime_port_in_use`) or the service socket bind (`EADDRINUSE`). We read `err.code`
 * as a property — NOT `instanceof` — because the typed error crosses the service→shell
 * package boundary. Health-timeout / spawn-fail are NOT retried: retrying them would mask
 * a genuinely broken binary/pin and slow an honest failure by N attempts.
 */
function isPortInUse(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "runtime_port_in_use" || code === "EADDRINUSE";
}

/**
 * Build the default shell StartService: resolve launch options, start the live service, and
 * normalize the handle. `startLive` defaults to the real `startLiveCoworkService`.
 *
 * A rare TOCTOU race exists between ephemeral-port allocation and the child/service bind: a
 * port picked by `allocateLoopbackPort` (bind 0 → read → close) can be taken by another
 * process before the real bind. On an unambiguous port-busy signal we re-run `resolveOptions()`
 * (which mints a FRESH supervisor + fresh ports — the supervisor is single-shot) and retry, up
 * to `maxAttempts`. Any other failure propagates immediately.
 */
export function createLiveStartService(
  resolveOptions: ResolveLiveOptions,
  startLive: StartLiveService = startLiveCoworkService,
  opts: LiveStartOptions = {},
): StartService {
  const maxAttempts = opts.maxAttempts ?? 3;
  const log = opts.log ?? ((): void => {});
  return async (): Promise<StartedService> => {
    for (let attempt = 1; ; attempt += 1) {
      const options = await resolveOptions();
      try {
        const live = await startLive(options);
        return toStartedService(live);
      } catch (err) {
        if (isPortInUse(err) && attempt < maxAttempts) {
          log(`live_start_port_retry attempt=${attempt}`);
          continue;
        }
        throw err;
      }
    }
  };
}
