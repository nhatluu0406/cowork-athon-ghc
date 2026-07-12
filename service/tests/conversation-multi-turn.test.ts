/**
 * Conversation store — atomic patch + runtime turns.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConversationStore } from "../src/conversation/store.js";

const NOW = (): string => "2026-07-12T08:00:00.000Z";

test("patch applies runtimeSessionId and status atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-patch-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const created = await store.create({ workspacePath: "C:/fixture/ws" });
  const patched = await store.patch(created.id, {
    runtimeSessionId: "rt-new",
    status: "ready",
  });
  assert.equal(patched.runtimeSessionId, "rt-new");
  assert.equal(patched.status, "ready");
  await rm(dir, { recursive: true, force: true });
});

test("startContinuation patch clears runtime id and sets draft", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-cont-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  let record = await store.create({ workspacePath: "C:/fixture/ws" });
  record = await store.patch(record.id, {
    runtimeSessionId: "rt-1",
    status: "completed",
  });
  record = await store.patch(record.id, {
    runtimeSessionId: null,
    status: "draft",
  });
  assert.equal(record.runtimeSessionId, null);
  assert.equal(record.status, "draft");
  await rm(dir, { recursive: true, force: true });
});

test("runtime turn register and complete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-turns-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const created = await store.create({ workspacePath: "C:/fixture/ws" });
  const linked = await store.patch(created.id, {
    runtimeSessionId: "rt-a",
    status: "ready",
    registerRuntimeTurn: {
      runtimeSessionId: "rt-a",
      startedAt: NOW(),
      status: "running",
    },
  });
  assert.equal(linked.runtimeTurns?.length, 1);
  const done = await store.patch(created.id, {
    completeRuntimeTurn: {
      runtimeSessionId: "rt-a",
      status: "completed",
      completedAt: NOW(),
    },
  });
  assert.equal(done.runtimeTurns?.[0]?.status, "completed");
  await rm(dir, { recursive: true, force: true });
});

test("last active conversation id persists in index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-last-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const a = await store.create({ workspacePath: "C:/fixture/ws" });
  await store.setLastActiveId(a.id);
  assert.equal(await store.getLastActiveId(), a.id);
  await rm(dir, { recursive: true, force: true });
});
