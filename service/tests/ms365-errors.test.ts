import { test } from "node:test";
import assert from "node:assert/strict";
import { mapGraphStatus, Ms365Error } from "../src/ms365/ms365-errors.js";

test("401 → auth_expired with reconnect recovery", () => {
  const e = mapGraphStatus(401);
  assert.equal(e.kind, "auth_expired");
  assert.ok(e instanceof Ms365Error);
  assert.match(e.recovery, /kết nối lại|reconnect/i);
});

test("429 parses Retry-After seconds into ms", () => {
  const e = mapGraphStatus(429, "30");
  assert.equal(e.kind, "rate_limited");
  assert.equal(e.retryAfterMs, 30_000);
  assert.equal(e.retryable, true);
});

test("404 → not_found; 500 → graph_error", () => {
  assert.equal(mapGraphStatus(404).kind, "not_found");
  assert.equal(mapGraphStatus(500).kind, "graph_error");
});
