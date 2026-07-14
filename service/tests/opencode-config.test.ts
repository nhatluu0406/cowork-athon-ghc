import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpencodeConfig } from "../src/runtime/opencode-config.js";

test("built-in runtime config explicitly asks for every file edit", () => {
  const config = buildOpencodeConfig();
  const permission = config["permission"] as Record<string, string>;
  const agent = config["agent"] as { build: { permission: Record<string, string> } };
  assert.equal(permission.edit, "ask");
  assert.equal(agent.build.permission.edit, "ask");
  assert.equal(permission.read, "allow");
  assert.equal(permission.bash, "deny");
  assert.equal(config["tools"], undefined, "legacy tool flags must not auto-allow mutations");
});

test("custom provider config remains secret-free and uses the same permission policy", () => {
  const config = buildOpencodeConfig({
    providerId: "custom-openai-compat",
    displayName: "Demo",
    envVar: "DEMO_API_KEY",
    models: ["demo-model"],
    baseUrl: "https://8.8.8.8/v1",
  });
  const text = JSON.stringify(config);
  assert.match(text, /\{env:DEMO_API_KEY\}/);
  assert.doesNotMatch(text, /sk-|Bearer|Authorization/i);
  const permission = config["permission"] as Record<string, string>;
  assert.equal(permission.edit, "ask");
});
