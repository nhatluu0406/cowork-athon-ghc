/**
 * Local barrel for the OpenCode child supervisor (CGHC-028 Wave A1).
 *
 * The Tier 2 composition (Wave A2) imports {@link OpencodeSupervisor} from here to fill the
 * runtime seams: it consumes `baseUrl` + `isAlive` (the {@link RuntimeHealth} implementation)
 * plus the running child for the HTTP data adapters (SessionStore / reply / connector). The
 * top-level `service/src/index.ts` is intentionally NOT edited in this wave.
 */

export {
  OpencodeSupervisor,
  type OpencodeSupervisorOptions,
  type SupervisorStartSpec,
  type ResolveInjections,
} from "./supervisor.js";

export {
  nodeChildSpawner,
  type ChildSpawner,
  type SupervisedChild,
  type SpawnChildOptions,
  type ChildEvent,
} from "./child-spawner.js";

export {
  fetchHealthProbe,
  win32ProcessTimesProbe,
  netPortChecker,
  type HealthProbe,
  type HealthReport,
  type ProcessTimesProbe,
  type ProcessTimes,
  type PortChecker,
} from "./probes.js";

export {
  buildOpencodeConfig,
  writeOpencodeConfig,
  LIVE_SESSION_PERMISSION_POLICY,
  type OpencodeProviderConfig,
  type OpencodeSkillsConfig,
} from "./opencode-config.js";

export {
  writeRuntimeState,
  readRuntimeState,
  clearRuntimeState,
  AGENT_RUNTIME_ROLE,
} from "./runtime-state.js";

export {
  RuntimeSpawnError,
  RuntimeHealthTimeoutError,
  RuntimePortInUseError,
  RuntimeIdentityCaptureError,
  RuntimeAlreadyStartedError,
} from "./errors.js";

// --- Wave A2: the LIVE OpenCode HTTP data adapters that fill the Tier 2 injection seams. ---
export {
  createOpencodeHttp,
  type OpencodeHttp,
  type OpencodeCall,
  type OpencodeClientOptions,
} from "./opencode-client.js";

export {
  OpencodeHttpError,
  OpencodeUnreachableError,
  RuntimeNotReadyError,
} from "./opencode-http-error.js";

export {
  createOpencodeSessionStore,
  type OpencodeSessionStoreOptions,
} from "./session-store-adapter.js";

export {
  createOpencodeRuntimeReply,
  type OpencodeRuntimeReplyOptions,
} from "./runtime-reply-adapter.js";

export {
  createOpencodeConnector,
  type OpencodeConnectorOptions,
} from "./provider-connector-adapter.js";

export {
  createOpencodeSendPrompt,
  type OpencodeSendPromptOptions,
} from "./send-prompt-adapter.js";

export {
  createEventPump,
  type EventPump,
  type EventPumpOptions,
  type EventPumpTarget,
  type PumpRunController,
} from "./event-pump.js";

export {
  createPermissionBridge,
  type PermissionBridge,
  type PermissionBridgeOptions,
} from "./permission-bridge.js";
