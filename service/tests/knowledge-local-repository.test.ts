/**
 * Unit tests for the local Knowledge Base repository (SQLite + FTS5 + graph tables).
 * Uses an in-memory DB with the real migrations, so FTS5 + workspace scoping are exercised for real.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemorySqliteDatabase, runMigrations } from "../src/db/index.js";
import {
  buildFtsMatch,
  createKnowledgeLocalRepository,
  type KnowledgeLocalRepository,
} from "../src/knowledge-local/repository.js";
import type {
  KnowledgeChunkRow,
  KnowledgeDocumentRow,
  KnowledgeGraphEdgeRow,
  KnowledgeGraphNodeRow,
} from "../src/knowledge-local/types.js";

const WS = "C:\\ws";
const OTHER = "C:\\other";

function repo(): KnowledgeLocalRepository {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  return createKnowledgeLocalRepository(db);
}

function doc(over: Partial<KnowledgeDocumentRow> = {}): KnowledgeDocumentRow {
  return {
    id: "doc-1",
    workspaceRoot: WS,
    relativePath: "notes/readme.md",
    title: "readme.md",
    kind: "markdown",
    sizeBytes: 42,
    contentHash: "hash-1",
    indexedAt: "2026-07-18T00:00:00.000Z",
    ...over,
  };
}

function chunk(over: Partial<KnowledgeChunkRow> = {}): KnowledgeChunkRow {
  return {
    id: "chunk-1",
    documentId: "doc-1",
    workspaceRoot: WS,
    ordinal: 0,
    charStart: 0,
    charEnd: 10,
    text: "hello world",
    ...over,
  };
}

test("buildFtsMatch tokenizes into prefix AND terms and returns null on empty", () => {
  assert.equal(buildFtsMatch("hello world"), '"hello"* "world"*');
  assert.equal(buildFtsMatch("  Tài  liệu  "), '"tài"* "liệu"*');
  assert.equal(buildFtsMatch(""), null);
  assert.equal(buildFtsMatch("   "), null);
  assert.equal(buildFtsMatch("!!! *** ()"), null);
  // FTS operators in raw input cannot leak through as syntax.
  assert.equal(buildFtsMatch('foo" OR bar'), '"foo"* "or"* "bar"*');
});

test("index state upsert + read roundtrips", () => {
  const r = repo();
  assert.equal(r.getState(WS), null);
  r.setState({
    workspaceRoot: WS,
    status: "ready",
    documentCount: 3,
    chunkCount: 9,
    nodeCount: 4,
    edgeCount: 3,
    lastIndexedAt: "2026-07-18T00:00:00.000Z",
    error: null,
    updatedAt: "2026-07-18T00:00:00.000Z",
  });
  const state = r.getState(WS);
  assert.equal(state?.status, "ready");
  assert.equal(state?.documentCount, 3);
  assert.equal(state?.chunkCount, 9);
});

test("document upsert, lookup by path, and list", () => {
  const r = repo();
  r.upsertDocument(doc());
  assert.equal(r.getDocumentByPath(WS, "notes/readme.md")?.title, "readme.md");
  assert.equal(r.getDocumentByPath(WS, "missing.md"), null);
  // Upsert on the same (workspace, path) replaces in place.
  r.upsertDocument(doc({ id: "doc-1b", title: "readme (v2)", contentHash: "hash-2" }));
  const list = r.listDocuments(WS);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.title, "readme (v2)");
});

test("replaceChunks feeds FTS and search returns a snippet with the document path", () => {
  const r = repo();
  r.upsertDocument(doc());
  r.replaceChunks("doc-1", "notes/readme.md", [
    chunk({ id: "c1", text: "the quick brown fox jumps" }),
    chunk({ id: "c2", ordinal: 1, text: "over the lazy dog" }),
  ]);
  const hits = r.search(WS, "quick");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.relativePath, "notes/readme.md");
  assert.equal(hits[0]?.title, "readme.md");
  assert.match(hits[0]?.snippet ?? "", /«quick»/);
  // Prefix matching: "laz" finds "lazy".
  assert.equal(r.search(WS, "laz").length, 1);
  // AND semantics: both terms must be present (in the doc, across chunks -> still matches per chunk).
  assert.equal(r.search(WS, "quick fox").length, 1);
  assert.equal(r.search(WS, "quick zebra").length, 0);
  // Empty/garbage query never throws and yields nothing.
  assert.deepEqual(r.search(WS, "   "), []);
});

test("search and graph are isolated per workspace", () => {
  const r = repo();
  r.upsertDocument(doc({ id: "d-ws", workspaceRoot: WS, relativePath: "a.md" }));
  r.replaceChunks("d-ws", "a.md", [chunk({ id: "cw", workspaceRoot: WS, documentId: "d-ws", text: "alpha secret" })]);
  r.upsertDocument(doc({ id: "d-other", workspaceRoot: OTHER, relativePath: "a.md" }));
  r.replaceChunks("d-other", "a.md", [
    chunk({ id: "co", workspaceRoot: OTHER, documentId: "d-other", text: "alpha secret" }),
  ]);
  assert.equal(r.search(WS, "alpha").length, 1);
  assert.equal(r.search(OTHER, "alpha").length, 1);
  assert.equal(r.search(WS, "alpha")[0]?.documentId, "d-ws");
});

test("replaceGraph + getGraph returns nodes with only in-set edges and a truncation flag", () => {
  const r = repo();
  const nodes: KnowledgeGraphNodeRow[] = [
    { id: "ws", workspaceRoot: WS, kind: "workspace", label: "ws", relativePath: null },
    { id: "f1", workspaceRoot: WS, kind: "folder", label: "notes", relativePath: "notes" },
    { id: "d1", workspaceRoot: WS, kind: "document", label: "readme.md", relativePath: "notes/readme.md" },
  ];
  const edges: KnowledgeGraphEdgeRow[] = [
    { id: "e1", workspaceRoot: WS, fromId: "ws", toId: "f1", type: "contains" },
    { id: "e2", workspaceRoot: WS, fromId: "f1", toId: "d1", type: "contains" },
  ];
  r.replaceGraph(WS, nodes, edges);
  const full = r.getGraph(WS, 10);
  assert.equal(full.nodes.length, 3);
  assert.equal(full.edges.length, 2);
  assert.equal(full.truncated, false);
  // Truncated: limiting nodes drops edges whose endpoint is not in the returned set.
  const limited = r.getGraph(WS, 2);
  assert.equal(limited.nodes.length, 2);
  assert.equal(limited.truncated, true);
  assert.ok(limited.edges.every((e) => limited.nodes.some((n) => n.id === e.fromId)));
});

test("deleteDocument drops its chunks + FTS rows", () => {
  const r = repo();
  r.upsertDocument(doc());
  r.replaceChunks("doc-1", "notes/readme.md", [chunk({ id: "c1", text: "findme token" })]);
  assert.equal(r.search(WS, "findme").length, 1);
  r.deleteDocument("doc-1");
  assert.equal(r.search(WS, "findme").length, 0);
  assert.equal(r.listDocuments(WS).length, 0);
});

test("clearWorkspace wipes docs, chunks, fts, graph and state for that workspace only", () => {
  const r = repo();
  r.upsertDocument(doc({ id: "d-ws", relativePath: "a.md" }));
  r.replaceChunks("d-ws", "a.md", [chunk({ id: "cw", documentId: "d-ws", text: "keepword" })]);
  r.replaceGraph(WS, [{ id: "ws", workspaceRoot: WS, kind: "workspace", label: "ws", relativePath: null }], []);
  r.setState({
    workspaceRoot: WS, status: "ready", documentCount: 1, chunkCount: 1, nodeCount: 1, edgeCount: 0,
    lastIndexedAt: "x", error: null, updatedAt: "x",
  });
  // A second workspace must survive.
  r.upsertDocument(doc({ id: "d-other", workspaceRoot: OTHER, relativePath: "a.md" }));
  r.replaceChunks("d-other", "a.md", [chunk({ id: "co", workspaceRoot: OTHER, documentId: "d-other", text: "keepword" })]);

  r.clearWorkspace(WS);
  assert.equal(r.search(WS, "keepword").length, 0);
  assert.equal(r.listDocuments(WS).length, 0);
  assert.equal(r.getGraph(WS).nodes.length, 0);
  assert.equal(r.getState(WS), null);
  assert.equal(r.counts(WS).chunks, 0);
  // Other workspace intact.
  assert.equal(r.search(OTHER, "keepword").length, 1);
});

test("counts reflect inserted rows", () => {
  const r = repo();
  r.upsertDocument(doc());
  r.replaceChunks("doc-1", "notes/readme.md", [
    chunk({ id: "c1", text: "one" }),
    chunk({ id: "c2", ordinal: 1, text: "two" }),
  ]);
  const c = r.counts(WS);
  assert.equal(c.documents, 1);
  assert.equal(c.chunks, 2);
});
