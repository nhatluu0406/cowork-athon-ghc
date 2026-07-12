/**
 * Node 24+ passes `{ all: true }` to custom `lookup`; the dialer must answer with an array.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpsDialer } from "../src/provider/http-dialer.js";

test("pinned dialer works when lookup is invoked with all:true (Node 24+)", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  const dialer = createHttpsDialer();
  try {
    const response = await dialer({
      url: new URL(`http://127.0.0.1:${port}/probe`),
      ip: "127.0.0.1",
      family: 4,
      headers: {},
      timeoutMs: 5000,
    });
    assert.equal(response.status, 204);
    assert.equal(response.dialedIp, "127.0.0.1");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
