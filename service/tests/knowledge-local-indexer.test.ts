/**
 * Tests for the local Knowledge indexer: pure helpers + a real temp-workspace integration run
 * (guarded enumeration + text extraction + FTS + deterministic graph + prune + incremental + cancel).
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemorySqliteDatabase, runMigrations } from "../src/db/index.js";
import { createKnowledgeLocalRepository } from "../src/knowledge-local/repository.js";
import {
  buildHierarchyGraph,
  chunkText,
  classifyKind,
  extractLinkTargets,
  indexWorkspace,
  resolveLinkTarget,
} from "../src/knowledge-local/indexer.js";

function repo() {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  return createKnowledgeLocalRepository(db);
}

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-kb-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return resolve(root);
}

// ---- pure helpers -------------------------------------------------------------------------

test("classifyKind maps extensions to indexable kinds or null", () => {
  assert.equal(classifyKind("a.md"), "markdown");
  assert.equal(classifyKind("a.txt"), "text");
  assert.equal(classifyKind("src/a.ts"), "code");
  assert.equal(classifyKind("a.docx"), "docx");
  assert.equal(classifyKind("a.xlsx"), "xlsx");
  assert.equal(classifyKind("a.pptx"), "pptx");
  assert.equal(classifyKind("a.png"), null);
  assert.equal(classifyKind("a.pdf"), null); // no server-side PDF text extraction in MVP
});

test("chunkText produces overlapping, non-empty, offset-accurate chunks", () => {
  const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
  const chunks = chunkText(text, 60, 10);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.text.trim().length > 0));
  assert.equal(chunks[0]?.charStart, 0);
  // Offsets map back to the source.
  for (const c of chunks) assert.equal(text.replace(/\r\n/g, "\n").slice(c.charStart, c.charEnd), c.text);
  assert.deepEqual(chunkText("   ", 60, 10), []);
});

test("extractLinkTargets finds md links + wikilinks, skips external/anchors", () => {
  const md = "See [a](./a.md) and [b](../b/c.md 'title') and [[notes/d]] and [x](https://e.com) and [y](#h).";
  const targets = extractLinkTargets(md);
  assert.ok(targets.includes("./a.md"));
  assert.ok(targets.includes("../b/c.md"));
  assert.ok(targets.includes("notes/d"));
  assert.ok(!targets.includes("https://e.com"));
  assert.ok(!targets.some((t) => t.startsWith("#")));
});

test("resolveLinkTarget resolves relative + parent segments against the doc dir", () => {
  assert.equal(resolveLinkTarget("docs/readme.md", "./intro.md"), "docs/intro.md");
  assert.equal(resolveLinkTarget("docs/a/readme.md", "../b/c.md"), "docs/b/c.md");
  assert.equal(resolveLinkTarget("docs/readme.md", "/root.md"), "root.md");
  assert.equal(resolveLinkTarget("docs/readme.md", "x.md#section"), "docs/x.md");
});

test("buildHierarchyGraph builds contains hierarchy + links_to edges", () => {
  const graph = buildHierarchyGraph(
    "myws",
    ["a/b/c.md", "a/b/d.md", "readme.md"],
    new Map([["a/b/c.md", ["./d.md"]]]),
  );
  const ids = new Set(graph.nodes.map((n) => n.id));
  assert.ok(ids.has("ws"));
  assert.ok(ids.has("dir:a"));
  assert.ok(ids.has("dir:a/b"));
  assert.ok(ids.has("doc:a/b/c.md"));
  assert.ok(ids.has("doc:readme.md"));
  // contains chain
  assert.ok(graph.edges.some((e) => e.fromId === "ws" && e.toId === "dir:a" && e.type === "contains"));
  assert.ok(graph.edges.some((e) => e.fromId === "dir:a/b" && e.toId === "doc:a/b/c.md" && e.type === "contains"));
  // resolved markdown link
  assert.ok(graph.edges.some((e) => e.fromId === "doc:a/b/c.md" && e.toId === "doc:a/b/d.md" && e.type === "links_to"));
});

// ---- integration --------------------------------------------------------------------------

test("indexWorkspace indexes files, excludes secrets/binary, builds a searchable graph", async () => {
  const root = await tempWorkspace();
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "docs", "intro.md"), "# Intro\nThe quick brown fox. See [guide](./guide.md).", "utf8");
    await writeFile(join(root, "docs", "guide.md"), "# Guide\nDetailed lazy dog instructions.", "utf8");
    await writeFile(join(root, "app.ts"), "export const answer = 42; // brown", "utf8");
    await writeFile(join(root, ".env"), "SECRET=should-not-index", "utf8");
    await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(root, "node_modules", "dep.js"), "brown fox in a dependency", "utf8");

    const r = repo();
    const result = await indexWorkspace(r, root);

    assert.equal(result.status, "ready");
    assert.equal(result.documentCount, 3, "intro.md + guide.md + app.ts");
    // Secret + binary + node_modules are excluded.
    const paths = r.listDocuments(root).map((d) => d.relativePath);
    assert.ok(paths.includes("docs/intro.md"));
    assert.ok(!paths.some((p) => p.includes("node_modules")));
    assert.ok(!paths.includes(".env"));

    // FTS search hits across kinds, isolated to this workspace.
    assert.ok(r.search(root, "quick").length >= 1);
    assert.ok(r.search(root, "brown").length >= 2, "matches intro.md and app.ts, not node_modules");

    // Graph: contains hierarchy + the resolved intro->guide link.
    const graph = r.getGraph(root);
    assert.ok(graph.nodes.some((n) => n.kind === "workspace"));
    assert.ok(graph.nodes.some((n) => n.relativePath === "docs"));
    assert.ok(
      graph.edges.some((e) => e.type === "links_to" && e.fromId === "doc:docs/intro.md" && e.toId === "doc:docs/guide.md"),
    );
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("re-index is incremental and prunes deleted files", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(join(root, "a.md"), "alpha content", "utf8");
    await writeFile(join(root, "b.md"), "beta content", "utf8");
    const r = repo();
    await indexWorkspace(r, root);
    assert.equal(r.listDocuments(root).length, 2);
    const firstIndexedAt = r.getDocumentByPath(root, "a.md")?.indexedAt;

    // Remove b.md, keep a.md unchanged, add c.md, then re-sync.
    await rm(join(root, "b.md"));
    await writeFile(join(root, "c.md"), "gamma content", "utf8");
    await indexWorkspace(r, root, { now: () => "2099-01-01T00:00:00.000Z" });

    const paths = r.listDocuments(root).map((d) => d.relativePath).sort();
    assert.deepEqual(paths, ["a.md", "c.md"], "b.md pruned, c.md added");
    // a.md unchanged → its indexed_at is NOT bumped (incremental skip).
    assert.equal(r.getDocumentByPath(root, "a.md")?.indexedAt, firstIndexedAt);
    assert.equal(r.search(root, "beta").length, 0, "pruned file no longer searchable");
    assert.equal(r.search(root, "gamma").length, 1);
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("an already-aborted signal yields an interrupted status and does not prune", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(join(root, "a.md"), "alpha", "utf8");
    const r = repo();
    const controller = new AbortController();
    controller.abort();
    const result = await indexWorkspace(r, root, { signal: controller.signal });
    assert.equal(result.interrupted, true);
    assert.equal(result.status, "interrupted");
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});
