/**
 * `connectLive` policy: idempotent when the live service is already running, forced
 * stop+restart only on explicit request (CGHC connectLive-idempotence fix).
 *
 * Extracted from `main.ts` so the decision logic — the actual behavior change this fix ships —
 * is unit-testable with a fake {@link ServiceController}-shaped object, no Electron required.
 */

import type { ConnectLiveResult } from "@cowork-ghc/contracts";

import type { ServiceController } from "./service-controller.js";

/** The minimal controller surface `connectLive` needs (matches {@link ServiceController}). */
export type ConnectLiveController = Pick<ServiceController, "runningTier" | "stop" | "startLive">;

/**
 * Build the `connectLive(force)` implementation: short-circuits to `{ restarted: false }` when
 * the controller is already running the LIVE tier and `force` is not set — no stop/start, so any
 * in-memory state the running service holds (e.g. the MS365 manual token + session scope) survives
 * unchanged. Any other case (not live, or `force: true`) does a full stop+startLive and reports
 * `{ restarted: true }`.
 */
export function createConnectLive(
  controller: ConnectLiveController,
): (force: boolean) => Promise<ConnectLiveResult> {
  return async (force: boolean): Promise<ConnectLiveResult> => {
    if (!force && controller.runningTier === "live") {
      return { restarted: false };
    }
    await controller.stop();
    await controller.startLive();
    return { restarted: true };
  };
}
