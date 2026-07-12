/**
 * CGHC-019 PR6 (SHOULD) — provider health/reachability is surfaced but does NOT block a switch.
 *
 * Health reuses the CGHC-011 `testConnection` path through the port, driven by an INJECTED
 * connector (no live network). A reachable provider surfaces `{ ok: true }`; an unreachable one
 * surfaces `{ ok: false, error }`. Crucially, even while a provider is unreachable, switching TO
 * it still succeeds and takes effect — health is a read-only signal, never a gate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRef, ProviderId, ResolvedAddress, TestResult } from "@cowork-ghc/contracts";
import {
  createModelConfigService,
  createInMemoryModelAuditSink,
  createProviderPort,
  createSsrfPolicy,
  type ConnectTarget,
  type ProviderConnector,
} from "../src/provider/index.js";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

/** A connector whose probe outcome is scripted per provider id (deterministic, no network). */
function scriptedConnector(outcomes: Record<string, TestResult>): ProviderConnector {
  return {
    probe: async (id: ProviderId, _t: ConnectTarget | null) =>
      outcomes[id] ?? { ok: false, error: { kind: "unknown", message: "no script", retryable: false, recovery: "" } },
    cancel: async () => {},
  };
}

function makeService(outcomes: Record<string, TestResult>) {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: scriptedConnector(outcomes),
  });
  return createModelConfigService({
    port,
    audit: createInMemoryModelAuditSink(),
    now: () => "2026-07-11T00:00:00.000Z",
  });
}

const UNAVAILABLE: TestResult = {
  ok: false,
  error: { kind: "unavailable", message: "unreachable", retryable: true, recovery: "retry later" },
};
const MODEL_UP: ModelRef = { providerID: "openai", modelID: "gpt-4o" };
const MODEL_DOWN: ModelRef = { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" };

test("PR6: reachable vs unreachable is surfaced via checkHealth", async () => {
  const svc = makeService({ openai: { ok: true }, anthropic: UNAVAILABLE });
  assert.deepEqual(await svc.checkHealth("openai"), { ok: true });
  assert.deepEqual((await svc.checkHealth("anthropic")).ok, false);
});

test("PR6: checkActiveHealth probes the provider behind the ACTIVE model", async () => {
  const svc = makeService({ openai: { ok: true }, anthropic: UNAVAILABLE });
  svc.configureModel({ scope: "default", model: MODEL_UP });
  assert.deepEqual(await svc.checkActiveHealth(), { ok: true });

  // With no active model there is nothing to probe.
  const empty = makeService({ openai: { ok: true } });
  assert.equal(await empty.checkActiveHealth("s1"), undefined);
});

test("PR6: a health probe that REJECTS does not corrupt the selection (review LOW-4)", async () => {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: {
      probe: async () => {
        throw new Error("probe blew up");
      },
      cancel: async () => {},
    },
  });
  const svc = createModelConfigService({
    port,
    audit: createInMemoryModelAuditSink(),
    now: () => "2026-07-11T00:00:00.000Z",
  });
  svc.configureModel({ scope: "default", model: MODEL_UP });

  // The probe rejects (not just {ok:false})...
  await assert.rejects(svc.checkActiveHealth(), /probe blew up/);
  // ...but selection is on a separate synchronous path and stays intact.
  assert.deepEqual(svc.activeModelFor(), MODEL_UP);
  assert.equal(svc.activeModel()?.resolvedScope, "default");
});

test("PR6: an unreachable provider does NOT block switching to it", async () => {
  const svc = makeService({ openai: { ok: true }, anthropic: UNAVAILABLE });

  // The target provider is unreachable...
  assert.equal((await svc.checkHealth("anthropic")).ok, false);

  // ...yet the switch still succeeds and takes effect for the next request.
  svc.configureModel({ scope: "session", sessionId: "s1", model: MODEL_DOWN });
  assert.deepEqual(svc.activeModelFor("s1"), MODEL_DOWN, "switch is not gated on health");
  assert.equal(svc.activeModel("s1")?.resolvedScope, "session");
});
