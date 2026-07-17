/**
 * Wave 0B — SQLite conversation store behavior (search, rename, delete, turns, reviews).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAppMetaRepository,
  createSqliteConversationStore,
  openMemorySqliteDatabase,
  runMigrations,
} from "../src/db/index.js";

const FIXED_NOW = (): string => "2026-07-16T02:00:00.000Z";

function freshStore() {
  const db = openMemorySqliteDatabase();
  runMigrations(db, undefined, FIXED_NOW);
  const appMeta = createAppMetaRepository(db);
  const store = createSqliteConversationStore({ db, appMeta, now: FIXED_NOW });
  return { db, store };
}

test("sqlite store: create, title from first message, search, rename, delete", async () => {
  const { store } = freshStore();
  const a = await store.create({ workspacePath: "C:/ws", title: "Alpha" });
  const b = await store.create({ workspacePath: "C:/ws", title: "Beta chat" });

  const byTitle = await store.list("Beta");
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0]?.id, b.id);

  await store.appendMessage(b.id, { role: "user", text: "unique-token-xyz" });
  assert.equal((await store.get(b.id))?.title, "unique-token-xyz");

  const byBody = await store.list("unique-token");
  assert.equal(byBody.length, 1);
  assert.equal(byBody[0]?.id, b.id);

  await store.rename(a.id, "Renamed");
  assert.equal((await store.get(a.id))?.title, "Renamed");

  assert.equal(await store.delete(a.id), true);
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.get(a.id), undefined);
});

test("sqlite store: attachments + provider snapshot + durable turns (no SSE fields)", async () => {
  const { db, store } = freshStore();
  const created = await store.create({
    workspacePath: "C:/ws",
    providerId: "deepseek",
    modelId: "deepseek-chat",
    providerSnapshot: {
      profileId: "p1",
      displayName: "DeepSeek",
      providerType: "deepseek",
      modelId: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
    },
  });
  await store.appendMessage(created.id, {
    role: "user",
    text: "read secret.txt",
    attachments: [
      {
        relativePath: "secret.txt",
        filename: "secret.txt",
        sizeBytes: 10,
        modifiedAt: FIXED_NOW(),
        contentHash: "abc",
        truncated: false,
        maxBytesApplied: 32768,
      },
    ],
  });
  await store.patch(created.id, {
    registerRuntimeTurn: {
      runtimeSessionId: "rt-1",
      startedAt: FIXED_NOW(),
      status: "running",
    },
  });
  await store.patch(created.id, {
    completeRuntimeTurn: {
      runtimeSessionId: "rt-1",
      status: "completed",
      completedAt: FIXED_NOW(),
    },
  });

  const record = await store.get(created.id);
  assert.equal(record?.providerSnapshot?.profileId, "p1");
  assert.equal(record?.messages[0]?.attachments?.[0]?.filename, "secret.txt");
  assert.equal(record?.runtimeTurns?.length, 1);
  assert.equal(record?.runtimeTurns?.[0]?.status, "completed");

  const attachmentRows = db
    .prepare("SELECT document_json AS j FROM conversation_attachments WHERE conversation_id = ?")
    .all(created.id) as Array<{ j: string }>;
  assert.equal(attachmentRows.length, 1);
  assert.ok(!attachmentRows[0]!.j.includes("VIOLET"));
  assert.ok(!JSON.stringify(record).includes("token_delta"));
  assert.ok(!JSON.stringify(record).includes("sse"));
});

test("sqlite store: file review refs omit preview/diff bodies", async () => {
  const { db, store } = freshStore();
  const created = await store.create({ workspacePath: "C:/ws" });
  await store.setActivity(created.id, {
    items: [],
    fileChanges: [],
    permissionHistory: [],
    readPaths: [],
    terminalState: "completed",
    fileReviews: [
      {
        id: "rev-1",
        eventKind: "file_modified",
        relativePath: "notes.txt",
        at: FIXED_NOW(),
        seq: 1,
        source: "tool",
        beforeExists: true,
        afterExists: true,
        beforeHash: "h1",
        afterHash: "h2",
        beforePreview: "OLD SECRET CONTENT",
        afterPreview: "NEW SECRET CONTENT",
        unifiedDiff: "--- a\n+++ b\n@@ SECRET @@",
        truncated: false,
        diffTruncated: false,
        previewTruncated: false,
        isBinary: false,
        contentRedacted: false,
      },
    ],
  });

  const refs = db
    .prepare("SELECT document_json AS j, relative_path AS p FROM file_review_refs WHERE conversation_id = ?")
    .all(created.id) as Array<{ j: string; p: string }>;
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.p, "notes.txt");
  assert.ok(!refs[0]!.j.includes("OLD SECRET"));
  assert.ok(!refs[0]!.j.includes("unifiedDiff"));
  assert.ok(!refs[0]!.j.includes("beforePreview"));

  // Reopen behavior: activity still carries review for UI (snapshots remain elsewhere / workspace).
  const reopened = await store.get(created.id);
  assert.equal(reopened?.activity?.fileReviews?.length, 1);
});

test("sqlite store: same OpenCode-seq review ids across conversations must not collide", async () => {
  const { store } = freshStore();
  const a = await store.create({ workspacePath: "C:/ws-a" });
  const b = await store.create({ workspacePath: "C:/ws-b" });
  const review = {
    id: "review-20",
    eventKind: "file_created" as const,
    relativePath: "x.txt",
    at: FIXED_NOW(),
    seq: 20,
    source: "tool" as const,
    beforeExists: false,
    afterExists: true,
    truncated: false,
    diffTruncated: false,
    previewTruncated: false,
    isBinary: false,
    contentRedacted: false,
  };
  await store.setActivity(a.id, {
    items: [],
    fileChanges: [],
    permissionHistory: [],
    readPaths: [],
    terminalState: "completed",
    fileReviews: [review],
  });
  // Without namespaced primary keys this threw SQLITE_CONSTRAINT; with conversation-scoped
  // storage keys both conversations can keep a review that shared an OpenCode seq.
  await store.setActivity(b.id, {
    items: [],
    fileChanges: [],
    permissionHistory: [],
    readPaths: [],
    terminalState: "completed",
    fileReviews: [review],
  });
  assert.equal((await store.get(a.id))?.activity?.fileReviews?.[0]?.id, "review-20");
  assert.equal((await store.get(b.id))?.activity?.fileReviews?.[0]?.id, "review-20");
});

test("sqlite store: last active + recoverStaleRunning + continuation session field", async () => {
  const { store } = freshStore();
  const created = await store.create({ workspacePath: "C:/ws" });
  await store.setLastActiveId(created.id);
  assert.equal(await store.getLastActiveId(), created.id);

  await store.setRuntimeSession(created.id, "sess-live");
  assert.equal((await store.get(created.id))?.runtimeSessionId, "sess-live");
  assert.equal((await store.get(created.id))?.status, "ready");

  await store.updateStatus(created.id, "running");
  const count = await store.recoverStaleRunning();
  assert.equal(count, 1);
  assert.equal((await store.get(created.id))?.status, "interrupted");
});

test("surface: create tags records and list filters by surface", async () => {
  const { store } = freshStore();
  await store.create({ workspacePath: "C:\\ws", surface: "ms365", title: "M" });
  await store.create({ workspacePath: "C:\\ws", surface: "cowork", title: "C" });
  await store.create({ workspacePath: "C:\\ws", title: "Default" }); // no surface → cowork

  const cowork = await store.list(undefined, { surface: "cowork" });
  const ms365 = await store.list(undefined, { surface: "ms365" });

  assert.deepEqual(cowork.map((c) => c.title).sort(), ["C", "Default"]);
  assert.deepEqual(ms365.map((c) => c.title), ["M"]);
  for (const c of cowork) assert.equal(c.surface, "cowork");
  assert.equal(ms365[0]!.surface, "ms365");
});
