/**
 * Unit coverage for the non-secret OpenCode project config writer.
 * Regression: bare `skills: string[]` makes OpenCode 1.18.1 reject POST /session (HTTP 400)
 * while /global/health still reports healthy — the packaged "Runtime chưa sẵn sàng" symptom.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildOpencodeConfig } from "../src/runtime/opencode-config.js";
import { TOOL_NAMES } from "../src/ms365/ms365-tool-router.js";

test("skillsPaths emit OpenCode skills.paths object (not a bare string array)", () => {
  const cfg = buildOpencodeConfig(undefined, {
    skillsPaths: ["C:\\skills\\builtin", "C:\\skills\\user"],
    skillAllow: [],
  });
  assert.deepEqual(cfg["skills"], {
    paths: ["C:\\skills\\builtin", "C:\\skills\\user"],
  });
  assert.ok(!Array.isArray(cfg["skills"]));
});

test("empty skillsPaths omit the skills key", () => {
  const cfg = buildOpencodeConfig(undefined, { skillsPaths: [], skillAllow: ["docx"] });
  assert.equal(cfg["skills"], undefined);
});

test("skillAllow empty becomes deny-by-default permission.skill map", () => {
  const cfg = buildOpencodeConfig(undefined, {
    skillsPaths: ["C:\\skills"],
    skillAllow: [],
  });
  const permission = cfg["permission"] as Record<string, unknown>;
  assert.deepEqual(permission["skill"], { "*": "deny" });
});

test("skillAllow ids become explicit allow entries", () => {
  const cfg = buildOpencodeConfig(undefined, {
    skillsPaths: ["C:\\skills"],
    skillAllow: ["docx", "pdf"],
  });
  const permission = cfg["permission"] as Record<string, unknown>;
  assert.deepEqual(permission["skill"], {
    "*": "deny",
    docx: "allow",
    pdf: "allow",
  });
});

test("live policy denies OpenCode question tool (no product Question UI yet)", () => {
  const cfg = buildOpencodeConfig();
  const permission = cfg["permission"] as Record<string, unknown>;
  assert.equal(permission["question"], "deny");
  const agent = cfg["agent"] as { build: { permission: Record<string, unknown> } };
  assert.equal(agent.build.permission["question"], "deny");
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
