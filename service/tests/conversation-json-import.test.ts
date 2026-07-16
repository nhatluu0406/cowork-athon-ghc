/**
 * Wave 0B — idempotent JSON conversation import into SQLite.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAppMetaRepository,
  createSqliteConversationStore,
  migrateJsonConversationsToSqlite,
  META_JSON_CONVERSATIONS_MIGRATED,
  openMemorySqliteDatabase,
  closeSqliteDatabase,
  runMigrations,
  persistConversationRecord,
} from "../src/db/index.js";
import { createCoworkService } from "../src/composition/index.js";

const NOW = (): string => "2026-07-16T03:00:00.000Z";

async function writeLegacyConversation(
  dir: string,
  record: {
    id: string;
    title: string;
    messages: Array<{ id: string; role: "user" | "assistant"; text: string; at: string }>;
  },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const full = {
    ...record,
    workspacePath: "C:/fixture/ws",
    runtimeSessionId: null,
    status: "completed",
    createdAt: NOW(),
    updatedAt: NOW(),
    messageCount: record.messages.length,
    providerSnapshot: {
      profileId: "p1",
      displayName: "DeepSeek",
      providerType: "deepseek",
      modelId: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
    },
    runtimeTurns: [
      {
        runtimeSessionId: "rt-legacy",
        startedAt: NOW(),
        completedAt: NOW(),
        status: "completed",
      },
    ],
  };
  await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(full, null, 2)}\n`, "utf8");
}

test("migrateJsonConversationsToSqlite imports index + records then backs up dir", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-conv-import-"));
  const conversationsDir = join(root, "conversations");
  const id = "11111111-1111-1111-1111-111111111111";
  await writeLegacyConversation(conversationsDir, {
    id,
    title: "Old chat",
    messages: [
      { id: "m1", role: "user", text: "hello from json", at: NOW() },
      { id: "m2", role: "assistant", text: "hi back", at: NOW() },
    ],
  });
  await writeFile(
    join(conversationsDir, "index.json"),
    `${JSON.stringify(
      {
        version: 1,
        conversations: [
          {
            id,
            title: "Old chat",
            workspacePath: "C:/fixture/ws",
            runtimeSessionId: null,
            status: "completed",
            createdAt: NOW(),
            updatedAt: NOW(),
            messageCount: 2,
          },
        ],
        lastActiveConversationId: id,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const db = openMemorySqliteDatabase();
  runMigrations(db, undefined, NOW);
  const appMeta = createAppMetaRepository(db);
  const first = migrateJsonConversationsToSqlite({ conversationsDir, db, appMeta });
  assert.equal(first.importedCount, 1);
  assert.equal(first.backedUp, true);
  assert.equal(appMeta.get(META_JSON_CONVERSATIONS_MIGRATED), "1");
  assert.equal(existsSync(conversationsDir), false);
  assert.equal(existsSync(`${conversationsDir}.migrated-backup`), true);

  const store = createSqliteConversationStore({ db, appMeta, now: NOW });
  const reopened = await store.get(id);
  assert.equal(reopened?.title, "Old chat");
  assert.equal(reopened?.messages.length, 2);
  assert.equal(reopened?.providerSnapshot?.modelId, "deepseek-chat");
  assert.equal(reopened?.runtimeTurns?.[0]?.runtimeSessionId, "rt-legacy");
  assert.equal(await store.getLastActiveId(), id);

  const second = migrateJsonConversationsToSqlite({ conversationsDir, db, appMeta });
  assert.equal(second.reason, "already_migrated");
  assert.equal(second.importedCount, 0);

  await rm(root, { recursive: true, force: true });
});

test("import is idempotent when SQLite already has the conversation id", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-conv-import-idemp-"));
  const conversationsDir = join(root, "conversations");
  const id = "22222222-2222-2222-2222-222222222222";
  await writeLegacyConversation(conversationsDir, {
    id,
    title: "Legacy",
    messages: [{ id: "m1", role: "user", text: "once", at: NOW() }],
  });
  await writeFile(
    join(conversationsDir, "index.json"),
    `${JSON.stringify({ version: 1, conversations: [{ id, title: "Legacy", workspacePath: "C:/ws", runtimeSessionId: null, status: "completed", createdAt: NOW(), updatedAt: NOW(), messageCount: 1 }] })}\n`,
    "utf8",
  );

  const db = openMemorySqliteDatabase();
  runMigrations(db, undefined, NOW);
  const appMeta = createAppMetaRepository(db);
  const store = createSqliteConversationStore({ db, appMeta, now: NOW });
  // Pre-seed same id — simulate partial migration where SQLite already has the row.
  persistConversationRecord(db, {
    id,
    title: "Already in DB",
    workspacePath: "C:/ws",
    runtimeSessionId: null,
    status: "completed",
    createdAt: NOW(),
    updatedAt: NOW(),
    messageCount: 1,
    messages: [{ id: "m0", role: "user", text: "preexisting", at: NOW() }],
  });

  const result = migrateJsonConversationsToSqlite({ conversationsDir, db, appMeta });
  assert.equal(result.skippedCount, 1);
  assert.equal(result.importedCount, 0);
  const record = await store.get(id);
  assert.equal(record?.title, "Already in DB");
  assert.equal(record?.messages[0]?.text, "preexisting");
  await rm(root, { recursive: true, force: true });
});

test("composed service with dbPath uses SQLite sole source after import (no dual write)", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-conv-compose-"));
  const conversationsDir = join(root, "conversations");
  const settingsFile = join(root, "settings.json");
  const dbPath = join(root, "data", "cowork-ghc.db");
  const id = "33333333-3333-3333-3333-333333333333";

  await writeLegacyConversation(conversationsDir, {
    id,
    title: "Packaged old",
    messages: [{ id: "m1", role: "user", text: "old packaged data", at: NOW() }],
  });
  await writeFile(
    join(conversationsDir, "index.json"),
    `${JSON.stringify({ version: 1, conversations: [{ id, title: "Packaged old", workspacePath: "C:/fixture/ws", runtimeSessionId: null, status: "completed", createdAt: NOW(), updatedAt: NOW(), messageCount: 1 }], lastActiveConversationId: id })}\n`,
    "utf8",
  );

  const service = await createCoworkService({
    dbPath,
    conversationsDir,
    settingsFilePath: settingsFile,
    skillsStateFilePath: join(root, "skills-enabled.json"),
    skillRoots: [{ path: join(root, "skills"), source: "user_local", createIfMissing: true }],
    now: NOW,
  });
  const list = await service.deps.conversationStore.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, id);
  const got = await service.deps.conversationStore.get(id);
  assert.equal(got?.messages[0]?.text, "old packaged data");

  // Legacy dir renamed — sole source is DB.
  assert.equal(existsSync(conversationsDir), false);
  assert.equal(existsSync(`${conversationsDir}.migrated-backup`), true);

  const created = await service.deps.conversationStore.create({ workspacePath: "C:/ws", title: "New" });
  assert.equal(existsSync(join(conversationsDir, `${created.id}.json`)), false);
  assert.equal(existsSync(join(`${conversationsDir}.migrated-backup`, `${created.id}.json`)), false);

  const row = service.deps.sqliteDatabase
    ?.prepare("SELECT 1 AS ok FROM conversations WHERE id = ?")
    .get(created.id) as { ok: number } | undefined;
  assert.ok(row);
  if (service.deps.sqliteDatabase !== undefined) {
    closeSqliteDatabase(service.deps.sqliteDatabase);
  }

  await rm(root, { recursive: true, force: true });
});
