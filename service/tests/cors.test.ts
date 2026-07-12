/**
 * Tightly-scoped CORS for the packaged renderer (first-run onboarding fix).
 *
 * The loopback service must let the app's OWN renderer origin (`app://cowork`) call it cross-origin
 * — otherwise the browser blocks the `fetch` and onboarding never loads — WITHOUT becoming a
 * permissive CORS server: only an EXACT allowlisted origin is echoed (never `*`, never reflected),
 * an absent Origin (Node/test clients) gets no CORS header, and the preflight is answered.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { startService } from "../src/index.js";

const APP_ORIGIN = "app://cowork";

function rawRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("preflight OPTIONS from the allowed origin → 204 with the exact origin echoed (never *)", async () => {
  const running = await startService({ allowedOrigins: [APP_ORIGIN] });
  try {
    const { status, headers } = await rawRequest(running.address.port, "OPTIONS", "/v1/session", {
      Origin: APP_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
    });
    assert.equal(status, 204);
    assert.equal(headers["access-control-allow-origin"], APP_ORIGIN);
    assert.notEqual(headers["access-control-allow-origin"], "*");
    assert.match(String(headers["access-control-allow-headers"]), /authorization/i);
    assert.match(String(headers["access-control-allow-methods"]), /POST/);
  } finally {
    await running.service.stop();
  }
});

test("preflight OPTIONS from a DISALLOWED origin → 403 with no CORS header", async () => {
  const running = await startService({ allowedOrigins: [APP_ORIGIN] });
  try {
    const { status, headers } = await rawRequest(running.address.port, "OPTIONS", "/v1/session", {
      Origin: "https://evil.example",
      "access-control-request-method": "POST",
    });
    assert.equal(status, 403);
    assert.equal(headers["access-control-allow-origin"], undefined);
  } finally {
    await running.service.stop();
  }
});

test("a real request from the allowed origin carries the scoped ACAO header", async () => {
  const running = await startService({ allowedOrigins: [APP_ORIGIN] });
  try {
    const { headers } = await rawRequest(running.address.port, "GET", "/v1/health", {
      Origin: APP_ORIGIN,
    });
    assert.equal(headers["access-control-allow-origin"], APP_ORIGIN);
    assert.equal(String(headers["vary"] ?? ""), "Origin");
  } finally {
    await running.service.stop();
  }
});

test("no allowlist configured → no CORS header (CORS is off; the token guard is unaffected)", async () => {
  const running = await startService(); // default: no allowedOrigins
  try {
    const { status, headers } = await rawRequest(running.address.port, "GET", "/v1/health", {
      Origin: APP_ORIGIN,
    });
    assert.equal(headers["access-control-allow-origin"], undefined, "no CORS header without an allowlist");
    // The token guard still runs independently of CORS: a tokenless request is 401, not silently
    // allowed and not CORS-rejected by the server.
    assert.equal(status, 401);
  } finally {
    await running.service.stop();
  }
});
