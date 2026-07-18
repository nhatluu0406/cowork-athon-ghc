import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  researchFolderName,
  scaffoldResearchWorkspace,
} from "../src/research/scaffold.js";

test("researchFolderName is filesystem-safe and sortable", () => {
  const name = researchFolderName(new Date("2026-07-18T14:25:30.123Z"));
  assert.equal(name, "research-2026-07-18-14-25-30-123");
  assert.doesNotMatch(name, /[:.]/); // no chars Windows rejects in a folder name
});

test("scaffoldResearchWorkspace lays down the .agents layout and returns the root", async () => {
  const base = await mkdtemp(join(tmpdir(), "cghc-research-"));
  try {
    const result = await scaffoldResearchWorkspace(base, new Date("2026-07-18T14:25:30.123Z"));

    assert.equal(result.rootPath, join(base, "research-2026-07-18-14-25-30-123"));
    assert.ok((await stat(result.rootPath)).isDirectory());

    const agentFile = join(result.rootPath, ".agents", "agents", "researcher.md");
    const skillFile = join(result.rootPath, ".agents", "skills", "research", "SKILL.md");
    assert.deepEqual([...result.files].sort(), [agentFile, skillFile].sort());

    const agentMd = await readFile(agentFile, "utf8");
    // Materializes the built-in researcher persona (read-only, no edits) with CC-style frontmatter.
    assert.match(agentMd, /^---\nname: researcher\n/);
    assert.match(agentMd, /KHÔNG chỉnh sửa tệp/);

    const skillMd = await readFile(skillFile, "utf8");
    assert.match(skillMd, /^---\nname: research\n/);
    assert.match(skillMd, /Read-only/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("scaffoldResearchWorkspace creates a missing base dir (mkdir -p semantics)", async () => {
  const base = await mkdtemp(join(tmpdir(), "cghc-research-"));
  try {
    const nested = join(base, "workspaces");
    const result = await scaffoldResearchWorkspace(nested);
    assert.ok((await stat(result.rootPath)).isDirectory());
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
