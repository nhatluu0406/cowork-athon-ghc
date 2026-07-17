/**
 * CGHC-019 PR4 — model-selection precedence (default vs per-session override).
 *
 * Proves the single {@link ModelConfigService.activeModelFor} resolver: the DEFAULT governs
 * when a session has no override; a per-session override BEATS the default for THAT session
 * only (another session still resolves to the default). One source of truth — the resolver
 * reads the port's in-memory selection map, with no second store.
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
  type ProviderConnector,
} from "../src/provider/index.js";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

function fakeConnector(): ProviderConnector {
  return { probe: async (_id, _t: ConnectTarget | null) => ({ ok: true }), cancel: async () => {} };
}

function makeService() {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: fakeConnector(),
  });
  const audit = createInMemoryModelAuditSink();
  return { svc: createModelConfigService({ port, audit, now: () => "2026-07-11T00:00:00.000Z" }), audit };
}

const DEFAULT_MODEL: ModelRef = { providerID: "openai", modelID: "gpt-4o" };
const OVERRIDE_MODEL: ModelRef = { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" };

test("PR4: the default governs a session with no override", () => {
  const { svc } = makeService();
  svc.configureModel({ scope: "default", model: DEFAULT_MODEL });
  assert.deepEqual(svc.activeModelFor("s1"), DEFAULT_MODEL);
  // With no sessionId at all the default also governs.
  assert.deepEqual(svc.activeModelFor(), DEFAULT_MODEL);
});

test("PR4: a per-session override beats the default for THAT session only", () => {
  const { svc } = makeService();
  svc.configureModel({ scope: "default", model: DEFAULT_MODEL });
  svc.configureModel({ scope: "session", sessionId: "s1", model: OVERRIDE_MODEL });

  // s1 resolves to its override; s2 (no override) still resolves to the default.
  assert.deepEqual(svc.activeModelFor("s1"), OVERRIDE_MODEL);
  assert.deepEqual(svc.activeModelFor("s2"), DEFAULT_MODEL);
});

test("PR4: activeModelFor returns undefined when neither an override nor a default exists", () => {
  const { svc } = makeService();
  assert.equal(svc.activeModelFor("s1"), undefined);
  assert.equal(svc.activeModelFor(), undefined);
});

test("PR4: the UI-confirm read reports WHICH scope governs", () => {
  const { svc } = makeService();
  svc.configureModel({ scope: "default", model: DEFAULT_MODEL });
  svc.configureModel({ scope: "session", sessionId: "s1", model: OVERRIDE_MODEL });

  const s1 = svc.activeModel("s1");
  assert.equal(s1?.resolvedScope, "session");
  assert.deepEqual(s1?.model, OVERRIDE_MODEL);
  assert.equal(s1?.providerDisplayName, "Anthropic");

  const s2 = svc.activeModel("s2");
  assert.equal(s2?.resolvedScope, "default");
  assert.deepEqual(s2?.model, DEFAULT_MODEL);
});
