/**
 * Composition-root barrel (Tier 1). The shell/scripts import {@link startCoworkService} to bring
 * up the fully-wired loopback service; tests import {@link createCoworkService} to drive the
 * assembled boundary. The Tier 2 not-attached defaults + typed error are re-exported so the live
 * supervisor (CGHC-028) can reference them when it injects real runtime seams.
 */

export {
  createCoworkService,
  startCoworkService,
} from "./compose-service.js";

export type {
  CoworkService,
  CoworkServiceDeps,
  CoworkServiceOptions,
} from "./types.js";

export {
  RuntimeNotAttachedError,
  downRuntimeHealth,
  notAttachedConnector,
  notAttachedRuntimeReplyPort,
  notAttachedSendPrompt,
  notAttachedSessionStore,
} from "./tier2-seams.js";

export { defaultDnsResolver, wrapSettingsStoreWithSsrf } from "./wiring.js";

// Tier 2 LIVE composition (CGHC-028 Wave A2): fills the runtime seams with real HTTP adapters.
export {
  startLiveCoworkService,
  type LiveCoworkService,
  type LiveCoworkServiceOptions,
  type LiveRuntimeSupervisor,
} from "./compose-live.js";

// Shell-friendly live-options builder (CGHC-028 Wave B2a): assembles LiveCoworkServiceOptions
// (supervisor + startSpec + seeded scrubber) from minimal inputs so the shell can inject a REAL
// live-service resolver.
export {
  buildLiveCoworkOptions,
  LiveLaunchConfigError,
  type BuildLiveCoworkInput,
  type LiveProviderSelection,
  type BuiltInProviderSelection,
  type CustomProviderSelection,
} from "./live-launch.js";

// Re-exported so shell-side callers (e.g. the tiered start-service) can `instanceof`-check the
// SSRF boot-lockout case without importing the provider module directly (security-review fix).
export { SsrfBlockedError } from "../provider/index.js";
