/**
 * CGHC-019 PR5 — switching a model takes effect for the NEXT request with NO restart.
 *
 * The selection lives in the port's in-memory map and is read at request time, so a switch is
 * visible on the SAME service instance immediately — the test never re-constructs the service
 * or the port (which is what a "restart" would look like here). A tiny request simulator reads
 * `activeModelFor` at call time to prove the next request picks up the new model; the UI-confirm
 * read (`activeModel`) reflects the switch too.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRef, ResolvedAddress } from "@cowork-ghc/contracts";
import {
  createModelConfigService,
  createInMemoryModelAuditSink,
  createProviderPort,
  createSsrfPolicy,
  type ConnectTarget,
  type ModelConfigService,
  type ProviderConnector,
} from "../src/provider/index.js";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

function fakeConnector(): ProviderConnector {
  return { probe: async (_id, _t: ConnectTarget | null) => ({ ok: true }), cancel: async () => {} };
}

function makeService(): ModelConfigService {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: fakeConnector(),
  });
  return createModelConfigService({
    port,
    audit: createInMemoryModelAuditSink(),
    now: () => "2026-07-11T00:00:00.000Z",
  });
}

const MODEL_A: ModelRef = { providerID: "openai", modelID: "gpt-4o" };
const MODEL_B: ModelRef = { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" };

/** A request reads the ACTIVE model at dispatch time — exactly what the real request path does. */
function simulateRequest(svc: ModelConfigService, sessionId?: string): ModelRef | undefined {
  return svc.activeModelFor(sessionId);
}

test("PR5: changing the DEFAULT takes effect for the next request without a restart", () => {
  const svc = makeService(); // constructed ONCE

  svc.configureModel({ scope: "default", model: MODEL_A });
  assert.deepEqual(simulateRequest(svc), MODEL_A, "first request uses A");

  // Switch on the SAME instance — no re-construction (no restart).
  svc.configureModel({ scope: "default", model: MODEL_B });
  assert.deepEqual(simulateRequest(svc), MODEL_B, "next request uses B, no restart");

  // The UI-confirm read reflects B immediately.
  assert.deepEqual(svc.activeModel()?.model, MODEL_B);
});

test("PR5: changing a PER-SESSION model takes effect for that session's next request", () => {
  const svc = makeService();
  svc.configureModel({ scope: "default", model: MODEL_A });
  svc.configureModel({ scope: "session", sessionId: "s1", model: MODEL_A });
  assert.deepEqual(simulateRequest(svc, "s1"), MODEL_A);

  svc.configureModel({ scope: "session", sessionId: "s1", model: MODEL_B });
  assert.deepEqual(simulateRequest(svc, "s1"), MODEL_B, "s1's next request uses B");
  assert.equal(svc.activeModel("s1")?.resolvedScope, "session");

  // A different session is unaffected and still uses the default.
  assert.deepEqual(simulateRequest(svc, "s2"), MODEL_A);
});
