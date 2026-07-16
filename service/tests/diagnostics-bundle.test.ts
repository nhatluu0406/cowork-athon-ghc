/**
 * Diagnostics-bundle export → grep for the secret value → 0 hits (SD2/SD4/SD7, AC4).
 *
 * Builds a REAL diagnostics bundle AND an execution-metadata record, each with a planted
 * fake secret placed everywhere it could plausibly surface (logs, env values, command
 * line, args, cwd, stdout tail), runs the exports, and asserts the secret VALUE appears
 * ZERO times in BOTH exported artifacts. Also proves status (SD2) + versions (SD7) are
 * reported truthfully.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSecretScrubber,
  createRedactingLogger,
  createBufferSink,
  exportDiagnosticsBundleJson,
  composeDiagnosticsBundle,
  exportExecutionMetadataJson,
  scrubExecutionMetadata,
  type ExecutionMetadata,
  type DiagnosticsBundleInputs,
} from "../src/diagnostics/index.js";

// PLANTED FAKE secret — never a real key.
const FAKE_KEY = "sk-FAKE-bundle-value-0f1e2d3c4b5a69788796a5b4";

function plantExecution(): ExecutionMetadata {
  return {
    command: "opencode",
    // Secret planted inside an arg and inside cwd — free-form substring positions.
    args: ["serve", "--port", "0", `--inline-key=${FAKE_KEY}`],
    cwd: `C:/Users/dev/keycache/${FAKE_KEY}`,
    env: [
      { name: "PATH", value: "C:/Windows;C:/Windows/System32", redacted: false },
      { name: "OPENAI_API_KEY", value: FAKE_KEY, redacted: false },
      { name: "AUTH_HEADER", value: `Bearer ${FAKE_KEY}`, redacted: false },
    ],
    pid: 4242,
    startedAt: "2026-07-11T00:00:00.000Z",
    exitCode: null,
    lastStdout: `server up; using ${FAKE_KEY}`,
    lastStderr: "",
  };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("execution-metadata record: exported JSON contains the secret VALUE 0 times", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const execution = plantExecution();

  // Sanity: the raw record DOES contain the secret (so the test can actually fail).
  assert.ok(JSON.stringify(execution).includes(FAKE_KEY));

  const json = exportExecutionMetadataJson(execution, scrubber);
  assert.equal(countOccurrences(json, FAKE_KEY), 0, "0 hits in execution-metadata export");

  // Structured scrub also flags the env entries that carried the secret.
  const scrubbed = scrubExecutionMetadata(execution, scrubber);
  const openaiEntry = scrubbed.env.find((e) => e.name === "OPENAI_API_KEY");
  assert.equal(openaiEntry?.redacted, true, "secret-bearing env entry flagged redacted");
  const pathEntry = scrubbed.env.find((e) => e.name === "PATH");
  assert.equal(pathEntry?.redacted, false, "non-secret env entry not flagged");
});

test("diagnostics bundle: exported JSON contains the secret VALUE 0 times (bundle AND execution)", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);

  // Real logger writing real records into a buffer that feeds the bundle.
  const buffer = createBufferSink();
  const logger = createRedactingLogger({ scrubber, sink: buffer.sink, verbose: true });
  logger.info(`launching child with OPENAI_API_KEY=${FAKE_KEY}`);
  logger.error("auth failed", { header: `Bearer ${FAKE_KEY}` });
  logger.debug(`verbose: raw token ${FAKE_KEY}`);

  const logs = buffer.records();
  const execution = plantExecution();
  const inputs: DiagnosticsBundleInputs = {
    capturedAt: "2026-07-11T12:00:00.000Z",
    versions: { coworkGhc: "0.1.0", runtime: "v1.18.1" },
    runtimeStatus: { state: "running", healthy: true, pid: 4242, host: "127.0.0.1", port: 49876 },
    logs,
    execution,
    verbose: true,
  };

  // LOW-2 positive control: the composed inputs REALLY contain the value (redacted logs
  // still hold placeholders, but the raw execution record + the raw pre-scrub log message
  // proves the export could fail — 0-hits is not vacuous). The execution record is raw here.
  assert.ok(JSON.stringify(execution).includes(FAKE_KEY), "raw execution input contains the secret");

  const json = exportDiagnosticsBundleJson(inputs, scrubber);

  // Load-bearing assertion: 0 occurrences of the planted value anywhere in the artifact.
  assert.equal(countOccurrences(json, FAKE_KEY), 0, "0 hits in diagnostics-bundle export");

  // SD2 + SD7 truthfulness: status + both versions present exactly as supplied.
  const parsed = JSON.parse(json) as {
    versions: { coworkGhc: string; runtime: string };
    runtimeStatus: { state: string; pid: number };
    logging: { verbose: boolean };
  };
  assert.equal(parsed.versions.coworkGhc, "0.1.0");
  assert.equal(parsed.versions.runtime, "v1.18.1");
  assert.equal(parsed.runtimeStatus.state, "running");
  assert.equal(parsed.runtimeStatus.pid, 4242);
  assert.equal(parsed.logging.verbose, true, "verbose reported truthfully (SD3)");
});

test("MEDIUM-1 — a secret with JSON-escapable chars in a status field is redacted to 0 real hits", () => {
  // A secret containing `"`, `\`, and a newline: stringify-THEN-scrub would only see the
  // escaped form (`\"`, `\\`, `\n`) and leave the raw secret in the export. Scrubbing
  // during serialization must still redact it.
  const specialSecret = 'sk-FAKE-"quote\\back\nline-0123456789abcdef';
  const scrubber = createSecretScrubber([specialSecret]);

  const inputs: DiagnosticsBundleInputs = {
    capturedAt: "2026-07-11T12:00:00.000Z",
    versions: { coworkGhc: "0.1.0", runtime: "v1.18.1" },
    // Planted in a caller-supplied status field.
    runtimeStatus: { state: "errored", host: `bind failed for ${specialSecret}` },
    logs: [],
    execution: null,
  };

  // Positive control: the composed bundle (status is passed through, scrubbed only at
  // export) DID carry the special secret — so a stringify-then-scrub export would leak it.
  const raw = composeDiagnosticsBundle(inputs, scrubber);
  assert.ok(raw.runtimeStatus.host?.includes(specialSecret), "raw status field contains the secret");

  const json = exportDiagnosticsBundleJson(inputs, scrubber);
  assert.equal(countOccurrences(json, specialSecret), 0, "0 real occurrences of the special secret");
  // The escaped form must not survive either.
  assert.ok(!json.includes('sk-FAKE-\\"quote'), "escaped form of the secret must not survive");
});

test("compose reports status/versions truthfully and never fabricates them", () => {
  const scrubber = createSecretScrubber();
  const inputs: DiagnosticsBundleInputs = {
    capturedAt: "2026-07-11T12:00:00.000Z",
    versions: { coworkGhc: "0.2.3", runtime: "v1.18.1" },
    runtimeStatus: { state: "stopped" },
    logs: [],
    execution: null,
  };
  const bundle = composeDiagnosticsBundle(inputs, scrubber);
  assert.equal(bundle.runtimeStatus.state, "stopped");
  assert.equal(bundle.versions.coworkGhc, "0.2.3");
  assert.equal(bundle.execution, null);
  assert.equal(bundle.logging.verbose, false, "verbose defaults off in the report");
});
