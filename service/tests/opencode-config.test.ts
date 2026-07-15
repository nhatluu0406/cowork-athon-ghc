import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpencodeConfig } from "../src/runtime/opencode-config.js";
import { TOOL_NAMES } from "../src/ms365/ms365-tool-router.js";

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

test("ms365Enabled=false leaves the permission policy unchanged (no MS365 entries)", () => {
  const config = buildOpencodeConfig(undefined, false);
  const permission = config["permission"] as Record<string, string>;
  for (const name of TOOL_NAMES) {
    assert.equal(permission[name], undefined, `unexpected policy entry for ${name}`);
  }
});

test("ms365Enabled=true allows all 25 MS365 tool names at both permission surfaces", () => {
  const config = buildOpencodeConfig(undefined, true);
  const permission = config["permission"] as Record<string, string>;
  const agent = config["agent"] as { build: { permission: Record<string, string> } };
  assert.equal(TOOL_NAMES.length, 25);
  for (const name of TOOL_NAMES) {
    assert.equal(permission[name], "allow", `missing top-level allow for ${name}`);
    assert.equal(agent.build.permission[name], "allow", `missing agent.build allow for ${name}`);
  }
  // Wildcard and existing gates stay intact.
  assert.equal(permission["*"], "ask");
  assert.equal(permission.bash, "deny");
  assert.equal(permission.edit, "ask");
});
