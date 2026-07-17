/**
 * SQLite repository for the local Knowledge Base + Knowledge Graph (MVP).
 *
 * Prepared-statement closures over the shared `cowork-ghc.db` (same pattern as
 * `sqlite-repositories.ts`). Every query is scoped by `workspace_root`; nothing crosses workspaces.
 * The FTS5 mirror (`knowledge_fts`) is kept in sync here — callers never touch it directly.
 */

import type { SqliteDatabase } from "../db/sqlite.js";
import type {
  KnowledgeChunkRow,
  KnowledgeDocumentRow,
  KnowledgeGraphEdgeRow,
  KnowledgeGraphNodeRow,
  KnowledgeIndexStateRow,
  KnowledgeSearchHit,
} from "./types.js";
import { KNOWLEDGE_GRAPH_MAX_NODES, KNOWLEDGE_SEARCH_DEFAULT_LIMIT } from "./types.js";

/**
 * Turn a raw user query into a safe FTS5 MATCH expression: split into word tokens (Unicode-aware),
 * quote each to neutralise FTS operators, and prefix-match (AND semantics). Returns null when the
 * query has no searchable token, so callers can short-circuit instead of throwing on empty MATCH.
 */
export function buildFtsMatch(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

export interface KnowledgeGraphView {
  readonly nodes: readonly KnowledgeGraphNodeRow[];
  readonly edges: readonly KnowledgeGraphEdgeRow[];
  readonly truncated: boolean;
}

export interface KnowledgeLocalRepository {
  getState(workspaceRoot: string): KnowledgeIndexStateRow | null;
  setState(row: KnowledgeIndexStateRow): void;
  getDocumentByPath(workspaceRoot: string, relativePath: string): KnowledgeDocumentRow | null;
  listDocuments(workspaceRoot: string): readonly KnowledgeDocumentRow[];
  upsertDocument(doc: KnowledgeDocumentRow): void;
  deleteDocument(id: string): void;
  replaceChunks(
    documentId: string,
    relativePath: string,
    chunks: readonly KnowledgeChunkRow[],
  ): void;
  search(workspaceRoot: string, query: string, limit?: number): readonly KnowledgeSearchHit[];
  replaceGraph(
    workspaceRoot: string,
    nodes: readonly KnowledgeGraphNodeRow[],
    edges: readonly KnowledgeGraphEdgeRow[],
  ): void;
  getGraph(workspaceRoot: string, limit?: number): KnowledgeGraphView;
  counts(workspaceRoot: string): {
    documents: number;
    chunks: number;
    nodes: number;
    edges: number;
  };
  clearWorkspace(workspaceRoot: string): void;
  /** Run `fn` inside a single write transaction (used by the indexer for atomic per-file writes). */
  transaction<T>(fn: () => T): T;
}

export function createKnowledgeLocalRepository(db: SqliteDatabase): KnowledgeLocalRepository {
  const getStateStmt = db.prepare(
    `SELECT workspace_root AS workspaceRoot, status, document_count AS documentCount,
       chunk_count AS chunkCount, node_count AS nodeCount, edge_count AS edgeCount,
       last_indexed_at AS lastIndexedAt, error, updated_at AS updatedAt
     FROM knowledge_index_state WHERE workspace_root = ?`,
  );
  const setStateStmt = db.prepare(
    `INSERT INTO knowledge_index_state
       (workspace_root, status, document_count, chunk_count, node_count, edge_count, last_indexed_at, error, updated_at)
     VALUES (@workspaceRoot, @status, @documentCount, @chunkCount, @nodeCount, @edgeCount, @lastIndexedAt, @error, @updatedAt)
     ON CONFLICT(workspace_root) DO UPDATE SET
       status = excluded.status, document_count = excluded.document_count, chunk_count = excluded.chunk_count,
       node_count = excluded.node_count, edge_count = excluded.edge_count,
       last_indexed_at = excluded.last_indexed_at, error = excluded.error, updated_at = excluded.updated_at`,
  );

  const getDocByPathStmt = db.prepare(
    `SELECT id, workspace_root AS workspaceRoot, relative_path AS relativePath, title, kind,
       size_bytes AS sizeBytes, content_hash AS contentHash, indexed_at AS indexedAt
     FROM knowledge_documents WHERE workspace_root = ? AND relative_path = ?`,
  );
  const listDocsStmt = db.prepare(
    `SELECT id, workspace_root AS workspaceRoot, relative_path AS relativePath, title, kind,
       size_bytes AS sizeBytes, content_hash AS contentHash, indexed_at AS indexedAt
     FROM knowledge_documents WHERE workspace_root = ? ORDER BY relative_path ASC`,
  );
  const upsertDocStmt = db.prepare(
    `INSERT INTO knowledge_documents
       (id, workspace_root, relative_path, title, kind, size_bytes, content_hash, indexed_at)
     VALUES (@id, @workspaceRoot, @relativePath, @title, @kind, @sizeBytes, @contentHash, @indexedAt)
     ON CONFLICT(workspace_root, relative_path) DO UPDATE SET
       id = excluded.id, title = excluded.title, kind = excluded.kind, size_bytes = excluded.size_bytes,
       content_hash = excluded.content_hash, indexed_at = excluded.indexed_at`,
  );
  const deleteDocStmt = db.prepare("DELETE FROM knowledge_documents WHERE id = ?");

  const deleteChunksStmt = db.prepare("DELETE FROM knowledge_chunks WHERE document_id = ?");
  const deleteFtsByDocStmt = db.prepare("DELETE FROM knowledge_fts WHERE document_id = ?");
  const insertChunkStmt = db.prepare(
    `INSERT INTO knowledge_chunks (id, document_id, workspace_root, ordinal, char_start, char_end, text)
     VALUES (@id, @documentId, @workspaceRoot, @ordinal, @charStart, @charEnd, @text)`,
  );
  const insertFtsStmt = db.prepare(
    `INSERT INTO knowledge_fts (text, relative_path, workspace_root, document_id, chunk_id)
     VALUES (@text, @relativePath, @workspaceRoot, @documentId, @chunkId)`,
  );

  // FTS5 aux functions (bm25/snippet) and MATCH require the FTS table's real name, not an alias.
  const searchStmt = db.prepare(
    `SELECT knowledge_fts.document_id AS documentId, knowledge_fts.chunk_id AS chunkId,
       knowledge_fts.relative_path AS relativePath, d.title AS title, d.kind AS kind, c.ordinal AS ordinal,
       bm25(knowledge_fts) AS score, snippet(knowledge_fts, 0, '«', '»', '…', 12) AS snippet
     FROM knowledge_fts
     JOIN knowledge_documents d ON d.id = knowledge_fts.document_id
     JOIN knowledge_chunks c ON c.id = knowledge_fts.chunk_id
     WHERE knowledge_fts MATCH @match AND knowledge_fts.workspace_root = @ws
     ORDER BY score ASC
     LIMIT @limit`,
  );

  const clearNodesStmt = db.prepare("DELETE FROM knowledge_nodes WHERE workspace_root = ?");
  const clearEdgesStmt = db.prepare("DELETE FROM knowledge_edges WHERE workspace_root = ?");
  const insertNodeStmt = db.prepare(
    `INSERT INTO knowledge_nodes (id, workspace_root, kind, label, relative_path)
     VALUES (@id, @workspaceRoot, @kind, @label, @relativePath)`,
  );
  const insertEdgeStmt = db.prepare(
    `INSERT OR IGNORE INTO knowledge_edges (id, workspace_root, from_id, to_id, type)
     VALUES (@id, @workspaceRoot, @fromId, @toId, @type)`,
  );
  const listNodesStmt = db.prepare(
    `SELECT id, workspace_root AS workspaceRoot, kind, label, relative_path AS relativePath
     FROM knowledge_nodes WHERE workspace_root = ?
     ORDER BY CASE kind WHEN 'workspace' THEN 0 WHEN 'folder' THEN 1 ELSE 2 END, label ASC
     LIMIT ?`,
  );
  const countNodesStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM knowledge_nodes WHERE workspace_root = ?",
  );
  const listEdgesStmt = db.prepare(
    `SELECT id, workspace_root AS workspaceRoot, from_id AS fromId, to_id AS toId, type
     FROM knowledge_edges WHERE workspace_root = ?`,
  );

  const countDocsStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM knowledge_documents WHERE workspace_root = ?",
  );
  const countChunksStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM knowledge_chunks WHERE workspace_root = ?",
  );
  const countEdgesStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM knowledge_edges WHERE workspace_root = ?",
  );

  const clearFtsStmt = db.prepare("DELETE FROM knowledge_fts WHERE workspace_root = ?");
  const clearDocsStmt = db.prepare("DELETE FROM knowledge_documents WHERE workspace_root = ?");
  const clearStateStmt = db.prepare("DELETE FROM knowledge_index_state WHERE workspace_root = ?");

  const num = (stmt: import("better-sqlite3").Statement, arg: string): number =>
    (stmt.get(arg) as { n: number }).n;

  return {
    getState(workspaceRoot) {
      return (getStateStmt.get(workspaceRoot) as KnowledgeIndexStateRow | undefined) ?? null;
    },
    setState(row) {
      setStateStmt.run(row);
    },
    getDocumentByPath(workspaceRoot, relativePath) {
      return (
        (getDocByPathStmt.get(workspaceRoot, relativePath) as KnowledgeDocumentRow | undefined) ??
        null
      );
    },
    listDocuments(workspaceRoot) {
      return listDocsStmt.all(workspaceRoot) as KnowledgeDocumentRow[];
    },
    upsertDocument(doc) {
      upsertDocStmt.run(doc);
    },
    deleteDocument(id) {
      deleteFtsByDocStmt.run(id);
      deleteChunksStmt.run(id); // explicit even though FK cascades — keeps FTS/chunks in lockstep
      deleteDocStmt.run(id);
    },
    replaceChunks(documentId, relativePath, chunks) {
      deleteFtsByDocStmt.run(documentId);
      deleteChunksStmt.run(documentId);
      for (const chunk of chunks) {
        insertChunkStmt.run(chunk);
        insertFtsStmt.run({
          text: chunk.text,
          relativePath,
          workspaceRoot: chunk.workspaceRoot,
          documentId: chunk.documentId,
          chunkId: chunk.id,
        });
      }
    },
    search(workspaceRoot, query, limit = KNOWLEDGE_SEARCH_DEFAULT_LIMIT) {
      const match = buildFtsMatch(query);
      if (match === null) return [];
      return searchStmt.all({ match, ws: workspaceRoot, limit }) as KnowledgeSearchHit[];
    },
    replaceGraph(workspaceRoot, nodes, edges) {
      clearEdgesStmt.run(workspaceRoot);
      clearNodesStmt.run(workspaceRoot);
      for (const node of nodes) insertNodeStmt.run(node);
      for (const edge of edges) insertEdgeStmt.run(edge);
    },
    getGraph(workspaceRoot, limit = KNOWLEDGE_GRAPH_MAX_NODES) {
      const total = num(countNodesStmt, workspaceRoot);
      const nodes = listNodesStmt.all(workspaceRoot, limit) as KnowledgeGraphNodeRow[];
      const ids = new Set(nodes.map((n) => n.id));
      const allEdges = listEdgesStmt.all(workspaceRoot) as KnowledgeGraphEdgeRow[];
      const edges = allEdges.filter((e) => ids.has(e.fromId) && ids.has(e.toId));
      return { nodes, edges, truncated: total > nodes.length };
    },
    counts(workspaceRoot) {
      return {
        documents: num(countDocsStmt, workspaceRoot),
        chunks: num(countChunksStmt, workspaceRoot),
        nodes: num(countNodesStmt, workspaceRoot),
        edges: num(countEdgesStmt, workspaceRoot),
      };
    },
    clearWorkspace(workspaceRoot) {
      clearFtsStmt.run(workspaceRoot);
      clearDocsStmt.run(workspaceRoot); // cascades chunks
      clearNodesStmt.run(workspaceRoot);
      clearEdgesStmt.run(workspaceRoot);
      clearStateStmt.run(workspaceRoot);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}
