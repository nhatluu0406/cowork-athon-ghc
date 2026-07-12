/**
 * Diagnostics bundle export (SD2/SD4/SD7, PR8). Composes a truthful snapshot — runtime
 * status (SD2), both Cowork GHC + runtime versions (SD7), retained (already-redacted)
 * logs, and the execution-metadata record — then exports it through the SAME value-based
 * scrubber the logger uses. Export scrubs every string value AS it is serialized (a
 * `JSON.stringify` replacer runs each raw string through the scrubber before JSON
 * escaping), so a registered secret value is redacted in every string-valued field of the
 * artifact — including secrets containing JSON-escapable characters (`"`, `\`, newline).
 * The graph is made cycle-safe and Error detail preserved by `scrubDeep` first.
 *
 * Truthfulness (SD2/SD7): status and versions are supplied by the caller from live
 * sources (the supervisor + the runtime pin / app build info). This module never
 * fabricates a "running" status or a version — it reports exactly what it is given.
 */

import type { SecretScrubber } from "./secret-scrubber.js";
import type { LogRecord } from "./redacting-logger.js";
import {
  scrubExecutionMetadata,
  type ExecutionMetadata,
} from "./execution-metadata.js";

/** Truthful runtime run-state (SD2). `unknown` when the supervisor cannot determine it. */
export type RuntimeRunState = "running" | "starting" | "stopped" | "errored" | "unknown";

/** A truthful runtime status snapshot (SD2). */
export interface RuntimeStatus {
  readonly state: RuntimeRunState;
  readonly healthy?: boolean;
  readonly pid?: number;
  readonly host?: string;
  readonly port?: number;
}

/** Both versions shown truthfully (SD7): the app and the pinned runtime. */
export interface VersionInfo {
  /** Cowork GHC application version. */
  readonly coworkGhc: string;
  /** OpenCode runtime version (the ADR 0001 pin). */
  readonly runtime: string;
}

/** Everything the bundle export needs. All optional secrets scrubbed on the way out. */
export interface DiagnosticsBundleInputs {
  readonly capturedAt: string;
  readonly versions: VersionInfo;
  readonly runtimeStatus: RuntimeStatus;
  /** Already-redacted records from the redacting logger's buffer sink. */
  readonly logs: readonly LogRecord[];
  /** The execution-metadata record, if a child has been launched. */
  readonly execution?: ExecutionMetadata | null;
  /** Whether verbose logging was enabled (does NOT affect redaction; SD3). */
  readonly verbose?: boolean;
}

/** The composed (structured) diagnostics bundle. */
export interface DiagnosticsBundle {
  readonly capturedAt: string;
  readonly versions: VersionInfo;
  readonly runtimeStatus: RuntimeStatus;
  readonly logging: { readonly verbose: boolean; readonly retainedRecords: number };
  readonly logs: readonly LogRecord[];
  readonly execution: ExecutionMetadata | null;
}

/**
 * Compose the structured bundle, scrubbing the execution-metadata record by VALUE. Logs
 * are assumed already-redacted (they came through the redacting logger) but are re-scrubbed
 * at export time by {@link exportDiagnosticsBundleJson} for defense in depth.
 */
export function composeDiagnosticsBundle(
  input: DiagnosticsBundleInputs,
  scrubber: SecretScrubber,
): DiagnosticsBundle {
  const execution =
    input.execution == null ? null : scrubExecutionMetadata(input.execution, scrubber);
  return {
    capturedAt: input.capturedAt,
    versions: input.versions,
    runtimeStatus: input.runtimeStatus,
    logging: { verbose: input.verbose ?? false, retainedRecords: input.logs.length },
    logs: input.logs,
    execution,
  };
}

/**
 * Export the diagnostics bundle as scrubbed JSON. `scrubJson` scrubs each raw string value
 * during serialization (before JSON escaping) and makes the graph cycle-safe, so any
 * registered secret value is redacted in every string-valued field of the returned JSON —
 * including values containing quotes, backslashes, or newlines.
 */
export function exportDiagnosticsBundleJson(
  input: DiagnosticsBundleInputs,
  scrubber: SecretScrubber,
  space = 2,
): string {
  const bundle = composeDiagnosticsBundle(input, scrubber);
  return scrubber.scrubJson(bundle, space);
}
