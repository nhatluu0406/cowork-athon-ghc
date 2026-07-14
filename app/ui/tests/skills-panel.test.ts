import "./setup-dom.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { mountSkillsPanel } from "../src/skills-panel.js";
import type { ServiceClient, SkillView } from "../src/service-client.js";

const VALID: SkillView = {
  id: "notes",
  name: "Notes",
  description: "Short notes.",
  version: "1",
  source: "user_local",
  status: "disabled",
  validationStatus: "valid",
  contentHash: "a".repeat(64),
  modifiedAt: "2026-07-12T00:00:00.000Z",
  sizeBytes: 100,
};

const INVALID: SkillView = {
  id: "invalid.user_local.bad",
  name: "Bad",
  description: "Skill không hợp lệ.",
  version: "unknown",
  source: "user_local",
  status: "invalid",
  validationStatus: "invalid",
  invalidReason: "Thiếu YAML frontmatter mở đầu.",
};

function client(skills: readonly SkillView[]): ServiceClient {
  return {
    listSkills: async () => skills,
    refreshSkills: async () => skills,
    setSkillEnabled: async () => VALID,
    previewSkill: async () => ({ content: "preview", truncated: false }),
  } as unknown as ServiceClient;
}

test("renders valid and invalid Skills; invalid Skill cannot be enabled", async () => {
  const root = document.createElement("div");
  await act(async () => {
    mountSkillsPanel(root, client([VALID, INVALID]), () => {});
  });
  assert.equal(root.querySelectorAll(".skill-card").length, 2);
  assert.match(root.textContent ?? "", /Thiếu YAML/u);
  const invalidButton = root.querySelectorAll<HTMLButtonElement>(".skill-card")[1]!.querySelector("button");
  assert.equal(invalidButton?.disabled, true);
});

test("renders explicit empty state", async () => {
  const root = document.createElement("div");
  await act(async () => {
    mountSkillsPanel(root, client([]), () => {});
  });
  assert.match(root.textContent ?? "", /Chưa có Skill khả dụng/u);
});
