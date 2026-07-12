/**
 * Service provider readiness gate tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { assessProviderReadiness } from "../src/diagnostics/provider-readiness.js";

const store = {
  defaultModel: () => ({ providerID: "custom-openai-compat", modelID: "deepseek-chat" }),
  listProviderSettings: () => [
    {
      providerId: "custom-openai-compat",
      credentialRef: { store: "keyring", account: "acct" },
      baseUrl: "https://api.example.com/v1",
    },
  ],
};

test("assessProviderReadiness passes with credential", () => {
  const result = assessProviderReadiness(store);
  assert.equal(result.ok, true);
});

test("assessProviderReadiness blocks missing credential", () => {
  const result = assessProviderReadiness({
    ...store,
    listProviderSettings: () => [
      { providerId: "custom-openai-compat", baseUrl: "https://api.example.com/v1" },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "credential_missing");
});
