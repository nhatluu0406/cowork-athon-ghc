/**
 * CGHC-015 security co-sign — EV error-message redaction (HIGH-S1, HIGH-S2).
 *
 * Proves the mapper choke point redacts secret-looking substrings out of `session.error`
 * messages, so a leaked credential can reach NEITHER the live `ErrorEvent.message` NOR the
 * reducer-derived snapshot (`SessionView.error.message`). Each secret is a POSITIVE CONTROL:
 * the test first asserts the secret IS present in the raw runtime message it feeds in, then
 * asserts it is ABSENT from the mapped event and the folded view. Also asserts a benign
 * message is not over-redacted, that stack frames are dropped, and that an injected custom
 * `redactError` override is actually applied (the seam is real).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import { createEvMapper, foldEv, sanitizeErrorMessage } from "../src/execution/index.js";

const SID = "session-a";
const NOW = () => "2026-07-11T00:00:00.000Z";

/** Map a `session.error` frame carrying `rawMessage` and return [errorEvent, terminal]. */
function mapError(rawMessage: string): readonly EvEvent[] {
  return createEvMapper({ sessionId: SID, now: NOW }).map({
    type: "session.error",
    properties: { sessionID: SID, error: { name: "ProviderError", message: rawMessage } },
  });
}

/** The error event's message after mapping (choke-point output). */
function mappedMessage(rawMessage: string): string {
  const out = mapError(rawMessage);
  const err = out[0] as Extract<EvEvent, { kind: "error" }>;
  assert.equal(err.kind, "error");
  return err.message;
}

/** The reducer-derived snapshot message (proves BOTH stream and snapshot are redacted). */
function snapshotMessage(rawMessage: string): string {
  const view = foldEv(SID, mapError(rawMessage));
  assert.ok(view.error, "snapshot must carry the error");
  return view.error?.message ?? "";
}

// Each case: [label, the secret substring, the full raw runtime message embedding it].
const SECRET_CASES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "64-hex per-launch client token",
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    "Runtime rejected client token a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2 on connect",
  ],
  [
    "access_token=<JWT> (word-boundary bug fix, HIGH-S2)",
    "access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    "Provider handshake failed: access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N was invalid",
  ],
  [
    "GitHub ghp_ token",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "git push denied using ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 (bad credential)",
  ],
  [
    "AWS access key id",
    "AKIA0000000000000000",
    "S3 upload failed with key AKIA0000000000000000 not authorized",
  ],
  [
    "Bearer header with base64/+/= chars",
    "Bearer YWJjZGVm+ghi/jklMNOPqrstuvwxyz0123456789ABCD==",
    "Upstream returned 401 for Authorization: Bearer YWJjZGVm+ghi/jklMNOPqrstuvwxyz0123456789ABCD==",
  ],
];

for (const [label, secret, raw] of SECRET_CASES) {
  test(`redacts ${label} from BOTH the ErrorEvent and the snapshot`, () => {
    assert.ok(raw.includes(secret), "positive control: the secret IS in the raw runtime message");

    const mapped = mappedMessage(raw);
    assert.equal(mapped.includes(secret), false, "secret must not reach the ErrorEvent.message");
    assert.match(mapped, /\[redacted\]/, "the secret is replaced by the fixed placeholder");

    const snap = snapshotMessage(raw);
    assert.equal(snap.includes(secret), false, "secret must not reach the reduced snapshot");
  });
}

test("multi-line stack trace: keeps the first message line, drops all stack frames", () => {
  const raw =
    "Provider auth failed unexpectedly\r\n" +
    "    at Object.<anonymous> (/secret/creds/store.ts:10:5)\r\n" +
    "    at Module._compile (node:internal/modules/cjs/loader:1234:14)";
  assert.ok(raw.includes("at Object.<anonymous>"), "positive control: stack IS in the raw input");

  const mapped = mappedMessage(raw);
  assert.equal(mapped, "Provider auth failed unexpectedly");
  assert.equal(mapped.includes("at Object.<anonymous>"), false, "no stack frame survives");
  assert.equal(mapped.includes("/secret/creds/store.ts"), false, "no stack path survives");
});

test("inline `at file:line:col` frame on the first line is stripped", () => {
  const mapped = mappedMessage("Boom happened at run (/app/x.ts:1:1)");
  assert.equal(mapped, "Boom happened");
});

test("a benign message is NOT over-redacted (no false positives on ordinary words)", () => {
  const benign = "The provider returned an unexpected response and the run stopped.";
  assert.equal(mappedMessage(benign), benign);
  // The sanitizer itself is a pure passthrough for benign text.
  assert.equal(sanitizeErrorMessage(benign), benign);
});

test("the injected redactError override is actually applied at the choke point", () => {
  let called = 0;
  const out = createEvMapper({
    sessionId: SID,
    now: NOW,
    redactError: (msg) => {
      called += 1;
      return `CUSTOM<${msg}>`;
    },
  }).map({
    type: "session.error",
    properties: { sessionID: SID, error: { name: "ProviderError", message: "original" } },
  });
  const err = out[0] as Extract<EvEvent, { kind: "error" }>;
  assert.equal(called, 1, "the override ran exactly once");
  assert.equal(err.message, "CUSTOM<original>", "the override output is used verbatim");
});

test("cancelled terminal message is also routed through the redactor (same untrusted source)", () => {
  let called = 0;
  const out = createEvMapper({
    sessionId: SID,
    now: NOW,
    redactError: (msg) => {
      called += 1;
      return `R<${msg}>`;
    },
  }).map({
    type: "session.error",
    properties: {
      sessionID: SID,
      error: { name: "MessageAbortedError", message: "aborted with token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" },
    },
  });
  const term = out[0] as Extract<EvEvent, { kind: "terminal" }>;
  assert.equal(term.state, "cancelled");
  assert.ok(called >= 1, "the cancelled message is redacted too");
  assert.match(term.message ?? "", /^R</);
});
