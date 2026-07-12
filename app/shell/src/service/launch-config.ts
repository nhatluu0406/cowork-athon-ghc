/**
 * Launch-options resolution for the live service (CGHC-028 Wave B1).
 *
 * `startLiveCoworkService` needs a real {@link LiveCoworkServiceOptions}: an
 * `OpencodeSupervisor` (the ONE owner of the child lifecycle), a `SupervisorStartSpec`
 * (pinned binary path, workspace cwd, ports, data/config dirs, credential injection
 * requests), and the workspace id. Assembling those means constructing the supervisor from
 * the pinned OpenCode binary + the OS keyring credential store.
 *
 * The public `@cowork-ghc/service` barrel does NOT expose an `OpencodeSupervisor` factory
 * (its `exports` map only publishes the composition root + `./execution`), and this task
 * must NOT modify `service/**`. So the shell cannot assemble the REAL options from here;
 * doing so is the Wave C bounded live leg (a service-side "for shell" factory that pins the
 * binary, opens the keyring, and spawns the child under a bounded live test).
 *
 * Until a real resolver is injected, {@link resolveLiveOptionsNotConfigured} fails HONESTLY:
 * the ServiceController catches the rejection and hands the renderer the empty "not
 * connected" handshake (never a fabricated ready). The shell still boots, and the readiness
 * surface renders an honest `not_connected` with a Retry affordance.
 */

import type { ResolveLiveOptions } from "./live-service-adapter.js";

/** Honest, typed failure: live launch options are not assembled in this (Wave B1) build. */
export class ServiceLaunchNotConfiguredError extends Error {
  constructor() {
    super(
      "Live service launch options are not configured. Assembling the OpenCode supervisor " +
        "+ start spec (pinned binary, keyring credential injection, workspace) is a " +
        "service-side factory delivered in a later bounded live integration (Wave C). " +
        "Inject a real ResolveLiveOptions to enable a real launch.",
    );
    this.name = "ServiceLaunchNotConfiguredError";
  }
}

/**
 * The default launch-options resolver. It rejects with {@link ServiceLaunchNotConfiguredError}
 * so the ServiceController surfaces an honest not-connected bootstrap rather than fabricating
 * a ready state or hanging.
 */
export const resolveLiveOptionsNotConfigured: ResolveLiveOptions = () =>
  Promise.reject(new ServiceLaunchNotConfiguredError());
