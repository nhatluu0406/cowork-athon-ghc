/**
 * PHASE 3 — shell openExternal allowlist. Fail-closed: only https:// Microsoft-owned hosts open.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateExternalUrl } from "../src/security/external-url.js";

test("allows https Microsoft sign-in / docs hosts (exact + subdomain)", () => {
  for (const url of [
    "https://developer.microsoft.com/en-us/graph/graph-explorer",
    "https://microsoft.com/devicelogin",
    "https://login.microsoftonline.com/common/oauth2/deviceauth",
    "https://contoso.sharepoint.com/sites/x",
    "https://outlook.office.com/mail",
  ]) {
    assert.equal(evaluateExternalUrl(url).allowed, true, `${url} should be allowed`);
  }
});

test("refuses non-https schemes", () => {
  const d = evaluateExternalUrl("http://microsoft.com/x");
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "not_https");
  assert.equal(evaluateExternalUrl("file:///etc/passwd").allowed, false);
  assert.equal(evaluateExternalUrl("javascript:alert(1)").allowed, false);
});

test("refuses hosts outside the allowlist, including lookalikes", () => {
  for (const url of [
    "https://evil.com/x",
    "https://microsoft.com.evil.com/x",
    "https://notmicrosoft.com/x",
    "https://microsoftxcom/x",
  ]) {
    const d = evaluateExternalUrl(url);
    assert.equal(d.allowed, false, `${url} must be refused`);
    if (!d.allowed) assert.equal(d.reason, "host_not_allowed");
  }
});

test("refuses empty / malformed / non-string input", () => {
  assert.deepEqual(evaluateExternalUrl(""), { allowed: false, reason: "invalid_url" });
  assert.deepEqual(evaluateExternalUrl("   "), { allowed: false, reason: "invalid_url" });
  assert.deepEqual(evaluateExternalUrl("not a url"), { allowed: false, reason: "invalid_url" });
  assert.deepEqual(evaluateExternalUrl(undefined), { allowed: false, reason: "invalid_url" });
});

test("trailing-dot host cannot bypass the allowlist check either way", () => {
  // A trailing dot resolves to the same host; normalize so it neither bypasses nor breaks allow.
  assert.equal(evaluateExternalUrl("https://microsoft.com./x").allowed, true);
});

test("userinfo / fragment tricks resolve to the real host (no bypass)", () => {
  // The real host is what after the last '@' — the URL parser resolves these correctly.
  assert.equal(evaluateExternalUrl("https://microsoft.com@evil.com/x").allowed, false);
  assert.equal(evaluateExternalUrl("https://evil.com#@microsoft.com/x").allowed, false);
  // ...and an allowlisted host with userinfo is still allowed (host is what matters).
  assert.equal(evaluateExternalUrl("https://evil.com@login.microsoftonline.com/x").allowed, true);
});

test("IDN/punycode lookalikes fail closed (ASCII suffix list, no homograph match)", () => {
  // A punycode host that renders like "microsoft" is not the ASCII allowlisted host → refused.
  assert.equal(evaluateExternalUrl("https://xn--microsoft-xyz.com/x").allowed, false);
  assert.equal(evaluateExternalUrl("https://microsoft.com.xn--evil-xyz.com/x").allowed, false);
});
