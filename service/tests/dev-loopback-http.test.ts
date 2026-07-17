/**
 * Developer-only loopback-http override helper (CGHC-010 follow-up). Pure, env-only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readDevLoopbackHttpEscape,
  DEV_LOOPBACK_HTTP_ENV_KEY,
} from "../src/provider/dev-loopback-http.js";

test("readDevLoopbackHttpEscape: '1' is truthy", () => {
  assert.equal(readDevLoopbackHttpEscape({ [DEV_LOOPBACK_HTTP_ENV_KEY]: "1" }), true);
});

test("readDevLoopbackHttpEscape: 'true' is truthy", () => {
  assert.equal(readDevLoopbackHttpEscape({ [DEV_LOOPBACK_HTTP_ENV_KEY]: "true" }), true);
});

test("readDevLoopbackHttpEscape: unset is OFF", () => {
  assert.equal(readDevLoopbackHttpEscape({}), false);
});

test("readDevLoopbackHttpEscape: empty string is OFF", () => {
  assert.equal(readDevLoopbackHttpEscape({ [DEV_LOOPBACK_HTTP_ENV_KEY]: "" }), false);
});

test("readDevLoopbackHttpEscape: '0' is OFF", () => {
  assert.equal(readDevLoopbackHttpEscape({ [DEV_LOOPBACK_HTTP_ENV_KEY]: "0" }), false);
});

test("readDevLoopbackHttpEscape: 'false' is OFF", () => {
  assert.equal(readDevLoopbackHttpEscape({ [DEV_LOOPBACK_HTTP_ENV_KEY]: "false" }), false);
});

test("readDevLoopbackHttpEscape: default reads process.env (no crash, no throw)", () => {
  assert.equal(typeof readDevLoopbackHttpEscape(), "boolean");
});
