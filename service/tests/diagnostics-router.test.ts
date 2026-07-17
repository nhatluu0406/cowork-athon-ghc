/**
 * Wave 6 — diagnostics boundary router: status, clear (telemetry/logs/all), and redacted export.
 * Drives the router handlers directly against a real in-memory telemetry store + an in-memory file
 * sink so behavior is deterministic and offline (no network anywhere).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RouteContext } from "../src/boundary/contract.js";
import { openMemorySqliteDatabase, runMigrations } from "../src/db/index.js";
import {
  createDiagnosticsRouter,
  createTelemetryStore,
  createFileSink,
  createRedactingLogger,
  createSecretScrubber,
  DIAGNOSTICS_PATH,
  DIAGNOSTICS_CLEAR_PATH,
  DIAGNOSTICS_EXPORT_PATH,
  type DiagnosticsStatusView,
  type DiagnosticsExportView,
  type LogFileSystem,
} from "../src/diagnostics/index.js";

function memFs(): LogFileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    appendFileSync: (p, d) => files.set(p, (files.get(p) ?? "") + d),
    existsSync: (p) => files.has(p),
    mkdirSync: () => {},
    renameSync: (f, t) => {
      const v = files.get(f);
      if (v !== undefined) {
        files.set(t, v);
        files.delete(f);
      }
    },
    rmSync: (p) => files.delete(p),
    statSize: (p) => Buffer.byteLength(files.get(p) ?? "", "utf8"),
  };
}

function build(enabled = true) {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const scrubber = createSecretScrubber();
  const telemetry = createTelemetryStore({ db, enabled, now: () => "2026-07-17T00:00:00.000Z" });
  const fs = memFs();
  const fileSink = createFileSink({ dir: "/logs", fs });
  const logger = createRedactingLogger({ scrubber, sink: fileSink.sink, verbose: true });
  const router = createDiagnosticsRouter({
    logger,
    fileSink,
    telemetry,
    scrubber,
    now: () => "2026-07-17T09-30-00-000Z",
  });
  const route = (method: string, path: string) =>
    router.routes.find((r) => r.method === method && r.path === path)!;
  return { router, route, telemetry, fileSink, logger, fs, scrubber };
}

test("GET /v1/diagnostics reports logging status + telemetry snapshot", async () => {
  const h = build(true);
  h.telemetry.increment("app_launches");
  h.logger.info("something happened"); // writes to the in-memory file sink
  const res = (await h.route("GET", DIAGNOSTICS_PATH).handler({} as RouteContext)) as {
    status: number;
    data: DiagnosticsStatusView;
  };
  assert.equal(res.status, 200);
  assert.equal(res.data.logging.verbose, true);
  assert.equal(res.data.logging.toFile, true);
  assert.ok(res.data.logging.sizeBytes > 0, "log file has content");
  assert.equal(res.data.telemetry.enabled, true);
  assert.equal(res.data.telemetry.counters.app_launches, 1);
});

test("POST /v1/diagnostics/clear target=telemetry wipes counters only", async () => {
  const h = build(true);
  h.telemetry.increment("errors");
  h.logger.info("keep me");
  const before = h.fileSink.size();
  const res = (await h
    .route("POST", DIAGNOSTICS_CLEAR_PATH)
    .handler({ body: { target: "telemetry" } } as unknown as RouteContext)) as {
    status: number;
    data: DiagnosticsStatusView;
  };
  assert.equal(res.data.telemetry.counters.errors, 0, "telemetry cleared");
  assert.equal(h.fileSink.size(), before, "logs untouched by a telemetry-only clear");
});

test("POST /v1/diagnostics/clear target=logs deletes the log file", async () => {
  const h = build(true);
  h.logger.info("to be cleared");
  assert.ok(h.fileSink.size() > 0);
  await h
    .route("POST", DIAGNOSTICS_CLEAR_PATH)
    .handler({ body: { target: "logs" } } as unknown as RouteContext);
  assert.equal(h.fileSink.size(), 0, "log file cleared");
  assert.equal(h.fs.files.has(h.fileSink.filePath), false);
});

test("POST /v1/diagnostics/clear rejects an unknown target", async () => {
  const h = build(true);
  await assert.rejects(
    async () =>
      h
        .route("POST", DIAGNOSTICS_CLEAR_PATH)
        .handler({ body: { target: "everything" } } as unknown as RouteContext),
    /target must be/,
  );
});

test("GET /v1/diagnostics/export returns a filesystem-safe filename and redacted JSON bundle", async () => {
  const h = build(true);
  // Teach the scrubber a secret value and confirm export never leaks it even if it appeared.
  h.scrubber.register({ value: "sk-exporttoken-must-not-leak", label: "OPENAI_API_KEY" });
  h.telemetry.increment("app_launches");
  const res = (await h.route("GET", DIAGNOSTICS_EXPORT_PATH).handler({} as RouteContext)) as {
    status: number;
    data: DiagnosticsExportView;
  };
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.data.filename, /[:*?"<>|]/, "filename is Windows-safe");
  assert.match(res.data.filename, /\.json$/);
  const parsed = JSON.parse(res.data.json) as {
    telemetry: { counters: Record<string, number> };
    logging: { verbose: boolean };
  };
  assert.equal(parsed.telemetry.counters["app_launches"], 1);
  assert.equal(parsed.logging.verbose, true);
  assert.equal(res.data.json.includes("sk-exporttoken-must-not-leak"), false, "export is scrubbed");
});
