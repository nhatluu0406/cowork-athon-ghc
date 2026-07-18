/**
 * Web-access SSRF guard tests (#29). The permission card is the primary gate; this pre-gate guard
 * refuses statically-internal targets so a user can never be asked to approve an SSRF probe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateWebAccess } from "../src/files/web-access-guard.js";

test("public https URL is allowed", () => {
  const d = evaluateWebAccess("https://example.com/docs?q=1");
  assert.equal(d.allowed, true);
});

test("loopback / private / link-local / metadata literal IPs are blocked", () => {
  for (const [url, reason] of [
    ["https://127.0.0.1/x", "loopback"],
    ["https://10.0.0.5/x", "private"],
    ["https://192.168.1.1/x", "private"],
    ["https://169.254.1.1/x", "link_local"],
    ["https://169.254.169.254/latest/meta-data", "cloud_metadata"],
    ["https://[::1]/x", "loopback"],
  ] as const) {
    const d = evaluateWebAccess(url);
    assert.equal(d.allowed, false, `${url} must be blocked`);
    if (!d.allowed) assert.equal(d.reason, reason, `${url} reason`);
  }
});

test("internal hostnames are blocked without DNS", () => {
  for (const url of ["https://localhost/x", "https://metadata.google.internal/x"]) {
    const d = evaluateWebAccess(url);
    assert.equal(d.allowed, false, `${url} must be blocked`);
  }
});

test("http (plaintext) is refused — only https fetches are allowed", () => {
  const d = evaluateWebAccess("http://example.com/x");
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.reason, "scheme_not_https");
});

test("a bare search query (no scheme/host) is allowed — the card still gates it", () => {
  const d = evaluateWebAccess("latest typescript release notes");
  assert.equal(d.allowed, true);
});

test("garbage with a scheme but no host is rejected", () => {
  const d = evaluateWebAccess("https://");
  assert.equal(d.allowed, false);
});
