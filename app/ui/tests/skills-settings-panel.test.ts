import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSkillsSettingsPanel } from "../src/skills-settings-panel.js";
import type { ServiceClient, SkillView } from "../src/service-client.js";

function skill(overrides: Partial<SkillView> = {}): SkillView {
  return {
    id: "notes",
    name: "Notes",
    description: "Concise notes.",
    version: "1.0.0",
    source: "user_local",
    status: "disabled",
    validationStatus: "valid",
    contentHash: "a".repeat(64),
    modifiedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function mockClient(state: {
  skills: SkillView[];
  contents: Record<string, string>;
}): ServiceClient {
  return {
    refreshSkills: async () => state.skills,
    listSkills: async () => state.skills,
    readSkillContent: async (id) => state.contents[id] ?? "",
    createSkill: async (input) => {
      const created = skill({
        id: input.id ?? "new-skill",
        name: input.name,
        description: input.description,
        version: input.version,
      });
      state.skills = [...state.skills, created];
      state.contents[created.id] = input.body;
      return created;
    },
    updateSkill: async (id, input) => {
      state.skills = state.skills.map((entry) =>
        entry.id === id
          ? { ...entry, name: input.name, description: input.description, version: input.version }
          : entry,
      );
      state.contents[id] = input.body;
      return state.skills.find((entry) => entry.id === id)!;
    },
    deleteSkill: async (id) => {
      state.skills = state.skills.filter((entry) => entry.id !== id);
      delete state.contents[id];
    },
    setSkillEnabled: async (id, enabled) => {
      state.skills = state.skills.map((entry) =>
        entry.id === id ? { ...entry, status: enabled ? "enabled" : "disabled" } : entry,
      );
      return state.skills.find((entry) => entry.id === id)!;
    },
  } as unknown as ServiceClient;
}

test("settings skills panel renders list and built-in read-only note", async () => {
  const root = document.createElement("section");
  const state = {
    skills: [
      skill(),
      skill({
        id: "builtin",
        name: "Builtin",
        source: "built_in",
        status: "enabled",
      }),
    ],
    contents: { notes: "Body A", builtin: "Builtin body" },
  };
  mountSkillsSettingsPanel(root, mockClient(state));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(root.textContent ?? "", /Notes/u);
  assert.match(root.textContent ?? "", /Tích hợp sẵn/u);
  const builtinItem = root.querySelector<HTMLButtonElement>('[data-skill-id="builtin"]');
  builtinItem?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(root.textContent ?? "", /Skill tích hợp sẵn chỉ đọc/u);
});

test("settings skills panel shows empty state for no user skills", async () => {
  const root = document.createElement("section");
  mountSkillsSettingsPanel(
    root,
    mockClient({
      skills: [skill({ id: "builtin", source: "built_in", name: "Builtin" })],
      contents: { builtin: "Body" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(root.textContent ?? "", /Chưa có Skill người dùng/u);
});
