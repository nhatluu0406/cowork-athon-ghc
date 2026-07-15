import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpencodeConfig, LIVE_SESSION_PERMISSION_POLICY } from "../src/runtime/opencode-config.js";

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

test("no skills config: skill stays blanket-allow and no skills key is emitted", () => {
  const config = buildOpencodeConfig();
  const permission = config["permission"] as Record<string, string>;
  assert.equal(permission.skill, "allow");
  assert.equal(config["skills"], undefined);
});

test("skillsPaths emits the OpenCode 1.18 array-form skills key with absolute roots only", () => {
  const config = buildOpencodeConfig(undefined, {
    skillsPaths: ["C:/ws/.cowork/skills", "C:/ws/team-skills"],
  });
  assert.deepEqual(config["skills"], ["C:/ws/.cowork/skills", "C:/ws/team-skills"]);
  // skillAllow was not provided alongside skillsPaths, so the blanket policy is untouched.
  const permission = config["permission"] as Record<string, string>;
  assert.equal(permission.skill, "allow");
});

test("an empty skillsPaths array omits the skills key entirely (no bare defaults)", () => {
  const config = buildOpencodeConfig(undefined, { skillsPaths: [] });
  assert.equal(config["skills"], undefined);
});

test("skillAllow replaces the blanket skill policy with a deny-by-default per-id allowlist", () => {
  const config = buildOpencodeConfig(undefined, { skillAllow: ["writer", "researcher"] });
  const permission = config["permission"] as { skill: Record<string, string> };
  const agent = config["agent"] as { build: { permission: { skill: Record<string, string> } } };
  assert.deepEqual(permission.skill, { "*": "deny", writer: "allow", researcher: "allow" });
  // The project-level and agent.build-level permission blocks stay mirrored.
  assert.deepEqual(agent.build.permission.skill, permission.skill);
});

test("an empty skillAllow denies every skill (honest: nothing enabled yet, no fallback allow)", () => {
  const config = buildOpencodeConfig(undefined, { skillAllow: [] });
  const permission = config["permission"] as { skill: Record<string, string> };
  assert.deepEqual(permission.skill, { "*": "deny" });
});

test("skillAllow ids are trimmed and blank entries are dropped", () => {
  const config = buildOpencodeConfig(undefined, { skillAllow: ["  writer  ", "", "   "] });
  const permission = config["permission"] as { skill: Record<string, string> };
  assert.deepEqual(permission.skill, { "*": "deny", writer: "allow" });
});

test("skillAllow does not disturb any other permission key from the live-session policy", () => {
  const config = buildOpencodeConfig(undefined, { skillAllow: ["writer"] });
  const permission = config["permission"] as Record<string, unknown>;
  for (const [key, value] of Object.entries(LIVE_SESSION_PERMISSION_POLICY)) {
    if (key === "skill") continue;
    assert.equal(permission[key], value, `unexpected drift on permission.${key}`);
  }
});
