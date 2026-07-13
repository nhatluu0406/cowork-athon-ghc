import { test } from "node:test";
import assert from "node:assert/strict";
import { createManualTokenProvider } from "../src/ms365/token-provider.js";
import { createCredentialService } from "../src/credential/index.js";
import { createMemoryStore } from "../src/credential/memory-store.js";

function creds() {
  return createCredentialService({ store: createMemoryStore() });
}

test("connect stores token; getAccessToken returns it; source is manual_token", async () => {
  const { provider, connect } = createManualTokenProvider({ credentials: creds() });
  assert.equal(provider.source, "manual_token");
  assert.equal(await provider.isValid(), false);
  await connect("PASTED-TOKEN");
  assert.equal(await provider.isValid(), true);
  assert.equal(await provider.getAccessToken(), "PASTED-TOKEN");
});

test("clear removes the token", async () => {
  const { provider, connect } = createManualTokenProvider({ credentials: creds() });
  await connect("T");
  await provider.clear();
  assert.equal(await provider.isValid(), false);
});
