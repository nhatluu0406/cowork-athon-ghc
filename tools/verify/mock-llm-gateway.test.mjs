import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockLlmGateway, redactAuthHeader } from "./mock-llm-gateway.mjs";

test("mock gateway binds loopback and serves models + tool call sequence", async () => {
  const gateway = createMockLlmGateway({
    scripts: [{ kind: "tool_call", toolNames: ["delete"], toolArguments: { filePath: "delete-me.txt" } }],
  });
  const baseUrl = await gateway.start();
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/u);

  const models = await fetch(`${baseUrl}/models`);
  assert.equal(models.status, 200);

  const first = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer sk-test-secret",
    },
    body: JSON.stringify({
      model: "mock-model",
      messages: [{ role: "user", content: "delete file" }],
      tools: [{ type: "function", function: { name: "delete", parameters: {} } }],
      stream: false,
    }),
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.choices[0]?.finish_reason, "tool_calls");

  const second = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mock-model",
      messages: [
        { role: "user", content: "delete file" },
        {
          role: "assistant",
          tool_calls: firstBody.choices[0]?.message?.tool_calls,
        },
        { role: "tool", tool_call_id: "call_mock_1", content: "deleted" },
      ],
      stream: false,
    }),
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.choices[0]?.message?.content, "OK");
  assert.equal(gateway.log.length, 2);
  await gateway.stop();
});

test("mock gateway redacts Authorization in helper", () => {
  const redacted = redactAuthHeader({ Authorization: "Bearer secret", "content-type": "application/json" });
  assert.equal(redacted.Authorization, "[redacted]");
  assert.equal(redacted["content-type"], "application/json");
});

test("mock gateway probe ping does not consume scripted tool sequence", async () => {
  const gateway = createMockLlmGateway({
    scripts: [{ kind: "tool_call", toolNames: ["delete"], toolArguments: { filePath: "x.txt" } }],
  });
  const baseUrl = await gateway.start();
  const probe = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mock-model",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    }),
  });
  assert.equal(probe.status, 200);
  const tool = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mock-model",
      messages: [{ role: "user", content: "delete" }],
      tools: [{ type: "function", function: { name: "delete", parameters: {} } }],
      stream: false,
    }),
  });
  assert.equal(tool.status, 200);
  const toolBody = await tool.json();
  assert.equal(toolBody.choices[0]?.finish_reason, "tool_calls");
  await gateway.stop();
});

test("mock gateway fails on unexpected extra request", async () => {
  const gateway = createMockLlmGateway({ scripts: [{ kind: "final_text", text: "done" }] });
  const baseUrl = await gateway.start();
  const first = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-model", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(first.status, 200);
  const second = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-model", messages: [{ role: "user", content: "again" }] }),
  });
  assert.equal(second.status, 500);
  await gateway.stop();
});
