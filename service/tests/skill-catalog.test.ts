import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createSkillCatalog,
  SKILL_MAX_FILE_BYTES,
} from "../src/skills/catalog.js";

function skillText(
  id: string,
  body = "Follow the user's request and answer concisely.",
  name = "Test Skill",
): string {
  return `---\nid: ${id}\nname: ${name}\ndescription: Deterministic test skill.\nversion: 1.0.0\n---\n\n${body}\n`;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cghc-skills-"));
  const state = join(root, "state", "enabled.json");
  return {
    root,
    state,
    catalog: () =>
      createSkillCatalog({
        roots: [{ path: root, source: "user_local" }],
        stateFilePath: state,
      }),
  };
}

test("discovers valid SKILL.md and snapshots provenance without raw persistence", async () => {
  const f = await fixture();
  const dir = join(f.root, "notes");
  await mkdir(dir);
  await writeFile(join(dir, "SKILL.md"), skillText("notes"), "utf8");
  const catalog = await f.catalog();
  assert.equal(catalog.list()[0]?.validationStatus, "valid");
  await catalog.setEnabled("notes", true);
  const snapshot = catalog.enabledSnapshots()[0]!;
  assert.equal(snapshot.metadata.id, "notes");
  assert.equal(snapshot.metadata.contentHash.length, 64);
  assert.match(snapshot.content, /concisely/);
  assert.doesNotMatch(await readFile(f.state, "utf8"), /concisely/);
});

test("enabled state persists across catalog relaunch", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "persist"));
  await writeFile(join(f.root, "persist", "SKILL.md"), skillText("persist"), "utf8");
  const first = await f.catalog();
  await first.setEnabled("persist", true);
  const second = await f.catalog();
  assert.equal(second.list()[0]?.status, "enabled");
});

test("Claude Code-style frontmatter (no id/version, long description) is valid via folder id", async () => {
  const f = await fixture();
  const dir = join(f.root, "pdf-tools");
  await mkdir(dir);
  const description = "Use this skill for PDF work. ".repeat(20).trim();
  assert.ok(description.length > 300 && description.length <= 1000);
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: pdf-tools\ndescription: ${description}\nlicense: Proprietary\n---\n\nHow to process PDFs.\n`,
    "utf8",
  );
  const catalog = await f.catalog();
  const view = catalog.list()[0]!;
  assert.equal(view.validationStatus, "valid");
  assert.equal(view.id, "pdf-tools");
  assert.equal(view.version, "1");
});

test("malformed metadata, binary, oversized, and marker skills are invalid", async () => {
  const f = await fixture();
  for (const name of ["malformed", "binary", "large", "marker"]) await mkdir(join(f.root, name));
  await writeFile(join(f.root, "malformed", "SKILL.md"), "# no frontmatter", "utf8");
  await writeFile(join(f.root, "binary", "SKILL.md"), Buffer.from([0, 1, 2]));
  await writeFile(join(f.root, "large", "SKILL.md"), "x".repeat(SKILL_MAX_FILE_BYTES + 1), "utf8");
  await writeFile(
    join(f.root, "marker", "SKILL.md"),
    skillText("marker", "<<<CGHC_CURRENT_USER_REQUEST>>>"),
    "utf8",
  );
  const catalog = await f.catalog();
  assert.equal(catalog.list().length, 4);
  assert.ok(catalog.list().every((skill) => skill.validationStatus === "invalid"));
});

test("duplicate IDs are deterministic invalid entries and cannot be enabled", async () => {
  const f = await fixture();
  for (const name of ["a", "b"]) {
    await mkdir(join(f.root, name));
    await writeFile(join(f.root, name, "SKILL.md"), skillText("duplicate"), "utf8");
  }
  const catalog = await f.catalog();
  assert.equal(catalog.list().length, 2);
  assert.ok(catalog.list().every((skill) => /Duplicate/u.test(skill.invalidReason ?? "")));
  await assert.rejects(() => catalog.setEnabled(catalog.list()[0]!.id, true));
});

test("symlink directory escape is rejected when platform permits symlink creation", async (t) => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "cghc-skills-outside-"));
  await writeFile(join(outside, "SKILL.md"), skillText("escape"), "utf8");
  try {
    await symlink(outside, join(f.root, "escape"), "junction");
  } catch {
    t.skip("symlink creation not permitted");
    return;
  }
  const catalog = await f.catalog();
  assert.equal(catalog.list()[0]?.validationStatus, "invalid");
  assert.match(catalog.list()[0]?.invalidReason ?? "", /Symlink|reparse/u);
});

test("content hash changes after refresh while prior snapshot remains immutable", async () => {
  const f = await fixture();
  const dir = join(f.root, "versioned");
  await mkdir(dir);
  const file = join(dir, "SKILL.md");
  await writeFile(file, skillText("versioned", "VERSION-A"), "utf8");
  const catalog = await f.catalog();
  await catalog.setEnabled("versioned", true);
  const prior = catalog.enabledSnapshots()[0]!.metadata;
  await writeFile(file, skillText("versioned", "VERSION-B"), "utf8");
  await catalog.refresh();
  const next = catalog.enabledSnapshots()[0]!.metadata;
  assert.notEqual(prior.contentHash, next.contentHash);
  assert.equal(prior.id, next.id);
});
