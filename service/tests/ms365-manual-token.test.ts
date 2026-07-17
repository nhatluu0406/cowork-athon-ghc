import { test } from "node:test";
import assert from "node:assert/strict";
import { createManualTokenProvider } from "../src/ms365/token-provider.js";

test("connect stores token; getAccessToken returns it; source is manual_token", async () => {
  const { provider, connect } = createManualTokenProvider();
  assert.equal(provider.source, "manual_token");
  assert.equal(await provider.isValid(), false);
  await connect("PASTED-TOKEN");
  assert.equal(await provider.isValid(), true);
  assert.equal(await provider.getAccessToken(), "PASTED-TOKEN");
});

test("clear removes the token", async () => {
  const { provider, connect } = createManualTokenProvider();
  await connect("T");
  await provider.clear();
  assert.equal(await provider.isValid(), false);
});

test("connect rejects an empty/whitespace token without storing", async () => {
  const { provider, connect } = createManualTokenProvider();
  await assert.rejects(() => connect("   "), /non-empty string/);
  assert.equal(await provider.isValid(), false);
});

test("regression: a large real-size Graph token (>2560 bytes) connects in-memory without a keyring write", async () => {
  // A real Microsoft Graph access token is a JWT of ~2–5 KB, exceeding the Windows Credential
  // Manager blob limit (~2560 bytes). The manual provider must hold it in memory, never persist
  // it to the OS store, so an oversized token connects cleanly instead of throwing on CredWrite.
  const bigToken = "e" + "y".repeat(3032); // ~3033 chars, well over the CredWrite limit
  const { provider, connect } = createManualTokenProvider();
  await connect(bigToken); // must NOT throw
  assert.equal(await provider.isValid(), true);
  assert.equal(await provider.getAccessToken(), bigToken);
});
