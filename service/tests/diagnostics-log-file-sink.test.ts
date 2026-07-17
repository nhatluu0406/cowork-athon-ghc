/**
 * Wave 6 — rotating file sink for local structured logging.
 *
 * Uses an in-memory LogFileSystem so rotation/retention are deterministic (no real disk, no clock).
 * Also proves records are persisted as injection-safe JSON-lines and that the sink cooperates with
 * the redacting logger (secrets never reach the file).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileSink, type LogFileSystem } from "../src/diagnostics/log-file-sink.js";
import {
  createRedactingLogger,
  createSecretScrubber,
  type LogRecord,
} from "../src/diagnostics/index.js";

/** Minimal in-memory fs honoring the LogFileSystem seam. */
function memFs(): LogFileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    appendFileSync(path, data) {
      files.set(path, (files.get(path) ?? "") + data);
    },
    existsSync: (path) => files.has(path),
    mkdirSync: () => {},
    renameSync(from, to) {
      const v = files.get(from);
      if (v !== undefined) {
        files.set(to, v);
        files.delete(from);
      }
    },
    rmSync(path) {
      files.delete(path);
    },
    statSize: (path) => Buffer.byteLength(files.get(path) ?? "", "utf8"),
  };
}

test("writes one JSON-lines record per call to the active file", () => {
  const fs = memFs();
  const { sink, filePath } = createFileSink({ dir: "/logs", fs });
  sink({ level: "info", at: "2026-07-17T00:00:00.000Z", message: "boot" });
  sink({ level: "warn", at: "2026-07-17T00:00:01.000Z", message: "warn", fields: { a: 1 } });
  const lines = (fs.files.get(filePath) ?? "").trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]!), {
    level: "info",
    at: "2026-07-17T00:00:00.000Z",
    message: "boot",
  });
  assert.equal((JSON.parse(lines[1]!) as LogRecord).fields!["a"], 1);
});

test("a message with newlines/control chars cannot forge a second record line", () => {
  const fs = memFs();
  const { sink, filePath } = createFileSink({ dir: "/logs", fs });
  // A crafted message tries to inject a fake 'error' record via embedded newlines.
  sink({
    level: "info",
    at: "2026-07-17T00:00:00.000Z",
    message: 'real\n{"level":"error","message":"forged"}\n',
  });
  const raw = fs.files.get(filePath) ?? "";
  const lines = raw.trimEnd().split("\n");
  assert.equal(lines.length, 1, "the whole record is a single physical line");
  assert.equal((JSON.parse(lines[0]!) as LogRecord).message.includes("forged"), true);
});

test("rotates when the active file exceeds maxBytes and keeps at most maxFiles", () => {
  const fs = memFs();
  const dir = "/logs";
  // Small cap so a couple of records trigger rotation; retention of 3 total files.
  const { sink, filePath } = createFileSink({ dir, fs, maxBytes: 120, maxFiles: 3 });
  for (let i = 0; i < 40; i += 1) {
    sink({ level: "info", at: "2026-07-17T00:00:00.000Z", message: `record-${i}` });
  }
  const logFiles = [...fs.files.keys()].filter((p) => p.includes("cowork-ghc.log"));
  assert.ok(logFiles.length <= 3, `retention caps total files at 3, got ${logFiles.length}`);
  assert.ok(fs.files.has(filePath), "active file exists");
  // The oldest data is dropped: the very first record must no longer be anywhere on disk.
  const all = [...fs.files.values()].join("\n");
  assert.equal(all.includes("record-0"), false, "oldest records are pruned by retention");
  assert.equal(all.includes("record-39"), true, "newest record is retained");
});

test("secrets never reach the file — logger scrubs before the sink", () => {
  const fs = memFs();
  const scrubber = createSecretScrubber();
  scrubber.register({ value: "sk-supersecretvalue123", label: "OPENAI_API_KEY" });
  const { sink, filePath } = createFileSink({ dir: "/logs", fs });
  const logger = createRedactingLogger({ scrubber, sink });
  logger.error("provider failed", { authorization: "Bearer sk-supersecretvalue123" });
  const raw = fs.files.get(filePath) ?? "";
  assert.equal(raw.includes("sk-supersecretvalue123"), false, "secret value is redacted on disk");
  assert.equal(raw.includes("[REDACTED]"), true, "redaction placeholder is present");
});
