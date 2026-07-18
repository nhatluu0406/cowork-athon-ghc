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

test("fetch is fail-closed: empty / schemeless / non-https targets are refused", () => {
  // Empty → missing_target; schemeless (incl. a bare internal host) → scheme_not_https, never
  // silently allowed (security review #29 critical: no fail-open bare-query path for webfetch).
  assert.deepEqual(evaluateWebAccess(""), { allowed: false, reason: "missing_target" });
  assert.deepEqual(evaluateWebAccess("   "), { allowed: false, reason: "missing_target" });
  assert.deepEqual(evaluateWebAccess("127.0.0.1:8080/admin"), { allowed: false, reason: "scheme_not_https" });
  assert.deepEqual(evaluateWebAccess("latest typescript release notes"), {
    allowed: false,
    reason: "scheme_not_https",
  });
});

test("trailing-dot internal hostnames cannot bypass the blocklist", () => {
  // review #29 important: localhost. / metadata.google.internal. resolve like the blocked host.
  assert.deepEqual(evaluateWebAccess("https://localhost./x"), { allowed: false, reason: "internal_hostname" });
  assert.deepEqual(evaluateWebAccess("https://metadata.google.internal./x"), {
    allowed: false,
    reason: "internal_hostname",
  });
});

test("garbage with a scheme but no host is rejected", () => {
  const d = evaluateWebAccess("https://");
  assert.equal(d.allowed, false);
});
