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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  await tick();
  assert.match(root.textContent ?? "", /Notes/u);
  assert.match(root.textContent ?? "", /Tích hợp sẵn/u);
  // The clickable label area now lives in `.skills-settings__item-main` (the row is a container).
  const builtinMain = root.querySelector<HTMLButtonElement>(
    '[data-skill-id="builtin"] .skills-settings__item-main',
  );
  builtinMain?.click();
  await tick();
  assert.match(root.textContent ?? "", /Skill tích hợp sẵn chỉ đọc/u);
});

test("settings skills panel shows empty state when there are no skills", async () => {
  const root = document.createElement("section");
  mountSkillsSettingsPanel(root, mockClient({ skills: [], contents: {} }));
  await tick();
  assert.match(root.textContent ?? "", /Chưa có Skill/u);
});

test("each row surfaces an on/off toggle (issue #18); built-in has no delete, user skills do", async () => {
  const root = document.createElement("section");
  const state = {
    skills: [
      skill({ id: "notes", name: "Notes", source: "user_local", status: "disabled" }),
      skill({ id: "builtin", name: "Builtin", source: "built_in", status: "enabled" }),
    ],
    contents: { notes: "Body A", builtin: "Builtin body" },
  };
  mountSkillsSettingsPanel(root, mockClient(state));
  await tick();

  const userRow = root.querySelector('[data-skill-id="notes"]');
  const builtinRow = root.querySelector('[data-skill-id="builtin"]');
  // Toggle present on both rows; reflects current state via data-on/aria-checked.
  const userToggle = userRow?.querySelector<HTMLButtonElement>(".skills-settings__row-toggle");
  const builtinToggle = builtinRow?.querySelector<HTMLButtonElement>(".skills-settings__row-toggle");
  assert.ok(userToggle, "user row has an on/off toggle");
  assert.equal(userToggle?.dataset["on"], "false");
  assert.equal(builtinToggle?.dataset["on"], "true");
  // Delete only for user-local skills; built-in is read-only.
  assert.ok(userRow?.querySelector(".skills-settings__row-delete"), "user row has delete");
  assert.equal(builtinRow?.querySelector(".skills-settings__row-delete"), null, "built-in has no delete");

  // Clicking the row toggle enables the skill through the existing client method (no editor open).
  userToggle?.click();
  await tick();
  assert.equal(state.skills.find((s) => s.id === "notes")?.status, "enabled");
  await tick();
  const refreshedToggle = root.querySelector<HTMLButtonElement>(
    '[data-skill-id="notes"] .skills-settings__row-toggle',
  );
  assert.equal(refreshedToggle?.dataset["on"], "true", "toggle reflects the new enabled state");
});

test("row delete removes a user skill via the existing client method (issue #18)", async () => {
  const root = document.createElement("section");
  const state = {
    skills: [skill({ id: "notes", name: "Notes", source: "user_local" })],
    contents: { notes: "Body A" },
  };
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    mountSkillsSettingsPanel(root, mockClient(state));
    await tick();
    const del = root.querySelector<HTMLButtonElement>(
      '[data-skill-id="notes"] .skills-settings__row-delete',
    );
    assert.ok(del, "user row has a delete button");
    del?.click();
    await tick();
    await tick();
    assert.equal(state.skills.length, 0, "the skill was deleted");
  } finally {
    globalThis.confirm = originalConfirm;
  }
});
