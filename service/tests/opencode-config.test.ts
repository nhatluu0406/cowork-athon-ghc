/**
 * Unit coverage for the non-secret OpenCode project config writer.
 * Regression: bare `skills: string[]` makes OpenCode 1.18.1 reject POST /session (HTTP 400)
 * while /global/health still reports healthy — the packaged "Runtime chưa sẵn sàng" symptom.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildOpencodeConfig } from "../src/runtime/opencode-config.js";

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
