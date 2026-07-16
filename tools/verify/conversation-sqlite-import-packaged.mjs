/**
 * Packaged-layout old-data import check (Wave 0B).
 *
 * Simulates a packaged userData / LocalAppData layout with legacy
 * `conversations/` JSON, opens the same SQLite path the shell uses, and verifies
 * idempotent import + sole-source SQLite (JSON dir renamed to `.migrated-backup`).
 *
 * Does not launch Electron / OpenCode / UI.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOW = "2026-07-16T04:00:00.000Z";
const CONV_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async function main() {
  const root = mkdtempSync(join(tmpdir(), "cghc-packaged-conv-import-"));
  // Packaged layout: <userData>/conversations + <userData>/data/cowork-ghc.db
  const conversationsDir = join(root, "conversations");
  const dataDir = join(root, "data");
  const dbPath = join(dataDir, "cowork-ghc.db");
  mkdirSync(conversationsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const record = {
    id: CONV_ID,
    title: "Legacy packaged chat",
    workspacePath: "C:/fixture/ws",
    runtimeSessionId: null,
    status: "completed",
    createdAt: NOW,
    updatedAt: NOW,
    messageCount: 2,
    providerSnapshot: {
      profileId: "p1",
      displayName: "DeepSeek",
      providerType: "deepseek",
      modelId: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
    },
    messages: [
      { id: "m1", role: "user", text: "old packaged prompt", at: NOW },
      { id: "m2", role: "assistant", text: "old packaged reply", at: NOW },
    ],
    runtimeTurns: [
      {
        runtimeSessionId: "rt-packaged",
        startedAt: NOW,
        completedAt: NOW,
        status: "completed",
      },
    ],
    activity: {
      items: [],
      fileChanges: [{ id: "f1", operation: "create", relativePath: "out.txt", at: NOW, seq: 1 }],
      permissionHistory: [],
      readPaths: [],
      terminalState: "completed",
      fileReviews: [
        {
          id: "rev-1",
          eventKind: "file_created",
          relativePath: "out.txt",
          at: NOW,
          seq: 1,
          source: "tool",
          beforeExists: false,
          afterExists: true,
          afterHash: "abc",
          afterPreview: "FILE BODY ON DISK",
          unifiedDiff: "+++ out.txt\n+FILE BODY ON DISK",
          truncated: false,
          diffTruncated: false,
          previewTruncated: false,
          isBinary: false,
          contentRedacted: false,
        },
      ],
    },
  };

  writeFileSync(join(conversationsDir, `${CONV_ID}.json`), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(
    join(conversationsDir, "index.json"),
    `${JSON.stringify(
      {
        version: 1,
        conversations: [
          {
            id: CONV_ID,
            title: record.title,
            workspacePath: record.workspacePath,
            runtimeSessionId: null,
            status: "completed",
            createdAt: NOW,
            updatedAt: NOW,
            messageCount: 2,
          },
        ],
        lastActiveConversationId: CONV_ID,
      },
      null,
      2,
    )}\n`,
  );

  const dbModule = await import(
    pathToFileURL(join(REPO, "service/src/db/index.ts")).href
  );
  const composition = await import(
    pathToFileURL(join(REPO, "service/src/composition/index.ts")).href
  );

  const service = await composition.createCoworkService({
    dbPath,
    conversationsDir,
    settingsFilePath: join(root, "settings.json"),
    skillsStateFilePath: join(root, "skills-enabled.json"),
    skillRoots: [{ path: join(root, "skills"), source: "user_local", createIfMissing: true }],
    now: () => NOW,
  });

  const listed = await service.deps.conversationStore.list();
  assert.equal(listed.length, 1, "imported conversation listed");
  const got = await service.deps.conversationStore.get(CONV_ID);
  assert.equal(got?.messages[0]?.text, "old packaged prompt");
  assert.equal(got?.runtimeTurns?.[0]?.runtimeSessionId, "rt-packaged");
  assert.equal(await service.deps.conversationStore.getLastActiveId(), CONV_ID);

  assert.equal(existsSync(conversationsDir), false, "legacy JSON dir removed after import");
  assert.equal(
    existsSync(`${conversationsDir}.migrated-backup`),
    true,
    "legacy JSON renamed to migrated-backup",
  );

  // Second boot: meta already migrated — no failure, same data.
  if (service.deps.sqliteDatabase !== undefined) {
    dbModule.closeSqliteDatabase(service.deps.sqliteDatabase);
  }

  const again = await composition.createCoworkService({
    dbPath,
    conversationsDir,
    settingsFilePath: join(root, "settings.json"),
    skillsStateFilePath: join(root, "skills-enabled.json"),
    skillRoots: [{ path: join(root, "skills"), source: "user_local", createIfMissing: true }],
    now: () => NOW,
  });
  assert.equal((await again.deps.conversationStore.list()).length, 1);

  // New writes go only to SQLite (no resurrected JSON dir writes).
  const created = await again.deps.conversationStore.create({
    workspacePath: "C:/fixture/ws",
    title: "Post-migration",
  });
  assert.equal(existsSync(join(conversationsDir, `${created.id}.json`)), false);
  const db2 = again.deps.sqliteDatabase;
  assert.ok(db2);
  const row = db2.prepare("SELECT 1 AS ok FROM conversations WHERE id = ?").get(created.id);
  assert.ok(row, "new conversation persisted in SQLite only");

  // Probe review refs from the first import (re-open readonly ok after close).
  dbModule.closeSqliteDatabase(db2);
  const probe = dbModule.openSqliteDatabase({ filePath: dbPath });
  const ref = probe
    .prepare("SELECT document_json AS j FROM file_review_refs WHERE conversation_id = ?")
    .get(CONV_ID);
  assert.ok(ref, "file review ref row exists");
  assert.ok(!ref.j.includes("FILE BODY ON DISK"), "review refs omit snapshot preview bodies");
  assert.ok(!ref.j.includes("unifiedDiff"), "review refs omit unifiedDiff");
  dbModule.closeSqliteDatabase(probe);

  rmSync(root, { recursive: true, force: true });
  console.log("conversation-sqlite-import-packaged: PASS");
}

main().catch((err) => {
  console.error("conversation-sqlite-import-packaged: FAIL", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
