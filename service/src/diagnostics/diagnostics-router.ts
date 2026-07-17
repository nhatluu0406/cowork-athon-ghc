/**
 * Diagnostics boundary router (Wave 6). Read + control local logging/telemetry from Settings.
 *
 * Token-guarded like every sensitive route. It performs NO network egress — it only reports local
 * status, clears local data, and produces a REDACTED export blob (the shell writes it to disk via a
 * save dialog; the renderer never chooses an arbitrary path). Every string that leaves here is run
 * through the SAME secret scrubber as a defense-in-depth belt over the already-non-secret data.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { RedactingLogger } from "./redacting-logger.js";
import type { FileSink } from "./log-file-sink.js";
import type { SecretScrubber } from "./secret-scrubber.js";
import {
  TELEMETRY_COUNTERS,
  type TelemetryStore,
  type TelemetrySnapshot,
} from "./telemetry-store.js";

export const DIAGNOSTICS_PATH = "/v1/diagnostics";
export const DIAGNOSTICS_CLEAR_PATH = "/v1/diagnostics/clear";
export const DIAGNOSTICS_EXPORT_PATH = "/v1/diagnostics/export";

export interface LoggingStatusView {
  /** Whether detailed (debug) logging is on. */
  readonly verbose: boolean;
  /** Whether logs are written to a file (vs console-only). */
  readonly toFile: boolean;
  /** Current active log-file size in bytes (0 when console-only). */
  readonly sizeBytes: number;
}

export interface DiagnosticsStatusView {
  readonly logging: LoggingStatusView;
  readonly telemetry: TelemetrySnapshot;
}

export interface DiagnosticsExportView {
  /** Suggested file name for the save dialog. */
  readonly filename: string;
  /** Redacted, pretty-printed diagnostics JSON to write to disk. */
  readonly json: string;
}

export type DiagnosticsClearTarget = "telemetry" | "logs" | "all";

export interface DiagnosticsRouterDeps {
  readonly logger: RedactingLogger;
  readonly fileSink?: FileSink;
  readonly telemetry?: TelemetryStore;
  readonly scrubber: SecretScrubber;
  readonly now: () => string;
}

function emptySnapshot(): TelemetrySnapshot {
  const counters = {} as TelemetrySnapshot["counters"];
  for (const name of TELEMETRY_COUNTERS) counters[name] = 0;
  return { enabled: false, counters, updatedAt: null };
}

function statusOf(deps: DiagnosticsRouterDeps): DiagnosticsStatusView {
  return {
    logging: {
      verbose: deps.logger.verbose,
      toFile: deps.fileSink !== undefined,
      sizeBytes: deps.fileSink?.size() ?? 0,
    },
    telemetry: deps.telemetry?.snapshot() ?? emptySnapshot(),
  };
}

function parseClearTarget(body: unknown): DiagnosticsClearTarget {
  const target = (body as { target?: unknown } | null)?.target;
  if (target === "telemetry" || target === "logs" || target === "all") return target;
  throw new BadRequestError('target must be "telemetry", "logs", or "all".');
}

/** Build the diagnostics router. `fileSink`/`telemetry` are absent when no SQLite DB is open. */
export function createDiagnosticsRouter(deps: DiagnosticsRouterDeps): BoundaryRouter {
  return {
    name: "diagnostics",
    routes: [
      {
        method: "GET",
        path: DIAGNOSTICS_PATH,
        handler: (): RouteResult<DiagnosticsStatusView> => ({ status: 200, data: statusOf(deps) }),
      },
      {
        method: "POST",
        path: DIAGNOSTICS_CLEAR_PATH,
        handler: (ctx: RouteContext): RouteResult<DiagnosticsStatusView> => {
          const target = parseClearTarget(ctx.body);
          if (target === "telemetry" || target === "all") deps.telemetry?.clear();
          if (target === "logs" || target === "all") deps.fileSink?.clear();
          return { status: 200, data: statusOf(deps) };
        },
      },
      {
        method: "GET",
        path: DIAGNOSTICS_EXPORT_PATH,
        handler: (): RouteResult<DiagnosticsExportView> => {
          const status = statusOf(deps);
          const bundle = {
            generatedAt: deps.now(),
            note: "Local Cowork GHC diagnostics. Aggregate counters + logging status only — no prompt/document content, credentials, paths, or raw runtime events.",
            logging: status.logging,
            telemetry: status.telemetry,
          };
          // Defense-in-depth: the data is already non-secret, but scrub the serialized blob anyway.
          const json = deps.scrubber.scrub(JSON.stringify(bundle, null, 2));
          const stamp = deps.now().replace(/[:.]/g, "-");
          return { status: 200, data: { filename: `cowork-ghc-diagnostics-${stamp}.json`, json } };
        },
      },
    ],
  };
}
