/**
 * CGHC-019 review LOW-1 — clear a per-session model override so the session reverts to the
 * global default. Proves the carry-forward capability end to end through the single source
 * of truth (the ProviderPort selection store): set a session override, clear it, and assert
 * `activeModelFor(session)` falls back to the default. Also proves `clearModel` on the port
 * enforces the sessionId rule and reports whether a selection existed.
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
  return { port, audit, svc: createModelConfigService({ port, audit, now: () => "2026-07-11T00:00:00.000Z" }) };
}

const DEFAULT_MODEL: ModelRef = { providerID: "openai", modelID: "gpt-4o" };
const OVERRIDE_MODEL: ModelRef = { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" };

test("LOW-1: clearing a session override reverts the session to the default", () => {
  const { svc } = makeService();
  svc.configureModel({ scope: "default", model: DEFAULT_MODEL });
  svc.configureModel({ scope: "session", sessionId: "s1", model: OVERRIDE_MODEL });
  assert.deepEqual(svc.activeModelFor("s1"), OVERRIDE_MODEL, "override governs before clear");

  const cleared = svc.clearSessionModel("s1");
  assert.equal(cleared, true, "clear reports an override existed");

  // The load-bearing assertion: the session now resolves to the global default.
  assert.deepEqual(svc.activeModelFor("s1"), DEFAULT_MODEL);
  assert.equal(svc.activeModel("s1")?.resolvedScope, "default", "scope reverts to default");
});

test("LOW-1: clearing a session with no override is a no-op (no audit noise)", () => {
  const { svc, audit } = makeService();
  svc.configureModel({ scope: "default", model: DEFAULT_MODEL });
  const before = audit.size();
  assert.equal(svc.clearSessionModel("ghost"), false);
  assert.equal(audit.size(), before, "no audit event recorded for a no-op clear");
  assert.deepEqual(svc.activeModelFor("ghost"), DEFAULT_MODEL);
});

test("LOW-1: the revert is audited as previous override → default", () => {
  const { svc, audit } = makeService();
  svc.configureModel({ scope: "default", model: DEFAULT_MODEL });
  svc.configureModel({ scope: "session", sessionId: "s1", model: OVERRIDE_MODEL });
  const baseline = audit.size();

  svc.clearSessionModel("s1");
  assert.equal(audit.size(), baseline + 1, "one audit event for the revert");
  const last = audit.events().at(-1);
  assert.equal(last?.scope, "session");
  assert.equal(last?.sessionId, "s1");
  assert.deepEqual(last?.previous, OVERRIDE_MODEL);
  assert.deepEqual(last?.next, DEFAULT_MODEL);
});

test("LOW (review): clearing an override with NO default configured audits the revert-to-nothing (next: null)", () => {
  const { svc, audit } = makeService();
  // No global default is set — only a session override exists.
  svc.configureModel({ scope: "session", sessionId: "s1", model: OVERRIDE_MODEL });
  assert.deepEqual(svc.activeModelFor("s1"), OVERRIDE_MODEL);
  const baseline = audit.size();

  const cleared = svc.clearSessionModel("s1");
  assert.equal(cleared, true);
  // The session now resolves to NOTHING — a real state change that must be audited.
  assert.equal(svc.activeModelFor("s1"), undefined, "no default to fall back to");
  assert.equal(audit.size(), baseline + 1, "the revert-to-nothing is recorded (not a silent gap)");
  const last = audit.events().at(-1);
  assert.deepEqual(last?.previous, OVERRIDE_MODEL);
  assert.equal(last?.next, null, "next is null: reverted to no model");
});

test("port.clearModel enforces the sessionId rule and reports existence", () => {
  const { port } = makeService();
  assert.throws(() => port.clearModel("session"), /requires a sessionId/);
  port.configureModel({ scope: "session", sessionId: "s2", model: OVERRIDE_MODEL });
  assert.equal(port.clearModel("session", "s2"), true, "existing override reported true");
  assert.equal(port.clearModel("session", "s2"), false, "already-cleared reported false");
});
