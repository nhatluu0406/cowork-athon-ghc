/**
 * Error mapping / no-leak test (CGHC-002 error-path seam, CGHC-016 audit seam).
 *
 * An error whose message carries a secret VALUE must be scrubbed BEFORE it could reach a
 * client envelope or a log/audit record. Proves the scrub-before-emit helper the boundary
 * `fail()` path and the audit sink will call.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSecretScrubber,
  redactErrorForEmit,
  redactMessageForEmit,
  REDACTION_PLACEHOLDER,
} from "../src/diagnostics/index.js";

const FAKE_KEY = "sk-FAKE-error-path-cafebabe0011223344556677";

test("an Error carrying a secret value is scrubbed before emit", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  // Simulate an upstream error that accidentally embedded the key in its message.
  const err = new Error(`upstream 401: provided key ${FAKE_KEY} was rejected`);

  const clientMessage = redactErrorForEmit(scrubber, err);
  assert.ok(!clientMessage.includes(FAKE_KEY), "secret must not reach the client");
  assert.ok(clientMessage.includes(REDACTION_PLACEHOLDER));
});

test("a thrown string and an unknown throwable are handled without leaking a stack", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);

  assert.ok(!redactErrorForEmit(scrubber, `raw ${FAKE_KEY}`).includes(FAKE_KEY));
  assert.equal(redactErrorForEmit(scrubber, 42), "Unknown error.");
  assert.equal(redactErrorForEmit(scrubber, null), "Unknown error.");

  // Object with a secret-bearing message field.
  const boundaryLike = { code: "internal", message: `token ${FAKE_KEY}` };
  assert.ok(!redactErrorForEmit(scrubber, boundaryLike).includes(FAKE_KEY));
});

test("redactMessageForEmit scrubs a plain boundary message string", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const out = redactMessageForEmit(scrubber, `Host rejected key=${FAKE_KEY}`);
  assert.ok(!out.includes(FAKE_KEY));
});
