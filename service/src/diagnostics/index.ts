/**
 * Local barrel for the diagnostics module (CGHC-021): the value-based secret scrubber
 * (SEC-2), the redacting logger (SD3), the execution-metadata record + its value scrub
 * (AC4), the diagnostics-bundle export (SD2/SD4/SD7), and the scrub-before-emit error
 * seam for the boundary error path / audit (CGHC-002 / CGHC-016).
 *
 * The top-level `service/src/index.ts` is intentionally NOT edited here — the service
 * orchestrator wires this module onto the boundary later. Consumers import from this
 * local barrel: `../diagnostics/index.js`.
 */

export {
  REDACTION_PLACEHOLDER,
  MIN_SECRET_LENGTH,
  createSecretScrubber,
  type SecretScrubber,
  type SecretInput,
  type RegisteredSecret,
} from "./secret-scrubber.js";

export {
  createRedactingLogger,
  createBufferSink,
  consoleSink,
  type RedactingLogger,
  type RedactingLoggerOptions,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type BufferSink,
} from "./redacting-logger.js";

export {
  createFileSink,
  type FileSink,
  type FileSinkOptions,
  type LogFileSystem,
} from "./log-file-sink.js";

export {
  createTelemetryStore,
  recordEventTelemetry,
  TELEMETRY_COUNTERS,
  type TelemetryStore,
  type TelemetryStoreOptions,
  type TelemetrySnapshot,
  type TelemetryCounter,
} from "./telemetry-store.js";

export {
  scrubExecutionMetadata,
  exportExecutionMetadataJson,
  type ExecutionMetadata,
  type ExecutionEnvEntry,
} from "./execution-metadata.js";

export {
  composeDiagnosticsBundle,
  exportDiagnosticsBundleJson,
  type DiagnosticsBundle,
  type DiagnosticsBundleInputs,
  type RuntimeStatus,
  type RuntimeRunState,
  type VersionInfo,
} from "./diagnostics-bundle.js";

export {
  redactErrorForEmit,
  redactMessageForEmit,
} from "./error-redaction.js";

// Settings store (CGHC-022): SD1 persistent general/provider/model-preference store, SD5
// corrupt-recovery, SD4 non-secret diagnostics export, and the loopback settings router.
export {
  SETTINGS_SCHEMA_VERSION,
  DEFAULT_GENERAL_SETTINGS,
  defaultSettings,
  type ThemePreference,
  type GeneralSettings,
  type ProviderSettingsEntry,
  type ActiveWorkspace,
  type ModelPreference,
  type CoworkSettings,
} from "./settings-types.js";

export {
  recoverSettings,
  type SettingsSource,
  type SettingsRecoveryReason,
  type SettingsLoadResult,
} from "./settings-recovery.js";

export {
  openSettingsStore,
  type SettingsStore,
  type SettingsStoreOptions,
  type SettingsFs,
} from "./settings-store.js";

export { createNodeSettingsFs } from "./settings-fs-node.js";

export {
  composeSettingsDiagnostics,
  exportSettingsDiagnosticsJson,
  type SettingsDiagnostics,
  type SettingsDiagnosticsInputs,
} from "./settings-diagnostics.js";

export {
  createSettingsRouter,
  SettingsRequestError,
  SETTINGS_PATH,
  SETTINGS_GENERAL_PATH,
  SETTINGS_CREDENTIAL_PATH,
  SETTINGS_BASE_URL_PATH,
  SETTINGS_ENV_VAR_PATH,
  SETTINGS_DEFAULT_MODEL_PATH,
  SETTINGS_SESSION_MODEL_PATH,
  SETTINGS_ACTIVE_WORKSPACE_PATH,
  type SettingsModelPort,
  type SettingsView,
} from "./settings-router.js";
