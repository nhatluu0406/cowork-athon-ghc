/**
 * Embedded preview hardening: only loopback http(s) URLs are accepted; anything else is
 * refused before any WebContentsView is created. Verified without launching electron.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isLoopbackHttpUrl } from "../src/preview/preview-url.js";

test("isLoopbackHttpUrl accepts loopback http(s), rejects remote and non-http schemes", () => {
  for (const ok of [
    "http://127.0.0.1:5173",
    "http://localhost:3000/app",
    "https://127.0.0.1:8443/",
    "http://[::1]:9000",
  ]) {
    assert.equal(isLoopbackHttpUrl(ok), true, ok);
  }
  for (const bad of [
    "http://example.com",
    "https://evil.example.com/x",
    "http://169.254.169.254/latest", // cloud metadata
    "http://127.0.0.1.evil.com",
    "file:///c:/secret",
    "ftp://127.0.0.1",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(isLoopbackHttpUrl(bad), false, bad);
  }
});
