/**
 * The REAL shell {@link ResolveLiveOptions}: turn a resolvable launch config into
 * `LiveCoworkServiceOptions` via `buildLiveCoworkOptions` (CGHC-028 Wave B2b).
 *
 * Wave B1 shipped only the honest `resolveLiveOptionsNotConfigured` stub. Wave B2a added
 * `buildLiveCoworkOptions(input)` to `@cowork-ghc/service`, which assembles a complete,
 * spawn-ready option set (supervisor + start spec + workspaceId + seedScrubber + SSRF-validated
 * provider) from minimal inputs. This module wires that in:
 *
 *   - A {@link LiveLaunchSource} yields a {@link LiveLaunchConfig} when a workspace + provider +
 *     credential service are resolvable (from persisted settings or explicit launch env), or
 *     `null`/`undefined` when nothing is configured yet.
 *   - When a config is present, the resolver calls `buildLiveCoworkOptions` and the shell starts
 *     the live loopback service + supervised OpenCode child.
 *   - When NOTHING is configured, it throws {@link ServiceLaunchNotConfiguredError} — the exact
 *     honest signal the ServiceController turns into the empty "not connected" handshake the
 *     CGHC-025 readiness surface renders. It NEVER fabricates a ready state.
 *
 * Both the `source` and the `build` seam are injectable so tests drive it with fakes and never
 * spawn real OpenCode or open the OS keyring.
 */

import {
  buildLiveCoworkOptions,
  type BuildLiveCoworkInput,
  type LiveCoworkServiceOptions,
} from "@cowork-ghc/service";

import type { ResolveLiveOptions } from "./live-service-adapter.js";
import { ServiceLaunchNotConfiguredError } from "./launch-config.js";

/** A resolvable live-launch configuration (exactly the input `buildLiveCoworkOptions` needs). */
export type LiveLaunchConfig = BuildLiveCoworkInput;

/**
 * Yield a launch config, or `null`/`undefined` when the app is not configured yet. May be async
 * (reading persisted settings / opening the credential store is IO). Production uses the env
 * source; tests inject a fake that returns a config or nothing.
 */
export type LiveLaunchSource = () =>
  | Promise<LiveLaunchConfig | null | undefined>
  | LiveLaunchConfig
  | null
  | undefined;

/** Injectable builder seam (real `buildLiveCoworkOptions` by default). */
export type BuildLiveOptions = (
  input: BuildLiveCoworkInput,
) => Promise<LiveCoworkServiceOptions>;

/**
 * Build a shell {@link ResolveLiveOptions} from a {@link LiveLaunchSource}. Honest by
 * construction: no config → throw {@link ServiceLaunchNotConfiguredError} (the not-connected
 * fallback), never a fake ready.
 */
export function createLiveOptionsResolver(
  source: LiveLaunchSource,
  build: BuildLiveOptions = buildLiveCoworkOptions,
): ResolveLiveOptions {
  return async (): Promise<LiveCoworkServiceOptions> => {
    const config = await source();
    if (config === null || config === undefined) {
      throw new ServiceLaunchNotConfiguredError();
    }
    return build(config);
  };
}
