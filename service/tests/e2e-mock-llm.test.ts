import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readE2eMockLlmBaseUrl,
  isE2eMockLlmUrl,
  assertLoopbackMockBaseUrl,
} from "../src/provider/e2e-mock-llm.js";

test("readE2eMockLlmBaseUrl allows only loopback http /v1", () => {
  const env = { COWORK_GHC_E2E_MOCK_LLM_BASE_URL: "http://127.0.0.1:9123" };
  assert.equal(readE2eMockLlmBaseUrl(env), "http://127.0.0.1:9123/v1");
  assert.equal(readE2eMockLlmBaseUrl({ COWORK_GHC_E2E_MOCK_LLM_BASE_URL: "https://127.0.0.1/v1" }), undefined);
  assert.equal(readE2eMockLlmBaseUrl({ COWORK_GHC_E2E_MOCK_LLM_BASE_URL: "http://10.0.0.1/v1" }), undefined);
});

test("isE2eMockLlmUrl matches normalized verifier URL only", () => {
  const env = { COWORK_GHC_E2E_MOCK_LLM_BASE_URL: "http://127.0.0.1:9123/v1/" };
  assert.equal(isE2eMockLlmUrl("http://127.0.0.1:9123/v1", env), true);
  assert.equal(isE2eMockLlmUrl("http://127.0.0.1:9124/v1", env), false);
});

test("assertLoopbackMockBaseUrl rejects non-loopback host", () => {
  assert.throws(() => assertLoopbackMockBaseUrl("http://localhost:1/v1"));
});
