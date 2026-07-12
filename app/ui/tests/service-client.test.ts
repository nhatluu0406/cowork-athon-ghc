/**
 * Service client tests (CGHC-025 FIX-1).
 *
 * Locks the GATE 2 protocol-version guard in {@link createServiceClient}'s envelope unwrap so a
 * future reorder/drop of the check FAILS a test (it was previously proven only by construction).
 * Drives the client with a stubbed global `fetch` returning canned JSON — no real socket:
 *  - a WRONG protocol tag → `ServiceClientError` with `code === "protocol_mismatch"`;
 *  - the CORRECT {@link BOUNDARY_PROTOCOL_VERSION} → resolves and returns `data`;
 *  - an `ok:false` error envelope (correct protocol) → throws the BOUNDARY error code, NOT
 *    `protocol_mismatch` (locking the order: protocol guard is checked before `ok`).
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_PROTOCOL_VERSION, type HealthData } from "@cowork-ghc/contracts";
import { createServiceClient, ServiceClientError } from "../src/service-client.js";

const BASE = "http://127.0.0.1:65535";
const TOKEN = "abcdef0123456789".repeat(4);

const HEALTH: HealthData = {
  status: "ok",
  service: "cowork-ghc-local-service",
  startedAt: "2026-07-11T00:00:00.000Z",
  uptimeMs: 42,
};

/** Stub the global fetch to return a single canned JSON body, restoring it afterwards. */
async function withFetch(body: unknown, run: () => Promise<void>): Promise<void> {
  const prev = globalThis.fetch;
  globalThis.fetch = (async () => ({ json: async () => body }) as unknown as Response) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = prev;
  }
}

test("rejects an envelope carrying the WRONG protocol tag with code protocol_mismatch", async () => {
  // A drifted wire contract: ok:true with a stale protocol tag. Must NOT be trusted.
  const drifted = { protocol: "cghc.boundary.v0", ok: true, data: HEALTH };
  await withFetch(drifted, async () => {
    const client = createServiceClient(BASE, TOKEN);
    await assert.rejects(
      () => client.health(),
      (err: unknown) => {
        assert.ok(err instanceof ServiceClientError, "throws a typed ServiceClientError");
        assert.equal(err.code, "protocol_mismatch", "the drift is flagged as protocol_mismatch");
        return true;
      },
    );
  });
});

test("resolves and returns data for an envelope with the CORRECT protocol", async () => {
  const good = { protocol: BOUNDARY_PROTOCOL_VERSION, ok: true, data: HEALTH };
  await withFetch(good, async () => {
    const client = createServiceClient(BASE, TOKEN);
    const health = await client.health();
    assert.deepEqual(health, HEALTH, "the typed data payload is returned unchanged");
  });
});

test("an ok:false error envelope throws the BOUNDARY error code, not protocol_mismatch", async () => {
  // Correct protocol, but the boundary reports an error: the code must be the boundary code — this
  // locks the ORDER (protocol guard first, then ok) so a reorder that swallows real errors fails.
  const errorEnvelope = {
    protocol: BOUNDARY_PROTOCOL_VERSION,
    ok: false,
    error: { code: "unauthorized", message: "no client token presented" },
  };
  await withFetch(errorEnvelope, async () => {
    const client = createServiceClient(BASE, TOKEN);
    await assert.rejects(
      () => client.health(),
      (err: unknown) => {
        assert.ok(err instanceof ServiceClientError, "throws a typed ServiceClientError");
        assert.equal(err.code, "unauthorized", "the boundary error code is surfaced, not protocol_mismatch");
        return true;
      },
    );
  });
});
