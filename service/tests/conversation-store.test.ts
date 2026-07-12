/**
 * Conversation store — persistence, search, interruption recovery.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConversationStore } from "../src/conversation/store.js";
import { normalizeTitle, titleFromFirstMessage } from "../src/conversation/title.js";

const FIXED_NOW = (): string => "2026-07-12T08:00:00.000Z";

test("create conversation and derive title from first user message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-"));
  const store = createConversationStore({ rootDir: dir, now: FIXED_NOW });
  const created = await store.create({ workspacePath: "C:/ws/demo" });
  assert.equal(created.title, "Cuộc trò chuyện mới");
  const updated = await store.appendMessage(created.id, { role: "user", text: "  Hello world  " });
  assert.equal(updated.title, "Hello world");
  assert.equal(updated.messages.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("list orders by updatedAt and search matches title and user text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-"));
  const store = createConversationStore({ rootDir: dir, now: FIXED_NOW });
  const a = await store.create({ workspacePath: "C:/ws", title: "Alpha" });
  const b = await store.create({ workspacePath: "C:/ws", title: "Beta chat" });
  const byTitle = await store.list("Beta");
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0]?.id, b.id);
  await store.appendMessage(b.id, { role: "user", text: "unique-token-xyz" });
  const all = await store.list();
  assert.equal(all.length, 2);
  const byBody = await store.list("unique-token");
  assert.equal(byBody.length, 1);
  assert.equal(byBody[0]?.id, b.id);
  await store.rename(a.id, "Renamed");
  const renamed = await store.get(a.id);
  assert.equal(renamed?.title, "Renamed");
  await rm(dir, { recursive: true, force: true });
});

test("recoverStaleRunning marks running conversations interrupted on boot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-"));
  const store = createConversationStore({ rootDir: dir, now: FIXED_NOW });
  const created = await store.create({ workspacePath: "C:/ws" });
  await store.updateStatus(created.id, "running");
  const count = await store.recoverStaleRunning();
  assert.equal(count, 1);
  const record = await store.get(created.id);
  assert.equal(record?.status, "interrupted");
  await rm(dir, { recursive: true, force: true });
});

test("delete removes record without corrupting index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-"));
  const store = createConversationStore({ rootDir: dir, now: FIXED_NOW });
  const a = await store.create({ workspacePath: "C:/ws" });
  const b = await store.create({ workspacePath: "C:/ws" });
  assert.equal(await store.delete(a.id), true);
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.get(a.id)), undefined);
  assert.equal((await store.get(b.id))?.id, b.id);
  const raw = await readFile(join(dir, "index.json"), "utf8");
  assert.equal(raw.includes(b.id), true);
  assert.equal(raw.includes(a.id), false);
  await rm(dir, { recursive: true, force: true });
});

test("normalizeTitle enforces length and rejects empty", () => {
  assert.equal(titleFromFirstMessage("x".repeat(100)).length, 80);
  assert.throws(() => normalizeTitle("   "));
  assert.equal(normalizeTitle("  OK title  "), "OK title");
});

test("setActivity persists redacted activity snapshot on conversation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-"));
  const store = createConversationStore({ rootDir: dir, now: FIXED_NOW });
  const created = await store.create({ workspacePath: "C:/ws" });
  const activity = {
    items: [{ id: "t1", kind: "terminal" as const, label: "Đã hoàn thành", status: "success" as const, at: FIXED_NOW(), seq: 1, historical: true }],
    fileChanges: [{ id: "f1", operation: "create" as const, relativePath: "notes.txt", at: FIXED_NOW(), seq: 2, verified: true as const }],
    permissionHistory: [],
    readPaths: [],
    terminalState: "completed" as const,
  };
  const updated = await store.setActivity(created.id, activity);
  assert.equal(updated.activity?.fileChanges.length, 1);
  const raw = await readFile(join(dir, `${created.id}.json`), "utf8");
  assert.doesNotMatch(raw, /api[_-]?key/i);
  assert.doesNotMatch(raw, /Bearer /);
  await rm(dir, { recursive: true, force: true });
});

test("conversation records do not persist credential fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-"));
  const store = createConversationStore({ rootDir: dir, now: FIXED_NOW });
  const created = await store.create({
    workspacePath: "C:/ws",
    providerId: "deepseek",
    modelId: "deepseek-chat",
  });
  const raw = await readFile(join(dir, `${created.id}.json`), "utf8");
  assert.doesNotMatch(raw, /api[_-]?key/i);
  assert.doesNotMatch(raw, /secret/i);
  assert.doesNotMatch(raw, /Bearer /);
  await rm(dir, { recursive: true, force: true });
});
