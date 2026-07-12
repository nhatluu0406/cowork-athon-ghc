/**
 * Conversation persistence survives service relaunch (deterministic).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoworkService } from "../src/composition/index.js";

const NOW = (): string => "2026-07-12T08:00:00.000Z";

test("conversations persist across composed service restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-relaunch-"));
  const conversationsDir = join(dir, "conversations");
  const settingsFile = join(dir, "settings.json");

  const first = await createCoworkService({
    conversationsDir,
    settingsFilePath: settingsFile,
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

  const second = await createCoworkService({
    conversationsDir,
    settingsFilePath: settingsFile,
    now: NOW,
  });
  const list = await second.deps.conversationStore.list();
  assert.equal(list.length, 1);
  const reopened = await second.deps.conversationStore.get(created.id);
  assert.equal(reopened?.messages.length, 2);
  assert.equal(reopened?.messages[0]?.text, "persist me");
  assert.equal(reopened?.messages[1]?.text, "stored reply");
  await rm(dir, { recursive: true, force: true });
});

test("recoverStaleRunning on boot marks interrupted without losing messages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-interrupt-"));
  const conversationsDir = join(dir, "conversations");
  const settingsFile = join(dir, "settings.json");

  const running = await createCoworkService({
    conversationsDir,
    settingsFilePath: settingsFile,
    now: NOW,
  });
  const created = await running.deps.conversationStore.create({ workspacePath: "C:/fixture/ws" });
  await running.deps.conversationStore.appendMessage(created.id, { role: "user", text: "mid-run" });
  await running.deps.conversationStore.updateStatus(created.id, "running");

  const afterCrash = await createCoworkService({
    conversationsDir,
    settingsFilePath: settingsFile,
    now: NOW,
  });
  const record = await afterCrash.deps.conversationStore.get(created.id);
  assert.equal(record?.status, "interrupted");
  assert.equal(record?.messages.length, 1);
  await rm(dir, { recursive: true, force: true });
});
