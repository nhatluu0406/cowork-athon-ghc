/**
 * Conversation persistence survives service relaunch (deterministic).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoworkService } from "../src/composition/index.js";
import { closeSqliteDatabase } from "../src/db/index.js";

const NOW = (): string => "2026-07-12T08:00:00.000Z";

function closeDb(deps: { readonly sqliteDatabase?: { close(): void } }): void {
  if (deps.sqliteDatabase !== undefined) closeSqliteDatabase(deps.sqliteDatabase);
}

test("conversations persist across composed service restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-relaunch-"));
  const conversationsDir = join(dir, "conversations");
  const settingsFile = join(dir, "settings.json");
  const dbPath = join(dir, "cowork-ghc.db");

  const first = await createCoworkService({
    dbPath,
    conversationsDir,
    settingsFilePath: settingsFile,
    skillsStateFilePath: join(dir, "skills-enabled.json"),
    skillRoots: [{ path: join(dir, "skills"), source: "user_local", createIfMissing: true }],
    now: NOW,
  });
  const created = await first.deps.conversationStore.create({ workspacePath: "C:/fixture/ws" });
  await first.deps.conversationStore.appendMessage(created.id, {
    role: "user",
    text: "persist me",
  });
  await first.deps.conversationStore.appendMessage(created.id, {
    role: "assistant",
    text: "stored reply",
  });
  closeDb(first.deps);

  const second = await createCoworkService({
    dbPath,
    conversationsDir,
    settingsFilePath: settingsFile,
    skillsStateFilePath: join(dir, "skills-enabled.json"),
    skillRoots: [{ path: join(dir, "skills"), source: "user_local", createIfMissing: true }],
    now: NOW,
  });
  const list = await second.deps.conversationStore.list();
  assert.equal(list.length, 1);
  const reopened = await second.deps.conversationStore.get(created.id);
  assert.equal(reopened?.messages.length, 2);
  assert.equal(reopened?.messages[0]?.text, "persist me");
  assert.equal(reopened?.messages[1]?.text, "stored reply");
  closeDb(second.deps);
  await rm(dir, { recursive: true, force: true });
});

test("recoverStaleRunning on boot marks interrupted without losing messages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-interrupt-"));
  const conversationsDir = join(dir, "conversations");
  const settingsFile = join(dir, "settings.json");
  const dbPath = join(dir, "cowork-ghc.db");

  const running = await createCoworkService({
    dbPath,
    conversationsDir,
    settingsFilePath: settingsFile,
    skillsStateFilePath: join(dir, "skills-enabled.json"),
    skillRoots: [{ path: join(dir, "skills"), source: "user_local", createIfMissing: true }],
    now: NOW,
  });
  const created = await running.deps.conversationStore.create({ workspacePath: "C:/fixture/ws" });
  await running.deps.conversationStore.appendMessage(created.id, { role: "user", text: "mid-run" });
  await running.deps.conversationStore.updateStatus(created.id, "running");
  closeDb(running.deps);

  const afterCrash = await createCoworkService({
    dbPath,
    conversationsDir,
    settingsFilePath: settingsFile,
    skillsStateFilePath: join(dir, "skills-enabled.json"),
    skillRoots: [{ path: join(dir, "skills"), source: "user_local", createIfMissing: true }],
    now: NOW,
  });
  const record = await afterCrash.deps.conversationStore.get(created.id);
  assert.equal(record?.status, "interrupted");
  assert.equal(record?.messages.length, 1);
  closeDb(afterCrash.deps);
  await rm(dir, { recursive: true, force: true });
});
