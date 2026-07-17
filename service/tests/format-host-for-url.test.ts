import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHostForUrl } from "../src/composition/live-launch.js";

test("formatHostForUrl brackets IPv6 literals", () => {
  assert.equal(formatHostForUrl("::1"), "[::1]");
  assert.equal(formatHostForUrl("fe80::1"), "[fe80::1]");
});

test("formatHostForUrl leaves IPv4 and hostnames unchanged", () => {
  assert.equal(formatHostForUrl("127.0.0.1"), "127.0.0.1");
  assert.equal(formatHostForUrl("localhost"), "localhost");
});

test("formatHostForUrl does not double-bracket an already-bracketed host", () => {
  assert.equal(formatHostForUrl("[::1]"), "[::1]");
});
