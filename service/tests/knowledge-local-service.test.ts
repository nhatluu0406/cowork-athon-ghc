/**
 * Integration tests for the local Knowledge service: background sync lifecycle, status, search,
 * graph, clear, and the no-workspace behaviour. Uses a real in-memory DB + a temp workspace.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemorySqliteDatabase, runMigrations } from "../src/db/index.js";
import { createKnowledgeLocalRepository } from "../src/knowledge-local/repository.js";
import { createKnowledgeLocalService } from "../src/knowledge-local/service.js";

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-kbsvc-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return resolve(root);
}

function service(activeRoot: () => string | undefined) {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const repo = createKnowledgeLocalRepository(db);
  return createKnowledgeLocalService({ repo, activeWorkspaceRoot: activeRoot });
}

test("status reports no workspace when none is active", () => {
  const svc = service(() => undefined);
  const s = svc.status();
  assert.equal(s.hasWorkspace, false);
  assert.equal(s.status, "not_initialized");
  assert.deepEqual(svc.search("anything"), []);
  assert.deepEqual(svc.graph().nodes, []);
});

test("sync runs in the background then reports ready with counts; search + graph work", async () => {
  const root = await tempWorkspace();
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "a.md"), "# A\nalpha keyword links [b](./b.md)", "utf8");
    await writeFile(join(root, "docs", "b.md"), "# B\nbeta content", "utf8");
    const svc = service(() => root);

    assert.equal(svc.status().status, "not_initialized");
    const started = svc.sync();
    assert.equal(started.status, "indexing");
    await svc.whenIdle();

    const ready = svc.status();
    assert.equal(ready.status, "ready");
    assert.equal(ready.documentCount, 2);
    assert.ok(ready.chunkCount >= 2);
    assert.equal(ready.indexing, null);
    assert.ok(ready.lastIndexedAt !== null);

    const hits = svc.search("alpha");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.relativePath, "docs/a.md");

    const graph = svc.graph();
    assert.ok(graph.nodes.some((n) => n.kind === "workspace"));
    assert.ok(graph.edges.some((e) => e.type === "links_to"));
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("a second sync while one is running does not start a duplicate job", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(join(root, "a.md"), "alpha", "utf8");
    const svc = service(() => root);
    svc.sync();
    const again = svc.sync(); // should return the in-progress status, not throw or double-run
    assert.equal(again.status, "indexing");
    await svc.whenIdle();
    assert.equal(svc.status().status, "ready");
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("clear wipes the index back to not_initialized", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(join(root, "a.md"), "keepword alpha", "utf8");
    const svc = service(() => root);
    svc.sync();
    await svc.whenIdle();
    assert.equal(svc.status().status, "ready");
    assert.equal(svc.search("keepword").length, 1);

    const cleared = svc.clear();
    assert.equal(cleared.status, "not_initialized");
    assert.equal(svc.search("keepword").length, 0);
    assert.equal(svc.status().documentCount, 0);
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});
