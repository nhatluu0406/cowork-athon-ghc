/**
 * Credential router test (CGHC-009 / ADR 0006 AC3; CGHC-002 carry-forward).
 *
 * The credential routes mount on the loopback boundary and are TOKEN-GUARDED (a request
 * without the client token is rejected). A store call carries the secret INBOUND only; the
 * response envelope carries ONLY the `CredentialRef` handle — never the key value.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoundaryAuditEvent } from "../src/index.js";
import { startService } from "../src/index.js";
import {
  createCredentialRouter,
  createCredentialService,
  createMemoryStore,
} from "../src/credential/index.js";

const KEY = "sk-router-DO-NOT-LEAK-42";

test("credential store route requires the token and returns the ref only (no key)", async () => {
  const audits: BoundaryAuditEvent[] = [];
  const service = createCredentialService({ store: createMemoryStore() });
  const running = await startService({
    routers: [createCredentialRouter(service)],
    onAudit: (e) => audits.push(e),
  });
  try {
    // No credential route may opt out of the token guard.
    assert.equal(
      audits.some((e) => e.router === "credential"),
      false,
      "no credential route may be publicUnauthenticated",
    );

    // Missing token -> 401.
    const unauth = await fetch(`${running.baseUrl}/v1/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "openai", secret: KEY }),
    });
    assert.equal(unauth.status, 401);

    // With token -> stored; response holds the handle only.
    const res = await fetch(`${running.baseUrl}/v1/credentials`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ providerId: "openai", secret: KEY }),
    });
    assert.equal(res.status, 201);
    const rawText = await res.text();
    assert.ok(!rawText.includes(KEY), "response body must NOT contain the key");
    const body = JSON.parse(rawText) as {
      ok: boolean;
      data: { ref: { store: string; account: string } };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.ref.store, "os");
    assert.equal(body.data.ref.account, "provider:openai");

    // The key is retrievable ONLY through the service resolution boundary, not the API.
    assert.equal(await service.has(body.data.ref), true);
  } finally {
    await running.service.stop();
  }
});

test("credential delete route requires the token and reports removal", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = await service.store({ providerId: "openai", secret: KEY });
  const running = await startService({ routers: [createCredentialRouter(service)] });
  try {
    const res = await fetch(`${running.baseUrl}/v1/credentials`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { removed: boolean } };
    assert.equal(body.data.removed, true);
    assert.equal(await service.has(ref), false);
  } finally {
    await running.service.stop();
  }
});
