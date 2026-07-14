/**
 * Public surface of `@cowork-ghc/service`: the local application service (ADR 0003) and
 * its typed boundary contract. Downstream tasks import the boundary types + `mount` seam
 * from here to attach their routers; the shell imports `startService` + the typed client.
 */

// Boundary contract (the load-bearing typed surface).
export {
  BOUNDARY_PROTOCOL_VERSION,
  SERVICE_NAME,
  type BoundaryProtocolVersion,
  type BoundaryError,
  type BoundaryErrorCode,
  type SuccessEnvelope,
  type ErrorEnvelope,
  type ResponseEnvelope,
  type HttpMethod,
  type RouteContext,
  type RouteResult,
  type RouteHandler,
  type RouteDefinition,
  type StreamRouteHandler,
  type StreamingRouteDefinition,
  type AnyRouteDefinition,
  type SseWriter,
  isStreamingRoute,
  type BoundaryRouter,
  type HealthData,
  type BoundaryClient,
  type BoundaryAuditEvent,
  type BoundaryAuditSink,
  type UnauthenticatedRouteMounted,
} from "./boundary/contract.js";

// Typed client.
export {
  createBoundaryClient,
  BoundaryClientError,
  type BoundaryClientOptions,
} from "./boundary/client.js";

// Service (construct/mount/start/stop/health seam).
export {
  createService,
  type LocalService,
  type ServiceOptions,
  type ServiceAddress,
} from "./server/http-service.js";

// Convenience start seam for the shell/scripts.
export { startService, type StartServiceOptions, type RunningService } from "./start.js";

// Loopback + token primitives (P7 / MED-1) — exported for supervisors and tests.
export {
  LOOPBACK_HOSTS,
  isLoopbackAddress,
  assertLoopbackHost,
  shouldAcceptConnection,
  isAllowedHostHeader,
  LoopbackBindError,
  type LoopbackHost,
} from "./server/loopback.js";
export {
  generateClientToken,
  verifyClientToken,
  checkClientToken,
  extractClientToken,
  assertConfiguredToken,
  WeakClientTokenError,
  type TokenCheck,
} from "./server/token.js";
export { HEALTH_PATH, createHealthRouter } from "./server/health-router.js";

// EV timeline transport (CGHC-014 snapshot/resync + CGHC-015 live SSE stream). The composition
// root mounts both routers against one `SessionStreamHub` bound to the live `SessionService`.
export {
  createEvStreamRouter,
  EV_SNAPSHOT_PATH,
  type SnapshotSource,
  type SessionSnapshotResult,
  type SessionSnapshotFound,
  type SessionSnapshotMissing,
} from "./server/ev-stream-router.js";
export {
  createSessionStreamRouter,
  EV_STREAM_PATH,
  type SessionStreamRouterOptions,
  type IntervalScheduler,
} from "./server/session-stream-route.js";
export {
  createSessionStreamHub,
  type SessionStreamHub,
  type SessionStreamHubOptions,
  type SessionEventSource,
  type SessionRunController,
  type EvListener,
  type Unsubscribe,
} from "./server/session-stream-hub.js";

// Domain modules (L6 wave 2), namespaced to avoid export-name collisions (e.g. the shared
// SecretScrubber is re-exported by both credential and diagnostics). Each has its own barrel:
//   workspace  — grant + confinement (W4/F4, CGHC-007)
//   credential — @napi-rs/keyring store + inject-at-launch (PR9/SEC-1, CGHC-009)
//   diagnostics— value-based scrubber + redacting logger + bundle export (PR8/SD*, CGHC-021)
//   execution  — OpenCode SSE -> EV mapper + reducer (EV1-EV7, CGHC-012)
export * as workspace from "./workspace/index.js";
export * as credential from "./credential/index.js";
export * as diagnostics from "./diagnostics/index.js";
export * as execution from "./execution/index.js";
export * as skills from "./skills/index.js";

// Composition root (Tier 1): the integration assembly that wires the domain modules above into
// ONE running loopback service and mounts every router. The shell/scripts call `startCoworkService`;
// the live-runtime boundaries are Tier 2 injection seams with honest not-attached defaults (CGHC-028).
export {
  createCoworkService,
  startCoworkService,
  startLiveCoworkService,
  buildLiveCoworkOptions,
  LiveLaunchConfigError,
  RuntimeNotAttachedError,
  downRuntimeHealth,
  notAttachedConnector,
  notAttachedRuntimeReplyPort,
  notAttachedSessionStore,
  defaultDnsResolver,
  type CoworkService,
  type CoworkServiceDeps,
  type CoworkServiceOptions,
  type LiveCoworkService,
  type LiveCoworkServiceOptions,
  type LiveRuntimeSupervisor,
  type BuildLiveCoworkInput,
  type LiveProviderSelection,
  type BuiltInProviderSelection,
  type CustomProviderSelection,
} from "./composition/index.js";

// OpenCode child-process supervisor (CGHC-028 Wave A1) — exported so the shell/Wave C can construct
// and start a REAL supervisor to inject into `buildLiveCoworkOptions` / `startLiveCoworkService`.
export {
  OpencodeSupervisor,
  type OpencodeSupervisorOptions,
  type SupervisorStartSpec,
  type ResolveInjections,
  nodeChildSpawner,
  type ChildSpawner,
  type SupervisedChild,
  type SpawnChildOptions,
  fetchHealthProbe,
  netPortChecker,
  win32ProcessTimesProbe,
  type HealthProbe,
  type HealthReport,
  type PortChecker,
  type ProcessTimesProbe,
  type ProcessTimes,
  type OpencodeProviderConfig,
  RuntimeSpawnError,
  RuntimeHealthTimeoutError,
  RuntimePortInUseError,
  RuntimeIdentityCaptureError,
  RuntimeAlreadyStartedError,
} from "./runtime/index.js";

export {
  readE2eMockLlmBaseUrl,
  isE2eMockLlmUrl,
  assertLoopbackMockBaseUrl,
  E2E_MOCK_LLM_ENV_KEY,
} from "./provider/e2e-mock-llm.js";

export {
  createProviderProfileStore,
  createProviderConnectionTester,
  createProfileRuntimeBridge,
  createProviderProfileRouter,
  migrateLegacySettingsToProfiles,
  resolveRuntimeProviderConfig,
  conversationSnapshotFallback,
  type ProviderProfile,
  type ProviderProfileView,
  type ProviderProfileStore,
} from "./provider-profiles/index.js";

export {
  createPairingRegistry,
  startRemoteGateway,
  isRemoteEnabled,
  resolveRemoteBindHost,
  createRemoteRouter,
  REMOTE_STATUS_PATH,
  REMOTE_PAIRING_CODE_PATH,
  REMOTE_REVOKE_PATH,
  REMOTE_REVOKE_ALL_PATH,
  type PairingRegistry,
  type PairedDeviceView,
  type RemoteGateway,
  type RemoteGatewayOptions,
  type RemoteStatusView,
} from "./remote-gateway/index.js";
