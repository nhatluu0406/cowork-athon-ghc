/**
 * Value-based secret redaction (SEC-2) + SD3 verbose-vs-redaction tests.
 *
 * Proves the scrubber matches the secret VALUE as a SUBSTRING (log line, command line,
 * stack frame) — and that the env-var NAME alone is NOT the trigger — and that verbose
 * logging is off by default and, when enabled, still redacts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSecretScrubber,
  createRedactingLogger,
  createBufferSink,
  REDACTION_PLACEHOLDER,
  MIN_SECRET_LENGTH,
  type LogRecord,
} from "../src/diagnostics/index.js";

// A PLANTED FAKE secret value — never a real provider key (task constraint).
const FAKE_KEY = "sk-FAKE-live-value-9f8e7d6c5b4a3210deadbeef";
const ENV_NAME = "OPENAI_API_KEY";

test("scrubs the secret VALUE embedded as a substring of a larger string", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);

  // Log line, command line, and stack frame — the value is a substring of each.
  const logLine = `2026-07-11 request failed using ${ENV_NAME}=${FAKE_KEY} at boundary`;
  const commandLine = `opencode serve --token ${FAKE_KEY} --port 0`;
  const stack = `Error: auth\n    at connect (Authorization: Bearer ${FAKE_KEY})`;

  for (const text of [logLine, commandLine, stack]) {
    const out = scrubber.scrub(text);
    assert.ok(!out.includes(FAKE_KEY), "the secret value must not survive");
    assert.ok(out.includes(REDACTION_PLACEHOLDER), "placeholder must appear");
  }
});

test("the env-var NAME alone is NOT the trigger — only the VALUE is (value vs name)", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);

  // A string that mentions the env-var NAME but does NOT contain the value: untouched.
  const nameOnly = `set ${ENV_NAME} in Windows Credential Manager before launch`;
  assert.equal(scrubber.scrub(nameOnly), nameOnly);
  assert.equal(scrubber.containsSecret(nameOnly), false);

  // The same string WITH the value present: the value (not the name) is redacted.
  const withValue = `${ENV_NAME}=${FAKE_KEY}`;
  const scrubbed = scrubber.scrub(withValue);
  assert.ok(scrubbed.includes(ENV_NAME), "the non-secret name is preserved");
  assert.ok(!scrubbed.includes(FAKE_KEY), "the secret value is removed");
  assert.equal(scrubbed, `${ENV_NAME}=${REDACTION_PLACEHOLDER}`);
});

test("unrelated strings pass through unchanged; too-short secrets are ignored (safety)", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  assert.equal(scrubber.scrub("nothing secret here"), "nothing secret here");

  // A 1–3 char value would nuke ordinary text — it must be ignored.
  scrubber.register("ab");
  assert.equal(scrubber.size, 1, "too-short secret not registered");
  assert.ok(MIN_SECRET_LENGTH >= 4);
  assert.equal(scrubber.scrub("a stable cabbage"), "a stable cabbage");
});

test("scrubDeep redacts secret values nested in objects and arrays", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const input = {
    header: `Bearer ${FAKE_KEY}`,
    nested: { items: [`x=${FAKE_KEY}`, "safe"] },
    count: 3,
  };
  const out = scrubber.scrubDeep(input);
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes(FAKE_KEY));
  assert.equal(out.count, 3, "non-string values are preserved");
});

test("LOW-1 — scrubDeep preserves AND scrubs Error message/stack (non-enumerable)", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const err = new Error(`boom with ${FAKE_KEY}`);
  const out = scrubber.scrubDeep({ err }) as { err: { message: string; stack: string; name: string } };

  assert.equal(out.err.name, "Error", "error name preserved");
  assert.ok(out.err.message.includes(REDACTION_PLACEHOLDER), "message preserved + scrubbed");
  assert.ok(!out.err.message.includes(FAKE_KEY));
  assert.ok(typeof out.err.stack === "string" && out.err.stack.length > 0, "stack preserved");
  assert.ok(!out.err.stack.includes(FAKE_KEY), "stack scrubbed");
});

test("MEDIUM-2 — scrubJson does NOT throw on a circular graph and still redacts", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const node: Record<string, unknown> = { header: `Bearer ${FAKE_KEY}` };
  node.self = node; // reference cycle

  let json = "";
  assert.doesNotThrow(() => {
    json = scrubber.scrubJson(node);
  });
  assert.ok(!json.includes(FAKE_KEY), "secret redacted despite the cycle");
  assert.ok(json.includes("[Circular]"), "cycle broken by sentinel");
});

test("MEDIUM-2 — logging a circular-reference field does not throw and still redacts", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const buffer = createBufferSink();
  const logger = createRedactingLogger({ scrubber, sink: buffer.sink });

  const socketLike: Record<string, unknown> = { token: FAKE_KEY };
  socketLike.parent = socketLike; // common Node request/socket/error-cause shape

  assert.doesNotThrow(() => logger.error("socket failure", { socket: socketLike }));
  const records: LogRecord[] = buffer.records();
  assert.equal(records.length, 1, "record still emitted");
  assert.ok(!JSON.stringify(records[0]).includes(FAKE_KEY), "secret redacted in the record");
});

test("SD3 — verbose is OFF by default and debug is not emitted", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const buffer = createBufferSink();
  const logger = createRedactingLogger({ scrubber, sink: buffer.sink });

  assert.equal(logger.verbose, false, "verbose off by default");
  logger.debug("debug detail", { key: FAKE_KEY });
  assert.equal(buffer.records().length, 0, "debug suppressed when verbose off");

  logger.info(`connecting with ${ENV_NAME}=${FAKE_KEY}`);
  const records = buffer.records();
  assert.equal(records.length, 1);
  assert.ok(!records[0]!.message.includes(FAKE_KEY), "info is redacted by default");
});

test("SD3 — enabling verbose emits debug but does NOT disable redaction", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const buffer = createBufferSink();
  const logger = createRedactingLogger({ scrubber, sink: buffer.sink });

  logger.setVerbose(true);
  assert.equal(logger.verbose, true);
  logger.debug(`verbose trace token=${FAKE_KEY}`, { authHeader: `Bearer ${FAKE_KEY}` });

  const records = buffer.records();
  assert.equal(records.length, 1, "debug now emitted");
  const record = records[0]!;
  const serialized = JSON.stringify(record);
  // The load-bearing SD3 assertion: verbose ON, yet the secret is still gone everywhere.
  assert.ok(!serialized.includes(FAKE_KEY), "verbose must NOT leak the secret");
  assert.ok(record.message.includes(REDACTION_PLACEHOLDER));
});
