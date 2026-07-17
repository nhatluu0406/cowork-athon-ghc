import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OPENCODE_PIN,
  assertPinnedVersion,
  checkPin,
  isPinnedVersion,
  normalizeVersion,
  PinMismatchError,
  runtimeVersionInfo,
} from "../src/pin.js";

test("pin is a single explicit value, not a range", () => {
  assert.equal(OPENCODE_PIN, "v1.18.1");
  assert.ok(!/[\^~*x]/i.test(OPENCODE_PIN), "pin must not be a semver range");
});

test("normalizeVersion strips a single leading v", () => {
  assert.equal(normalizeVersion("v1.18.1"), "1.18.1");
  assert.equal(normalizeVersion("1.18.1"), "1.18.1");
  assert.equal(normalizeVersion("  V1.18.1  "), "1.18.1");
});

test("matching pin passes (with or without leading v)", () => {
  assert.equal(isPinnedVersion("v1.18.1"), true);
  assert.equal(isPinnedVersion("1.18.1"), true, "health reports bare version");
  assert.equal(checkPin("1.18.1").ok, true);
  assert.doesNotThrow(() => assertPinnedVersion("v1.18.1"));
});

test("version-mismatch against the pin is detected", () => {
  assert.equal(isPinnedVersion("v1.18.0"), false);
  assert.equal(isPinnedVersion("1.17.11"), false);
  const result = checkPin("1.17.11");
  assert.deepEqual(result, { ok: false, expected: "v1.18.1", actual: "1.17.11" });
});

test("assertPinnedVersion throws PinMismatchError on mismatch, carrying expected+actual", () => {
  let caught: unknown;
  try {
    assertPinnedVersion("v2.0.0");
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof PinMismatchError);
  assert.equal(caught.expected, "v1.18.1");
  assert.equal(caught.actual, "v2.0.0");
  assert.match(caught.message, /expected pin v1\.18\.1, got v2\.0\.0/);
});

test("runtimeVersionInfo surfaces the pin (SD7)", () => {
  assert.deepEqual(runtimeVersionInfo(), { runtimePin: "v1.18.1" });
});
