/**
 * GATE 1: the strict CSP is delivered as a REAL response header on the served document,
 * not just a meta tag. The renderer is served over the custom `app://` protocol whose
 * handler attaches the CSP header deterministically on every Response. These tests prove
 * the handler fires and stamps the full directive set, and that the path-traversal guard
 * refuses escapes. Also asserts the privileged-scheme + handler registrations.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APP_INDEX_URL,
  APP_ORIGIN,
  APP_SCHEME,
  createAppProtocolHandler,
  installAppProtocol,
  registerAppScheme,
} from "../src/security/app-protocol.js";
import { RENDERER_CSP } from "../src/security/csp.js";

const RENDERER_DIR = "/renderer/dist";
const okReader = { readFile: async () => new TextEncoder().encode("<!doctype html>") };

test("served document carries the full CSP as a real response header (GATE 1)", async () => {
  const handler = createAppProtocolHandler(RENDERER_DIR, okReader);
  const response = await handler({ url: APP_INDEX_URL });

  assert.equal(response.status, 200);
  const header = response.headers.get("content-security-policy");
  assert.equal(header, RENDERER_CSP, "CSP response header must equal RENDERER_CSP exactly");
  // The two directives the scaffold review flagged as missing from the meta tag.
  assert.match(header ?? "", /frame-ancestors 'none'/);
  assert.match(header ?? "", /form-action 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
});

test("root path resolves to index.html and still carries the CSP", async () => {
  const handler = createAppProtocolHandler(RENDERER_DIR, okReader);
  const response = await handler({ url: `${APP_ORIGIN}/` });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-security-policy"), RENDERER_CSP);
});

test("known asset extensions get the right content-type plus the CSP", async () => {
  const handler = createAppProtocolHandler(RENDERER_DIR, {
    readFile: async () => new TextEncoder().encode("console.log(1)"),
  });
  const response = await handler({ url: `${APP_ORIGIN}/assets/app.js` });
  assert.match(response.headers.get("content-type") ?? "", /text\/javascript/);
  assert.equal(response.headers.get("content-security-policy"), RENDERER_CSP);
});

test("percent-encoded path traversal outside the renderer dir is denied (403)", async () => {
  const seen: string[] = [];
  const handler = createAppProtocolHandler(RENDERER_DIR, {
    readFile: async (p) => {
      seen.push(p);
      return new Uint8Array();
    },
  });
  // The whole segment "%2e%2e%2f%2e%2e%2fsecret" is not a dot-segment to the URL parser
  // (the "/" is percent-encoded as %2f), so it survives parsing and only decodes to
  // "../../secret" inside the handler — exactly the escape the guard must catch. A raw
  // "/../.." is clamped to the root by the URL parser and never reaches the guard.
  const response = await handler({ url: `${APP_ORIGIN}/%2e%2e%2f%2e%2e%2fsecret` });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("content-security-policy"), RENDERER_CSP);
  assert.deepEqual(seen, [], "a traversal request must never reach the filesystem reader");
});

test("a missing file yields 404 (still carrying the CSP header)", async () => {
  const handler = createAppProtocolHandler(RENDERER_DIR, {
    readFile: async () => {
      throw new Error("ENOENT");
    },
  });
  const response = await handler({ url: `${APP_ORIGIN}/nope.js` });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-security-policy"), RENDERER_CSP);
});

test("registerAppScheme registers app:// as a privileged, secure, standard origin", () => {
  const calls: unknown[] = [];
  registerAppScheme({
    registerSchemesAsPrivileged: (schemes) => {
      calls.push(schemes);
    },
  });
  assert.equal(calls.length, 1);
  const [schemes] = calls as [Array<{ scheme: string; privileges?: Record<string, unknown> }>];
  const entry = schemes.find((s) => s.scheme === APP_SCHEME);
  assert.ok(entry, "app scheme must be registered");
  assert.equal(entry.privileges?.standard, true);
  assert.equal(entry.privileges?.secure, true);
  assert.equal(entry.privileges?.allowServiceWorkers, false);
});

test("installAppProtocol wires a handler onto the app:// scheme", () => {
  const handled: string[] = [];
  installAppProtocol(
    {
      handle: (scheme: string) => {
        handled.push(scheme);
      },
    },
    RENDERER_DIR,
    okReader,
  );
  assert.deepEqual(handled, [APP_SCHEME]);
});
