/**
 * Local barrel for the provider unit (CGHC-010, ADR 0005 — thin provider-neutral
 * `ProviderPort` over the reused OpenCode runtime + the outbound SSRF policy).
 *
 * The top-level `service/src/index.ts` is intentionally NOT edited here; the orchestrator
 * wires this barrel (port + router) onto the CGHC-002 loopback boundary with the token
 * guard. Consumers import from this local barrel: `../provider/index.js`.
 *
 * Downstream consumption:
 *  - CGHC-011 (add credential + test connection) supplies the {@link ProviderConnector}
 *    and routes its runtime probe through {@link ProviderPort.guardedConnect}; it binds a
 *    {@link import("@cowork-ghc/contracts").CredentialRef} via `configureCredential`.
 *  - CGHC-012 (streamChat) wraps its runtime SSE call in `guardedConnect` for the custom
 *    endpoint (DNS-rebinding guard at connect time).
 *  - CGHC-019 (model switch) uses `configureModel`/`modelSelection`; CGHC-020 refines
 *    {@link mapProviderError} per-provider and tunes retry bounds.
 */

export {
  PROVIDER_DESCRIPTORS,
  CUSTOM_OPENAI_COMPAT_ID,
  isCustomEndpoint,
  requiresBaseUrl,
  providerEnvSpec,
} from "./descriptors.js";

export {
  classifyIp,
  classifyIpv4,
  classifyIpv6,
  isBlockedClass,
  type IpClass,
} from "./ip-classify.js";

export {
  createSsrfPolicy,
  orderConnectCandidates,
  SsrfBlockedError,
  isPrivateProviderAllowed,
  type SsrfPolicy,
  type SsrfPolicyOptions,
  type SsrfDecision,
  type SsrfBlockReason,
  type ConnectTarget,
  type DnsResolver,
  type ResolvedAddress,
} from "./ssrf-policy.js";

export {
  BUILD_PROFILE,
  ReleaseGuardrailError,
  resolveLoopbackEscape,
  productionLoopbackEscape,
  type BuildProfile,
  type LoopbackEscapeInput,
  type SsrfTestModeAudit,
} from "./test-mode.js";

export {
  readE2eMockLlmBaseUrl,
  isE2eMockLlmUrl,
  assertLoopbackMockBaseUrl,
  E2E_MOCK_LLM_ENV_KEY,
} from "./e2e-mock-llm.js";

export {
  readDevLoopbackHttpEscape,
  DEV_LOOPBACK_HTTP_ENV_KEY,
  DEV_LOOPBACK_HTTP_WARNING,
} from "./dev-loopback-http.js";

export { mapProviderError } from "./error-map.js";

export {
  retryDecision,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
  type RetryDecision,
  type RetryDecisionOptions,
} from "./retry-policy.js";

export {
  createProviderPort,
  type ProviderPort,
  type ProviderPortOptions,
  type ProviderConnector,
  type StreamHandle,
  type RedactPattern,
} from "./provider-port.js";

export {
  createHttpConnector,
  SocketPinViolationError,
  CrossHostRedirectError,
  type HttpConnectorOptions,
  type CredentialResolver,
} from "./http-connector.js";

export {
  createModelConfigService,
  type ModelConfigService,
  type ModelConfigServiceOptions,
  type ActiveModel,
} from "./model-config-service.js";

export {
  createInMemoryModelAuditSink,
  type ModelAuditSink,
  type ModelChangeAuditEvent,
  type InMemoryModelAuditSink,
} from "./model-audit.js";

export {
  createHttpsDialer,
  ProbeTimeoutError,
  type HttpDialer,
  type HttpProbeRequest,
  type HttpProbeResponse,
} from "./http-dialer.js";

export { probeUrlFor, authHeadersFor } from "./probe-profiles.js";

export {
  createModelDiscovery,
  parseModelList,
  type ModelDiscovery,
  type ModelDiscoveryOptions,
  type ModelDiscoveryTarget,
} from "./model-discovery.js";

export {
  createProviderRouter,
  ProviderRequestError,
  PROVIDERS_PATH,
  PROVIDER_ENDPOINT_PATH,
  PROVIDER_TEST_CONNECTION_PATH,
} from "./router.js";
