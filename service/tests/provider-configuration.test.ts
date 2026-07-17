/**
 * Provider configuration unit test (CGHC-010, PR1/PR10 / ADR 0005).
 *
 * Proves: the five targets configure correctly (Anthropic, OpenAI, Google, OpenRouter,
 * and one user-defined OpenAI-compatible endpoint); the public port surface is
 * provider-neutral (no vendor branching leaks into method names); and a credential is
 * REFERENCED by a handle, never embedded in port state. No live provider call is made.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CredentialRef } from "@cowork-ghc/contracts";
import {
  createProviderPort,
  createSsrfPolicy,
  providerEnvSpec,
  PROVIDER_DESCRIPTORS,
  CUSTOM_OPENAI_COMPAT_ID,
  type ConnectTarget,
  type ProviderConnector,
  type ResolvedAddress,
} from "../src/provider/index.js";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 }, // example.com, public
];

function fakeConnector(): ProviderConnector {
  return {
    probe: async (_id, _target: ConnectTarget | null) => ({ ok: true }),
    cancel: async () => {},
  };
}

function makePort() {
  return createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: fakeConnector(),
  });
}

test("exactly the five PR10 targets are offered, all marked not-live-tested", () => {
  const port = makePort();
  const ids = port.list().map((d) => d.id);
  assert.deepEqual(ids, ["anthropic", "openai", "google", "openrouter", CUSTOM_OPENAI_COMPAT_ID]);
  for (const descriptor of port.list()) {
    assert.equal(descriptor.liveTested, false, `${descriptor.id} must be marked not-live-tested`);
  }
});

test("the 5th target is a user-defined OpenAI-compatible endpoint requiring a base_url", () => {
  const custom = makePort().describe(CUSTOM_OPENAI_COMPAT_ID);
  assert.ok(custom, "custom descriptor present");
  assert.equal(custom.authKind, "api_key_custom_header");
  const fieldNames = custom.requiredFields.map((f) => f.name);
  assert.ok(fieldNames.includes("baseUrl"), "custom endpoint requires a base_url");
  assert.ok(fieldNames.includes("envVar"), "custom endpoint requires an env-var name");
});

test("built-in env-var names come from CGHC-001's confirmed map (referenced, not re-declared)", () => {
  assert.equal(providerEnvSpec("anthropic").primaryEnvVar, "ANTHROPIC_API_KEY");
  assert.equal(providerEnvSpec("openai").primaryEnvVar, "OPENAI_API_KEY");
  assert.equal(providerEnvSpec("openrouter").primaryEnvVar, "OPENROUTER_API_KEY");
  assert.equal(providerEnvSpec("google").primaryEnvVar, "GOOGLE_API_KEY");
  // Custom endpoint carries its own user-supplied env-var name (the 5th provider class).
  assert.equal(
    providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, "MY_LLM_API_KEY").primaryEnvVar,
    "MY_LLM_API_KEY",
  );
});

test("configureCredential stores a HANDLE only — no key bytes enter port state", () => {
  const port = makePort();
  const SECRET = "sk-ant-DO-NOT-LEAK-abc123";
  const ref: CredentialRef = { store: "os", account: "provider:anthropic" };
  port.configureCredential("anthropic", ref);

  assert.deepEqual(port.credentialRefFor("anthropic"), ref);
  // Nothing serialized from the port carries a key value.
  const snapshot = JSON.stringify({
    descriptors: port.list(),
    ref: port.credentialRefFor("anthropic"),
  });
  assert.ok(!snapshot.includes(SECRET), "no key bytes in port-derived state");
  assert.ok(snapshot.includes("provider:anthropic"), "the handle is present");
});

test("removeCredential clears the binding", () => {
  const port = makePort();
  port.configureCredential("openai", { store: "os", account: "provider:openai" });
  port.removeCredential("openai");
  assert.equal(port.credentialRefFor("openai"), undefined);
});

test("model selection is provider-neutral: default + per-session, secret-free", () => {
  const port = makePort();
  port.configureModel({ scope: "default", model: { providerID: "openai", modelID: "gpt-4o" } });
  port.configureModel({
    scope: "session",
    sessionId: "s1",
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" },
  });
  assert.deepEqual(port.modelSelection("default"), { providerID: "openai", modelID: "gpt-4o" });
  assert.deepEqual(port.modelSelection("session", "s1"), {
    providerID: "anthropic",
    modelID: "claude-3-5-sonnet-latest",
  });
});

test("a per-session selection without a sessionId is rejected", () => {
  const port = makePort();
  assert.throws(
    () => port.configureModel({ scope: "session", model: { providerID: "openai", modelID: "gpt-4o" } }),
    /sessionId/,
  );
});

test("the public surface is provider-neutral — no vendor name appears in a method key", () => {
  const port = makePort();
  const methodNames = Object.keys(port);
  for (const vendor of ["anthropic", "openai", "google", "openrouter", "gemini", "deepseek"]) {
    assert.ok(
      !methodNames.some((m) => m.toLowerCase().includes(vendor)),
      `no method should encode the vendor '${vendor}'`,
    );
  }
  // Adding a provider is data (a descriptor), not a new branch: the count is the data length.
  assert.equal(port.list().length, PROVIDER_DESCRIPTORS.length);
});

test("guardedConnect passes null for a built-in (runtime uses the vendor default host)", async () => {
  const port = makePort();
  let received: ConnectTarget | null = { url: new URL("https://x"), resolved: [] };
  await port.guardedConnect("openai", async (target) => {
    received = target;
    return undefined;
  });
  assert.equal(received, null);
});
