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

test("403 maps to insufficient_scope (NOT auth_expired) with consent recovery", () => {
  const err = mapGraphStatus(403);
  assert.equal(err.kind, "insufficient_scope");
  assert.equal(err.retryable, false);
  assert.match(err.recovery, /quyền|scope/i);
  assert.ok(!/kết nối lại/i.test(err.recovery), "403 must not tell the user to reconnect");
});

test("401 still maps to auth_expired with reconnect recovery", () => {
  const err = mapGraphStatus(401);
  assert.equal(err.kind, "auth_expired");
  assert.match(err.recovery, /kết nối lại/i);
});

test("412 maps to precondition_failed with re-read-etag recovery", () => {
  const err = mapGraphStatus(412);
  assert.equal(err.kind, "precondition_failed");
  assert.equal(err.retryable, false);
  assert.match(err.recovery, /etag/i);
});
