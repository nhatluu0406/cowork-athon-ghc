import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createSkillCatalog,
  suggestSkillId,
} from "../src/skills/catalog.js";
import { createConversationStore } from "../src/conversation/store.js";

function skillText(
  id: string,
  body = "Follow the user's request and answer concisely.",
  name = "Test Skill",
): string {
  return `---\nid: ${id}\nname: ${name}\ndescription: Deterministic test skill.\nversion: 1.0.0\n---\n\n${body}\n`;
}

async function fixture() {
  const userRoot = await mkdtemp(join(tmpdir(), "cghc-skills-user-"));
  const builtInRoot = await mkdtemp(join(tmpdir(), "cghc-skills-builtin-"));
  const state = join(userRoot, "enabled.json");
  return {
    userRoot,
    builtInRoot,
    state,
    catalog: () =>
      createSkillCatalog({
        roots: [
          { path: builtInRoot, source: "built_in" },
          { path: userRoot, source: "user_local", createIfMissing: true },
        ],
        stateFilePath: state,
      }),
  };
}

test("create user Skill writes SKILL.md under app-managed root", async () => {
  const f = await fixture();
  const catalog = await f.catalog();
  const created = await catalog.createUserSkill({
    id: "my-notes",
    name: "My Notes",
    description: "Keep notes concise.",
    version: "1.0.0",
    body: "Summarize in bullet points.",
  });
  assert.equal(created.id, "my-notes");
  assert.equal(created.source, "user_local");
  const raw = await readFile(join(f.userRoot, "my-notes", "SKILL.md"), "utf8");
  assert.match(raw, /id: my-notes/u);
  assert.match(raw, /Summarize in bullet points/u);
});

test("create reload persistence and enable/disable survives relaunch", async () => {
  const f = await fixture();
  const first = await f.catalog();
  await first.createUserSkill({
    name: "Persisted",
    description: "Persisted skill.",
    version: "1.0.0",
    body: "Persist body.",
  });
  const id = suggestSkillId("Persisted");
  await first.setEnabled(id, true);
  const second = await f.catalog();
  const skill = second.list().find((entry) => entry.id === id);
  assert.equal(skill?.status, "enabled");
});

test("edit user Skill updates content and hash", async () => {
  const f = await fixture();
  const catalog = await f.catalog();
  await catalog.createUserSkill({
    id: "editable",
    name: "Editable",
    description: "Editable skill.",
    version: "1.0.0",
    body: "Version A",
  });
  const before = catalog.readContent("editable");
  const updated = await catalog.updateUserSkill("editable", {
    name: "Editable",
    description: "Updated description.",
    version: "1.1.0",
    body: "Version B",
  });
  assert.notEqual(before, catalog.readContent("editable"));
  assert.equal(updated.version, "1.1.0");
});

test("delete user Skill removes folder and enabled state", async () => {
  const f = await fixture();
  const catalog = await f.catalog();
  await catalog.createUserSkill({
    id: "delete-me",
    name: "Delete Me",
    description: "Temporary skill.",
    version: "1.0.0",
    body: "Delete body.",
  });
  await catalog.setEnabled("delete-me", true);
  await catalog.deleteUserSkill("delete-me");
  assert.equal(catalog.list().some((skill) => skill.id === "delete-me"), false);
  assert.doesNotMatch(await readFile(f.state, "utf8"), /delete-me/u);
});

test("built-in Skills are read-only for edit and delete", async () => {
  const f = await fixture();
  await mkdir(join(f.builtInRoot, "builtin-one"));
  await writeFile(join(f.builtInRoot, "builtin-one", "SKILL.md"), skillText("builtin-one"), "utf8");
  const catalog = await f.catalog();
  await assert.rejects(() =>
    catalog.updateUserSkill("builtin-one", {
      name: "Builtin One",
      description: "Nope.",
      version: "9.9.9",
      body: "Nope.",
    }),
  );
  await assert.rejects(() => catalog.deleteUserSkill("builtin-one"));
  await catalog.setEnabled("builtin-one", true);
  assert.equal(catalog.list().find((skill) => skill.id === "builtin-one")?.status, "enabled");
});

test("duplicate ID rejection on create", async () => {
  const f = await fixture();
  const catalog = await f.catalog();
  await catalog.createUserSkill({
    id: "dup",
    name: "First",
    description: "First skill.",
    version: "1.0.0",
    body: "First body.",
  });
  await assert.rejects(() =>
    catalog.createUserSkill({
      id: "dup",
      name: "Second",
      description: "Second skill.",
      version: "1.0.0",
      body: "Second body.",
    }),
  );
});

test("path traversal id is rejected", async () => {
  const f = await fixture();
  const catalog = await f.catalog();
  await assert.rejects(() =>
    catalog.createUserSkill({
      id: "../escape",
      name: "Escape",
      description: "Escape.",
      version: "1.0.0",
      body: "Escape.",
    }),
  );
});

test("historical provenance remains readable after Skill delete", async () => {
  const f = await fixture();
  const catalog = await f.catalog();
  const created = await catalog.createUserSkill({
    id: "provenance",
    name: "Provenance",
    description: "Provenance skill.",
    version: "1.0.0",
    body: "Provenance body.",
  });
  await catalog.setEnabled("provenance", true);
  const snapshot = catalog.enabledSnapshots()[0]!;
  const convRoot = await mkdtemp(join(tmpdir(), "cghc-conv-del-skill-"));
  const store = createConversationStore({ rootDir: convRoot });
  const conversation = await store.create({ workspacePath: "C:\\workspace" });
  await store.appendMessage(conversation.id, {
    role: "user",
    text: "Use skill",
    skills: [snapshot.metadata],
  });
  await catalog.deleteUserSkill("provenance");
  const record = await store.get(conversation.id);
  assert.equal(record?.messages[0]?.skills?.[0]?.id, created.id);
  assert.equal(record?.messages[0]?.skills?.[0]?.contentHash, snapshot.metadata.contentHash);
});

test("symlink escape cannot be created through CRUD ids", async (t) => {
  const f = await fixture();
  const catalog = await f.catalog();
  await assert.rejects(() =>
    catalog.createUserSkill({
      id: "bad/id",
      name: "Bad",
      description: "Bad.",
      version: "1.0.0",
      body: "Bad.",
    }),
  );
  const outside = await mkdtemp(join(tmpdir(), "cghc-skills-outside-"));
  await writeFile(join(outside, "SKILL.md"), skillText("escape"), "utf8");
  try {
    await symlink(outside, join(f.userRoot, "escape"), "junction");
  } catch {
    t.skip("symlink creation not permitted");
    return;
  }
  await catalog.refresh();
  assert.equal(catalog.list()[0]?.validationStatus, "invalid");
});
