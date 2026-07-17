/**
 * P7 loopback-bind negative tests (ADR 0003): the service binds loopback only and a
 * non-loopback bind/connection is refused; it never binds 0.0.0.0.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  assertLoopbackHost,
  createService,
  isAllowedHostHeader,
  isLoopbackAddress,
  LoopbackBindError,
  LOOPBACK_HOSTS,
  shouldAcceptConnection,
  startService,
} from "../src/index.js";

/** Raw GET that lets us set an otherwise-forbidden `Host` header (fetch blocks it). */
function rawGet(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("binds an ephemeral loopback port and reports a loopback address", async () => {
  const running = await startService();
  try {
    const { address } = running;
    assert.ok(LOOPBACK_HOSTS.includes(address.host), `host ${address.host} must be loopback`);
    assert.equal(address.host, "127.0.0.1");
    assert.ok(address.port > 0, "an ephemeral port must be assigned");
    assert.ok(isLoopbackAddress(address.host));
    assert.equal(running.baseUrl, `http://127.0.0.1:${address.port}`);
  } finally {
    await running.service.stop();
  }
});

test("refuses a non-loopback bind host (never 0.0.0.0)", () => {
  assert.throws(() => createService({ host: "0.0.0.0" }), LoopbackBindError);
  assert.throws(() => createService({ host: "::" }), LoopbackBindError);
  assert.throws(() => createService({ host: "192.168.1.10" }), LoopbackBindError);
  assert.throws(() => assertLoopbackHost("0.0.0.0"), LoopbackBindError);
  assert.equal(assertLoopbackHost("127.0.0.1"), "127.0.0.1");
  assert.equal(assertLoopbackHost("::1"), "::1");
});

test("connection filter accepts only loopback peers", () => {
  // The decision function used by the server's `connection` handler to destroy any
  // socket whose peer is not loopback (defense in depth over the OS-level bind).
  for (const ok of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.5.5.5"]) {
    assert.equal(shouldAcceptConnection(ok), true, `${ok} should be accepted`);
  }
  for (const bad of ["0.0.0.0", "::", "192.168.1.10", "10.0.0.5", "8.8.8.8", undefined]) {
    assert.equal(shouldAcceptConnection(bad), false, `${bad} should be refused`);
  }
});

test("a foreign Host header is rejected (DNS-rebinding defense)", async () => {
  const running = await startService();
  const { port } = running.address;
  const auth = { authorization: `Bearer ${running.clientToken}` };
  try {
    // Foreign host name -> 403 invalid_host, even with a valid token.
    const foreign = await rawGet(port, "/v1/health", { ...auth, host: "evil.example.com" });
    assert.equal(foreign.status, 403);
    const body = JSON.parse(foreign.body) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "invalid_host");
    // The correct loopback host at the bound port is served.
    const ok = await rawGet(port, "/v1/health", { ...auth, host: `127.0.0.1:${port}` });
    assert.equal(ok.status, 200);
  } finally {
    await running.service.stop();
  }
});

test("isAllowedHostHeader accepts only loopback authorities at the bound port", () => {
  assert.equal(isAllowedHostHeader("127.0.0.1:8080", 8080), true);
  assert.equal(isAllowedHostHeader("localhost:8080", 8080), true);
  assert.equal(isAllowedHostHeader("[::1]:8080", 8080), true);
  assert.equal(isAllowedHostHeader("127.0.0.1", 8080), true); // no port -> name-only match
  assert.equal(isAllowedHostHeader("127.0.0.1:9090", 8080), false); // wrong port
  assert.equal(isAllowedHostHeader("evil.example.com", 8080), false);
  assert.equal(isAllowedHostHeader("evil.example.com:8080", 8080), false);
  assert.equal(isAllowedHostHeader(undefined, 8080), false);
});

test("isLoopbackAddress classifies IPv4/IPv6 loopback forms", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("127.255.255.255"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1%lo0"), true);
  assert.equal(isLoopbackAddress("126.0.0.1"), false);
  assert.equal(isLoopbackAddress("128.0.0.1"), false);
  assert.equal(isLoopbackAddress("0.0.0.0"), false);
  assert.equal(isLoopbackAddress("::ffff:8.8.8.8"), false);
});
