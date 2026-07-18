/**
 * #38 — the Gateway is an API-key routing proxy, not a prompt logger. It must parse only the
 * non-sensitive model id from a request body and NEVER surface the user's prompt text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatCompletionRequest } from "../src/gateway/prompt-extract.js";

test("gateway request parsing returns the model id and nothing about the prompt", () => {
  const raw = JSON.stringify({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "you are helpful" },
      { role: "user", content: "my secret prompt: transfer 123-456-7890" },
    ],
  });
  const parsed = parseChatCompletionRequest(raw) as Record<string, unknown>;
  assert.equal(parsed["modelId"], "deepseek-chat");
  // No prompt content is extracted under any key.
  assert.equal("promptPreview" in parsed, false);
  assert.deepEqual(Object.keys(parsed), ["modelId"]);
});

test("gateway request parsing never throws on a non-JSON / bodyless request", () => {
  assert.deepEqual(parseChatCompletionRequest("not json"), {});
  assert.deepEqual(parseChatCompletionRequest("{}"), {});
});
