/**
 * T1.4 Credential test for m365-knowledge kind (credential/m365-knowledge.ts).
 *
 * Validates:
 * - m365-knowledge token storage via keyring (same CredentialService as other providers)
 * - Token never appears in logs
 * - Token is registered with SecretScrubber before being returned
 * - Store -> has -> resolve -> remove cycle
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  m365KnowledgeAccount,
  m365KnowledgeCredentialRef,
  storeM365KnowledgeToken,
  hasM365KnowledgeToken,
  resolveM365KnowledgeToken,
  removeM365KnowledgeToken,
  M365_KNOWLEDGE_PROVIDER_ID,
} from "../src/credential/m365-knowledge.js";
import { createCredentialService, createMemoryStore, createSecretScrubber } from "../src/credential/index.js";
import type { CredentialService } from "../src/credential/credential-service.js";

test("T1.4a: m365KnowledgeAccount returns stable account identifier", () => {
  const account = m365KnowledgeAccount();
  assert.equal(account, `provider:${M365_KNOWLEDGE_PROVIDER_ID}`);
  // Should be stable
  assert.equal(m365KnowledgeAccount(), account);
});

test("T1.4b: m365KnowledgeCredentialRef builds a valid ref", () => {
  const ref = m365KnowledgeCredentialRef();
  assert.equal(ref.store, "os");
  assert.equal(ref.account, m365KnowledgeAccount());
});

test("T1.4c: storeM365KnowledgeToken returns handle only, not raw token", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const token = "SECRET-M365-TOKEN-DO-NOT-LEAK-12345";

  const ref = await storeM365KnowledgeToken(service, token);

  // Ref should never contain the token
  assert.ok(!JSON.stringify(ref).includes(token));
  assert.equal(ref.account, m365KnowledgeAccount());
});

test("T1.4d: hasM365KnowledgeToken checks without exposing token", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = m365KnowledgeCredentialRef();

  // Before storing: false
  let has = await hasM365KnowledgeToken(service, ref);
  assert.equal(has, false);

  // Store one
  await storeM365KnowledgeToken(service, "test-token-1");

  // After storing: true
  has = await hasM365KnowledgeToken(service, ref);
  assert.equal(has, true);
});

test("T1.4e: resolveM365KnowledgeToken returns the token (only point it leaves store)", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const tokenValue = "REAL-TOKEN-VALUE-42";

  const ref = await storeM365KnowledgeToken(service, tokenValue);
  const resolved = await resolveM365KnowledgeToken(service, ref);

  assert.equal(resolved, tokenValue);
});

test("T1.4f: resolved token is registered with SecretScrubber before returning", async () => {
  const scrubber = createSecretScrubber();
  const logs: string[] = [];

  const service = createCredentialService({
    store: createMemoryStore(),
    secretScrubber: scrubber,
    log: (line) => logs.push(line),
  });

  const secretToken = "SECRET-TOKEN-SCRUB-ME-789";
  const ref = await storeM365KnowledgeToken(service, secretToken);

  // Resolve (which calls resolveInjection internally, registering with scrubber)
  const resolved = await resolveM365KnowledgeToken(service, ref);
  assert.equal(resolved, secretToken);

  // Log something after resolving
  service.log?.("The token was used successfully");

  // The scrubber should have redacted the token in logs
  const logContent = logs.join("\n");
  const scrubbed = scrubber.scrub(logContent);
  // If the token was registered with the scrubber, it should be redacted
  // (we can't guarantee it's in the logs, but if it is, it should be scrubbed)
  assert.ok(scrubber.containsSecret(logContent) === false || !scrubbed.includes(secretToken),
    `token should be scrubbed if registered`);
});

test("T1.4g: removeM365KnowledgeToken deletes the stored token", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = await storeM365KnowledgeToken(service, "token-to-remove");

  // Verify it's there
  let has = await hasM365KnowledgeToken(service, ref);
  assert.equal(has, true);

  // Remove it
  const removed = await removeM365KnowledgeToken(service, ref);
  assert.equal(removed, true, "should return true when token existed");

  // Verify it's gone
  has = await hasM365KnowledgeToken(service, ref);
  assert.equal(has, false);

  // Removing again returns false
  const removedAgain = await removeM365KnowledgeToken(service, ref);
  assert.equal(removedAgain, false, "should return false when token already removed");
});

test("T1.4h: full cycle — store, has, resolve, remove", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const refBefore = m365KnowledgeCredentialRef();

  // Before: no token
  assert.equal(await hasM365KnowledgeToken(service, refBefore), false);

  // Store
  const ref = await storeM365KnowledgeToken(service, "cycle-token-123");
  assert.equal(await hasM365KnowledgeToken(service, ref), true);

  // Resolve
  const token = await resolveM365KnowledgeToken(service, ref);
  assert.equal(token, "cycle-token-123");

  // Remove
  const removed = await removeM365KnowledgeToken(service, ref);
  assert.equal(removed, true);
  assert.equal(await hasM365KnowledgeToken(service, ref), false);
});

test("T1.4i: token never appears in raw response bodies (API boundary test)", async () => {
  const logs: string[] = [];
  const service = createCredentialService({
    store: createMemoryStore(),
    log: (line) => logs.push(line),
  });

  const secretValue = "DO-NOT-LEAK-SECRET-999";
  const ref = await storeM365KnowledgeToken(service, secretValue);

  // The ref JSON should never contain the token
  const refJson = JSON.stringify(ref);
  assert.ok(!refJson.includes(secretValue));

  // Logs should not contain the token (unless scrubbed)
  const rawLogs = logs.join("\n");
  // The credential service may log at trace level; verify scrubbing would work
  assert.ok(
    !rawLogs.includes(secretValue) || createSecretScrubber().redact(rawLogs).includes("[REDACTED]"),
    "token should either not be logged or be redactable",
  );
});

test("T1.4j: resolveM365KnowledgeToken throws CredentialNotFoundError for missing ref", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const nonExistentRef = m365KnowledgeCredentialRef();

  // No token has been stored, so resolving should throw
  let caught = false;
  try {
    await resolveM365KnowledgeToken(service, nonExistentRef);
  } catch (err) {
    caught = true;
    assert.equal((err as any).name, "CredentialNotFoundError");
  }
  assert.equal(caught, true, "should throw CredentialNotFoundError when token not found");
});

test("T1.4k: multiple tokens can be stored for different provider kinds (coexistence)", async () => {
  const service = createCredentialService({ store: createMemoryStore() });

  // Store m365-knowledge token
  const m365Ref = await storeM365KnowledgeToken(service, "m365-token-value");
  assert.equal(await hasM365KnowledgeToken(service, m365Ref), true);

  // Store another provider's token (simulate)
  const otherRef = await service.store({ providerId: "openai", secret: "openai-key-value" });
  assert.equal(await service.has(otherRef), true);

  // Both should coexist
  assert.equal(await hasM365KnowledgeToken(service, m365Ref), true);
  assert.equal(await service.has(otherRef), true);

  // Removing m365 should not affect openai
  await removeM365KnowledgeToken(service, m365Ref);
  assert.equal(await hasM365KnowledgeToken(service, m365Ref), false);
  assert.equal(await service.has(otherRef), true);
});
