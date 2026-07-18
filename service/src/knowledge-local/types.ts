/**
 * Local Knowledge Base + Knowledge Graph types (MVP, local-first).
 *
 * This is the LOCAL knowledge subsystem built on the embedded SQLite database — distinct from the
 * dormant external M365 Knowledge Graph client under `service/src/knowledge/`. Everything here is
 * derived from files inside the active workspace (via the WorkspaceGuard) and stored locally; no
 * external service, no embeddings, no provider call is required to build or query it.
 */

/** Lifecycle of a workspace's local index (drives the surface's status chip + next action). */
export type KnowledgeIndexStatus =
  | "not_initialized"
  | "indexing"
  | "ready"
  | "stale"
  | "partial"
  | "interrupted"
  | "error";

/**
 * Where a piece of Knowledge came from. Knowledge is ONE unified store per active workspace; a
 * source is a provenance tag on each document/hit/node — never a separate screen. The workspace's
 * own files are the default source; Microsoft 365 (OneDrive/SharePoint/Teams/Outlook) is a future
 * source that will ingest INTO the same store. This contract is forward-compatible today: the MVP
 * only ever emits `workspace`, but the renderer can already show provenance and offer a source
 * filter without any schema migration.
 */
export type KnowledgeSourceType = "workspace" | "microsoft365";

/** Fine-grained Microsoft 365 origin, when known. `null` for plain workspace files. */
export type KnowledgeSourceDetail = "onedrive" | "sharepoint" | "teams" | "outlook";

/** Provenance tag carried by every document/search hit/graph node. */
export interface KnowledgeSourceRef {
  readonly type: KnowledgeSourceType;
  readonly detail: KnowledgeSourceDetail | null;
  /** Short human label for the source badge, e.g. "Workspace", "OneDrive". */
  readonly label: string;
}

/** The workspace-local provenance every MVP document carries. */
export const WORKSPACE_SOURCE: KnowledgeSourceRef = {
  type: "workspace",
  detail: null,
  label: "Workspace",
};

/** Compact per-source rollup for the header's honest source summary + the source filter. */
export interface KnowledgeSourceSummary {
  readonly type: KnowledgeSourceType;
  readonly label: string;
  /** Whether this source is connected/configured. Microsoft 365 is `false` in the MVP. */
  readonly connected: boolean;
  readonly documentCount: number;
}

/** Document kinds we index; mirrors the safe reader's extractable kinds. */
export type KnowledgeDocumentKind = "markdown" | "text" | "code" | "docx" | "xlsx" | "pptx";

/** One indexed source file (metadata only — chunk text lives in `knowledge_chunks`). */
export interface KnowledgeDocumentRow {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly title: string;
  readonly kind: KnowledgeDocumentKind;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly indexedAt: string;
}

/** One text chunk of a document (the searchable unit). */
export interface KnowledgeChunkRow {
  readonly id: string;
  readonly documentId: string;
  readonly workspaceRoot: string;
  readonly ordinal: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly text: string;
}

/** A search result: the matching chunk + its document, with a highlighted snippet (repo row). */
export interface KnowledgeSearchHit {
  readonly documentId: string;
  readonly chunkId: string;
  readonly relativePath: string;
  readonly title: string;
  readonly kind: KnowledgeDocumentKind;
  readonly ordinal: number;
  /** FTS snippet with matched terms wrapped in «…» markers (renderer-safe plain text). */
  readonly snippet: string;
  /** bm25 score (lower = better match); exposed for deterministic ordering only. */
  readonly score: number;
}

/** A search hit projected for the renderer, with provenance attached (see {@link KnowledgeSourceRef}). */
export interface KnowledgeSearchHitView extends KnowledgeSearchHit {
  readonly source: KnowledgeSourceRef;
}

/** A graph node — workspace / folder / document. */
export interface KnowledgeGraphNodeRow {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly kind: "workspace" | "folder" | "document";
  readonly label: string;
  readonly relativePath: string | null;
}

/** A directed, typed graph edge. Deterministic (never LLM-inferred). */
export interface KnowledgeGraphEdgeRow {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly fromId: string;
  readonly toId: string;
  readonly type: KnowledgeEdgeType;
}

/** The deterministic relations the MVP derives. */
export type KnowledgeEdgeType = "contains" | "links_to";

/** Persisted per-workspace index state + counts. */
export interface KnowledgeIndexStateRow {
  readonly workspaceRoot: string;
  readonly status: KnowledgeIndexStatus;
  readonly documentCount: number;
  readonly chunkCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly lastIndexedAt: string | null;
  readonly error: string | null;
  readonly updatedAt: string;
}

/** Bound on graph nodes returned to the renderer (keeps the SVG view responsive). */
export const KNOWLEDGE_GRAPH_MAX_NODES = 120;

/** Default max search hits returned. */
export const KNOWLEDGE_SEARCH_DEFAULT_LIMIT = 30;

// ---- Client-facing DTOs (types-only; safe to import from the renderer) ---------------------

/** Non-secret index status projection returned by the local-knowledge router. */
export interface KnowledgeIndexView {
  readonly status: KnowledgeIndexStatus;
  readonly hasWorkspace: boolean;
  readonly documentCount: number;
  readonly chunkCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly lastIndexedAt: string | null;
  readonly error: string | null;
  /** Present only while a job is running, so the renderer can show real progress. */
  readonly indexing: { readonly processed: number; readonly total: number | null } | null;
  /** Per-source rollup (workspace + honest Microsoft 365 readiness). Drives the source summary + filter. */
  readonly sources: readonly KnowledgeSourceSummary[];
}

/** One indexed document, projected for the renderer's document list (no secret bytes, no raw text). */
export interface KnowledgeDocumentView {
  readonly id: string;
  readonly relativePath: string;
  readonly title: string;
  readonly kind: KnowledgeDocumentKind;
  readonly chunkCount: number;
  readonly sizeBytes: number;
  readonly indexedAt: string;
  /** Provenance of this document (workspace-local in the MVP). */
  readonly source: KnowledgeSourceRef;
}

export interface KnowledgeGraphApiNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly relativePath: string | null;
  /** Provenance of this node (workspace-local in the MVP). */
  readonly source: KnowledgeSourceRef;
}
export interface KnowledgeGraphApiEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}
export interface KnowledgeGraphApiResult {
  readonly nodes: readonly KnowledgeGraphApiNode[];
  readonly edges: readonly KnowledgeGraphApiEdge[];
  readonly truncated: boolean;
}
