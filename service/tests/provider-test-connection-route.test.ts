/**
 * Provider test-connection route (Slice 3 / CGHC-011).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RouteContext } from "../src/boundary/contract.js";
import {
  createProviderPort,
  createProviderRouter,
  createSsrfPolicy,
  PROVIDER_TEST_CONNECTION_PATH,
  type ProviderConnector,
} from "../src/provider/index.js";
import { createModelConfigService, createInMemoryModelAuditSink } from "../src/provider/index.js";
import { credentialRef } from "../src/credential/index.js";

function connector(result: import("@cowork-ghc/contracts").TestResult): ProviderConnector {
  return { probe: async () => result, cancel: async () => {} };
}

function ctx(body: unknown): RouteContext {
  return { method: "POST", url: new URL(`http://127.0.0.1${PROVIDER_TEST_CONNECTION_PATH}`), params: {}, body };
}

test("POST test-connection returns ok when probe succeeds", async () => {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: async () => [{ address: "93.184.216.34", family: 4 }] }),
    connector: connector({ ok: true }),
  });
  port.configureCredential("openai", credentialRef("provider:openai"));
  const modelConfig = createModelConfigService({ port, audit: createInMemoryModelAuditSink() });
  modelConfig.configureModel({ scope: "default", model: { providerID: "openai", modelID: "gpt-4o" } });
  const router = createProviderRouter(port, modelConfig);
  const route = router.routes.find((r) => r.path === PROVIDER_TEST_CONNECTION_PATH);
  assert.ok(route);
  const result = (await route!.handler(ctx({ providerId: "openai" }))) as {
    data: { result: { ok: boolean } };
  };
  assert.equal(result.data.result.ok, true);
});

test("POST test-connection rejects when no credential is bound", async () => {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: async () => [{ address: "93.184.216.34", family: 4 }] }),
    connector: connector({ ok: true }),
  });
  const router = createProviderRouter(port, createModelConfigService({ port, audit: createInMemoryModelAuditSink() }));
  const route = router.routes.find((r) => r.path === PROVIDER_TEST_CONNECTION_PATH);
  assert.ok(route);
  await assert.rejects(() => route!.handler(ctx({ providerId: "openai" })));
});
