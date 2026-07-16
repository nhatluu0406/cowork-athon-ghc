/**
 * GATE 3 (1): the renderer CSP string is restrictive and loopback-only, and `installCsp`
 * merges the header onto session responses without clobbering existing headers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { RENDERER_CSP, installCsp } from "../src/security/csp.js";

/** Parse the policy into a directive → sources map for precise assertions. */
function parseCsp(policy: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of policy.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const idx = trimmed.indexOf(" ");
    const name = idx === -1 ? trimmed : trimmed.slice(0, idx);
    const value = idx === -1 ? "" : trimmed.slice(idx + 1).trim();
    map.set(name, value);
  }
  return map;
}

test("RENDERER_CSP never allows unsafe-eval, and unsafe-inline ONLY for style-src", () => {
  // unsafe-eval is forbidden everywhere.
  assert.doesNotMatch(RENDERER_CSP, /unsafe-eval/);
  const csp = parseCsp(RENDERER_CSP);
  // The security-critical script directive stays strict — no inline scripts (the real XSS lever).
  assert.equal(csp.get("script-src"), "'self'", "script-src must remain 'self' only");
  assert.ok(
    !(csp.get("script-src") ?? "").includes("unsafe-inline"),
    "script-src must never allow unsafe-inline",
  );
  assert.ok(
    !(csp.get("default-src") ?? "").includes("unsafe-inline"),
    "default-src must never allow unsafe-inline",
  );
  // style-src is the ONLY place unsafe-inline is permitted — required by Chromium's built-in PDF
  // viewer (PDFium) whose inline layout styles would otherwise be refused, blanking the preview.
  assert.match(csp.get("style-src") ?? "", /unsafe-inline/, "style-src must allow unsafe-inline for PDFium");
});

test("RENDERER_CSP sets the required restrictive directives", () => {
  const csp = parseCsp(RENDERER_CSP);
  assert.equal(csp.get("default-src"), "'self'");
  assert.equal(csp.get("script-src"), "'self'");
  assert.equal(csp.get("style-src"), "'self' 'unsafe-inline'");
  assert.equal(csp.get("object-src"), "'none'");
  assert.equal(csp.get("base-uri"), "'none'");
  assert.equal(csp.get("frame-ancestors"), "'none'");
  assert.equal(csp.get("form-action"), "'none'");
  assert.equal(csp.get("frame-src"), "blob:");
});

test("RENDERER_CSP connect-src is loopback-only — not '*' and no public origin", () => {
  const connect = parseCsp(RENDERER_CSP).get("connect-src");
  assert.ok(connect, "connect-src directive must be present");
  const sources = connect.split(/\s+/);

  // Never a wildcard.
  assert.ok(!sources.includes("*"), `connect-src must not allow '*': ${connect}`);

  // Every non-'self' source must be an IPv4 loopback (127.0.0.1 / localhost) authority over
  // http or ws only. Nothing public, no https to the internet.
  for (const src of sources) {
    if (src === "'self'") continue;
    assert.match(
      src,
      /^(http|ws):\/\/(127\.0\.0\.1|localhost):\*$/,
      `connect-src source is not loopback-only: ${src}`,
    );
  }

  // The bracketed IPv6 literal `[::1]:*` MUST NOT reappear: Chromium rejects it as an invalid
  // source (a per-launch console error) and the service binds IPv4 `127.0.0.1` only, so it is
  // pure noise. This guards against a silent reintroduction.
  assert.ok(!connect.includes("[::1]"), `connect-src must not contain the invalid [::1] source: ${connect}`);
});

test("installCsp merges the CSP header without clobbering other headers", () => {
  let captured: ((details: unknown, cb: (r: unknown) => void) => void) | undefined;
  const fakeSession = {
    webRequest: {
      onHeadersReceived(cb: (details: unknown, callback: (r: unknown) => void) => void) {
        captured = cb;
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  installCsp(fakeSession as any);
  assert.ok(captured, "installCsp must register an onHeadersReceived listener");

  let result: { responseHeaders?: Record<string, unknown> } | undefined;
  captured(
    { url: "app://cowork/index.html", responseHeaders: { "X-Existing": ["keep-me"] } },
    (r) => {
      result = r as typeof result;
    },
  );

  assert.deepEqual(result?.responseHeaders?.["Content-Security-Policy"], [RENDERER_CSP]);
  assert.deepEqual(result?.responseHeaders?.["X-Existing"], ["keep-me"]);
});

test("installCsp does NOT override the built-in PDF viewer's chrome-extension CSP", () => {
  let captured: ((details: unknown, cb: (r: unknown) => void) => void) | undefined;
  const fakeSession = {
    webRequest: {
      onHeadersReceived(cb: (details: unknown, callback: (r: unknown) => void) => void) {
        captured = cb;
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  installCsp(fakeSession as any);
  assert.ok(captured);

  // A chrome-extension:// response (Chromium's PDFium viewer) keeps its own CSP untouched.
  let extResult: { responseHeaders?: Record<string, unknown> } | undefined;
  captured(
    {
      url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html",
      responseHeaders: { "Content-Security-Policy": ["extension-own-policy"] },
    },
    (r) => {
      extResult = r as typeof extResult;
    },
  );
  assert.deepEqual(
    extResult?.responseHeaders?.["Content-Security-Policy"],
    ["extension-own-policy"],
    "the PDF viewer extension CSP must be left as-is",
  );

  // An app:// response still gets the renderer CSP stamped.
  let appResult: { responseHeaders?: Record<string, unknown> } | undefined;
  captured({ url: "app://cowork/index.html", responseHeaders: {} }, (r) => {
    appResult = r as typeof appResult;
  });
  assert.deepEqual(appResult?.responseHeaders?.["Content-Security-Policy"], [RENDERER_CSP]);
});
