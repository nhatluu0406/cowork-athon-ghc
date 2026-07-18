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

test("MS365 tools are allowed at both permission surfaces (bridge is the real gate)", () => {
  // MS365 mounts unconditionally on main (the CGHC_MS365_ENABLED gate was removed), and the MS365
  // tools are gated by the MS365 bridge (permission card per call), so opencode.json marks them
  // "allow" to avoid a double-prompt from OpenCode's "*":"ask" wildcard.
  const config = buildOpencodeConfig();
  const permission = config["permission"] as Record<string, string>;
  const agent = config["agent"] as { build: { permission: Record<string, string> } };
  // The MS365 tool surface: SharePoint + Outlook + Teams + Planner + Lists + Calendar + OneDrive
  // + Power Automate + people/identity. Lock the count so an accidental add/drop is caught.
  assert.equal(TOOL_NAMES.length, 34);
  for (const name of TOOL_NAMES) {
    assert.equal(permission[name], "allow", `missing top-level allow for ${name}`);
    assert.equal(agent.build.permission[name], "allow", `missing agent.build allow for ${name}`);
  }
  // Wildcard and existing gates stay intact.
  assert.equal(permission["*"], "ask");
  assert.equal(permission.bash, "deny");
  assert.equal(permission.edit, "ask");
});

test("agent web tools are gated with ask, not deny or allow (#29)", () => {
  // "ask" routes OpenCode's permission.asked through the bridge → ToolPermissionProxy (web_access,
  // elevated, SSRF-guarded). "deny" would block them outright (the original bug); "allow" would let
  // the child fetch arbitrary URLs with no gate.
  const config = buildOpencodeConfig();
  const permission = config["permission"] as Record<string, string>;
  const agent = config["agent"] as { build: { permission: Record<string, string> } };
  assert.equal(permission["webfetch"], "ask");
  assert.equal(permission["websearch"], "ask");
  assert.equal(agent.build.permission["webfetch"], "ask");
  assert.equal(agent.build.permission["websearch"], "ask");
});
