/**
 * `m365-knowledge` credential kind test (REQ-205 T1.4, T1.6, D4).
 *
 * Proves the new kind is ADDITIVE: it stores/retrieves/clears through the SAME
 * `CredentialService` + in-memory `CredentialStore` fake every other credential test uses
 * (`credential-redaction.test.ts`) — no second mechanism. The raw token must never appear in
 * any log line, thrown error message, or JSON-serialized response/state.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCredentialService, createMemoryStore } from "../../src/credential/index.js";
import {
  M365_KNOWLEDGE_PROVIDER_ID,
  hasM365KnowledgeToken,
  m365KnowledgeAccount,
  removeM365KnowledgeToken,
  resolveM365KnowledgeToken,
  storeM365KnowledgeToken,
} from "../../src/credential/m365-knowledge.js";

const TOKEN = "m365kg-DO-NOT-LEAK-eyJhbGciOiJIUzI1NiJ9.secret";

test("store/retrieve/clear the m365-knowledge kind via the ONE credential store", async () => {
  const logs: string[] = [];
  const service = createCredentialService({ store: createMemoryStore(), log: (l) => logs.push(l) });

  const ref = await storeM365KnowledgeToken(service, TOKEN);
  assert.equal(ref.store, "os");
  assert.equal(ref.account, m365KnowledgeAccount());
  assert.equal(ref.account, "provider:m365-knowledge");

  assert.equal(await hasM365KnowledgeToken(service, ref), true);
  const resolved = await resolveM365KnowledgeToken(service, ref);
  assert.equal(resolved, TOKEN);

  const removed = await removeM365KnowledgeToken(service, ref);
  assert.equal(removed, true);
  assert.equal(await hasM365KnowledgeToken(service, ref), false);

  // No log line (including the internal audit lines) ever contains the raw token.
  for (const line of logs) {
    assert.ok(!line.includes(TOKEN), `log line leaked the token: ${line}`);
  }
});

test("the m365-knowledge kind reuses credentialAccountFor's account convention, not a new namespace", () => {
  assert.equal(M365_KNOWLEDGE_PROVIDER_ID, "m365-knowledge");
  assert.equal(m365KnowledgeAccount(), "provider:m365-knowledge");
});

test("the raw token never appears in a JSON-serialized ref (response body simulation)", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = await storeM365KnowledgeToken(service, TOKEN);
  const serializedResponse = JSON.stringify({ status: "connected", baseUrl: "http://localhost:8080", ref });
  assert.ok(!serializedResponse.includes(TOKEN), "the ref must never carry the raw token");
});

test("the token is registered with the shared scrubber on resolve (defense in depth, SEC-2)", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = await storeM365KnowledgeToken(service, TOKEN);
  await resolveM365KnowledgeToken(service, ref);
  const line = `debug: attaching Authorization: Bearer ${TOKEN}`;
  const scrubbed = service.scrubber.scrub(line);
  assert.ok(!scrubbed.includes(TOKEN), "the shared scrubber must mask the M365 token by value");
});

test("resolving an unknown/removed ref rejects with a secret-free error", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const ref = await storeM365KnowledgeToken(service, TOKEN);
  await removeM365KnowledgeToken(service, ref);
  await assert.rejects(async () => resolveM365KnowledgeToken(service, ref), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.ok(!(err as Error).message.includes(TOKEN));
    return true;
  });
});
