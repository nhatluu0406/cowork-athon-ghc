/**
 * Credential reference unit test (CGHC-009 / ADR 0006 AC1, AC3).
 *
 * Proves the handle-only contract: storing a key returns a `CredentialRef`; app state
 * serializes ONLY the ref (never the value); the value is produced ONLY when the ref is
 * resolved at the injection boundary. Exercised for a STANDARD provider and a user-defined
 * CUSTOM (OpenAI-compatible) provider, against the in-memory store fake.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CredentialRef, ProviderCredentialBinding } from "@cowork-ghc/contracts";
import { builtInProviderEnv, customOpenAiCompatibleEnv } from "@cowork-ghc/runtime";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";

const STANDARD_KEY = "sk-standard-DO-NOT-LEAK-abc123";
const CUSTOM_KEY = "cust-secret-DO-NOT-LEAK-xyz789";

test("storing a key returns a handle-only CredentialRef (never the value)", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = await service.store({ providerId: "openai", secret: STANDARD_KEY });

  assert.equal(ref.store, "os");
  assert.equal(ref.account, "provider:openai");
  // The ref object exposes no key material anywhere.
  assert.ok(!JSON.stringify(ref).includes(STANDARD_KEY));
});

test("app state serializes the ref only; the key is not in the persisted snapshot", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = await service.store({ providerId: "openai", secret: STANDARD_KEY });

  // A realistic persisted app-state fragment: provider bindings hold handles only.
  const binding: ProviderCredentialBinding = { providerId: "openai", ref };
  const appState = { providerBindings: [binding], selectedModel: null };
  const serialized = JSON.stringify(appState);

  assert.ok(serialized.includes(ref.account), "ref handle must be persisted");
  assert.ok(!serialized.includes(STANDARD_KEY), "the key value must NOT be persisted");
});

test("resolving the ref yields the value only at the injection boundary", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = await service.store({ providerId: "openai", secret: STANDARD_KEY });

  const injection = await service.resolveInjection(ref, builtInProviderEnv("openai"));
  assert.equal(injection.envVar, "OPENAI_API_KEY");
  assert.equal(injection.value, STANDARD_KEY);
});

test("custom OpenAI-compatible provider: handle-only ref + own env var at the boundary", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const spec = customOpenAiCompatibleEnv({ providerId: "my-llm", envVar: "MY_LLM_API_KEY" });

  const ref: CredentialRef = await service.store({
    providerId: "my-llm",
    secret: CUSTOM_KEY,
  });
  assert.equal(ref.account, "provider:my-llm");

  const appState = { providerBindings: [{ providerId: "my-llm", ref }] };
  assert.ok(!JSON.stringify(appState).includes(CUSTOM_KEY));

  const injection = await service.resolveInjection(ref, spec);
  assert.equal(injection.envVar, "MY_LLM_API_KEY");
  assert.equal(injection.value, CUSTOM_KEY);
});

test("a dangling ref throws CredentialNotFoundError (no value invented)", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  await assert.rejects(
    () => service.resolveInjection({ store: "os", account: "provider:absent" }, builtInProviderEnv("openai")),
    /No credential stored/,
  );
});

test("an empty secret is rejected before anything is stored", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  await assert.rejects(() => service.store({ providerId: "openai", secret: "" }), /non-empty/);
});
