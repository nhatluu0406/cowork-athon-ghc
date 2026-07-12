/**
 * CGHC-028 Wave A2 — LIVE {@link ProviderConnector} adapter over a FAKE OpenCode HTTP server.
 *
 * Proves the bounded reachability `probe` (ok when the child health is up; a mapped `unavailable`
 * error when it is not) and that `cancel` POSTs `/session/{id}/abort` (best-effort, never strands).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpencodeConnector, createOpencodeHttp } from "../src/runtime/index.js";
import { startFakeOpencodeServer, type FakeOpencodeServer } from "./opencode-fake-server.js";

function connectorFor(fake: FakeOpencodeServer) {
  const http = createOpencodeHttp({ baseUrl: () => fake.baseUrl, timeoutMs: 4_000 });
  return createOpencodeConnector({ http });
}

test("probe reports ok when the child health endpoint is up", async () => {
  const fake = await startFakeOpencodeServer();
  try {
    const connector = connectorFor(fake);
    const result = await connector.probe("anthropic", null);
    assert.equal(result.ok, true);
    assert.ok(fake.requests.some((r) => r.path === "/global/health"));
  } finally {
    await fake.close();
  }
});

test("probe reports a mapped unavailable error when the child is unreachable", async () => {
  const fake = await startFakeOpencodeServer();
  try {
    const connector = connectorFor(fake);
    fake.state.healthStatus = 500;
    const result = await connector.probe("anthropic", null);
    assert.equal(result.ok, false);
    assert.equal(result.error?.kind, "unavailable");
    assert.equal(result.error?.retryable, true);
  } finally {
    await fake.close();
  }
});

test("cancel POSTs /session/{id}/abort and swallows a terminal-race non-2xx", async () => {
  const fake = await startFakeOpencodeServer();
  try {
    const connector = connectorFor(fake);
    await connector.cancel({ id: "ses_live_1" });
    assert.ok(
      fake.requests.some((r) => r.method === "POST" && r.path === "/session/ses_live_1/abort"),
      "abort hit the child",
    );

    // A non-2xx abort (the run already ended) must NOT reject — cancel is best-effort.
    fake.state.forceStatus.set("POST /session/ses_live_2/abort", 409);
    await connector.cancel({ id: "ses_live_2" }); // resolves without throwing
  } finally {
    await fake.close();
  }
});
