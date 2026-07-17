/**
 * CGHC-019 P5 — every provider/model change is audited old → new with NO secret.
 *
 * A change records a structured {@link ModelChangeAuditEvent} (scope, optional sessionId,
 * previous → next {@link ModelRef}, timestamp). The realistic leak vector is the bound
 * credential: this test binds a secret-shaped key HANDLE, drives several model changes, then
 * serializes the WHOLE audit trail and asserts the secret never appears — the audit records
 * only the provider id + model id, never the key or the credential account value.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CredentialRef, ModelRef, ResolvedAddress } from "@cowork-ghc/contracts";
import {
  createModelConfigService,
  createInMemoryModelAuditSink,
  createProviderPort,
  createSsrfPolicy,
  type ConnectTarget,
  type ProviderConnector,
} from "../src/provider/index.js";

const SECRET = "sk-ant-DEADBEEF0123456789supersecretkey";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

function fakeConnector(): ProviderConnector {
  return { probe: async (_id, _t: ConnectTarget | null) => ({ ok: true }), cancel: async () => {} };
}

const MODEL_A: ModelRef = { providerID: "openai", modelID: "gpt-4o" };
const MODEL_B: ModelRef = { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" };

test("P5: a model change records old → new and never leaks a secret", () => {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: fakeConnector(),
  });
  // Bind a credential HANDLE whose account is deliberately secret-shaped (worst case).
  const ref: CredentialRef = { store: "os", account: SECRET };
  port.configureCredential("anthropic", ref);

  const audit = createInMemoryModelAuditSink();
  const svc = createModelConfigService({ port, audit, now: () => "2026-07-11T00:00:00.000Z" });

  // First default selection: previous is null (nothing was set before).
  svc.configureModel({ scope: "default", model: MODEL_A });
  // Switch the default: previous should be A, next B.
  svc.configureModel({ scope: "default", model: MODEL_B });
  // A per-session override records its own scope + sessionId.
  svc.configureModel({ scope: "session", sessionId: "s1", model: MODEL_A });

  const events = audit.events();
  assert.equal(events.length, 3, "three real changes are audited");

  assert.deepEqual(events[0], {
    type: "model_selection_changed",
    scope: "default",
    previous: null,
    next: MODEL_A,
    at: "2026-07-11T00:00:00.000Z",
  });
  assert.deepEqual(events[1]?.previous, MODEL_A, "old → new captured (A → B)");
  assert.deepEqual(events[1]?.next, MODEL_B);
  assert.equal(events[2]?.scope, "session");
  assert.equal(events[2]?.sessionId, "s1");

  // The whole trail must never contain the secret-shaped credential value.
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes(SECRET), false, "no secret-shaped value in any audit record");
});

test("P5: a default-scope change with a stray sessionId does NOT record an inconsistent sessionId (review LOW-2)", () => {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: fakeConnector(),
  });
  const audit = createInMemoryModelAuditSink();
  const svc = createModelConfigService({ port, audit, now: () => "2026-07-11T00:00:00.000Z" });

  // Malformed input: a default-scope change is NOT session-specific, so a stray sessionId
  // must not land on the (default-scope) audit event.
  svc.configureModel({ scope: "default", sessionId: "stray", model: MODEL_A });
  const event = audit.events()[0];
  assert.equal(event?.scope, "default");
  assert.equal(event?.sessionId, undefined, "default-scope event carries no sessionId");
});

test("P5: a no-op re-selection of the identical model is not audited", () => {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: fakeConnector(),
  });
  const audit = createInMemoryModelAuditSink();
  const svc = createModelConfigService({ port, audit, now: () => "2026-07-11T00:00:00.000Z" });

  svc.configureModel({ scope: "default", model: MODEL_A });
  svc.configureModel({ scope: "default", model: MODEL_A }); // identical → no new event
  assert.equal(audit.size(), 1, "the identical re-selection is a no-op for the audit trail");
});
