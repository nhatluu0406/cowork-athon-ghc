/**
 * Local Knowledge indexer (MVP) — enumerate → read → extract → chunk → persist + deterministic graph.
 *
 * Reuses the existing SAFE workspace APIs only: `listWorkspaceChildren` (guarded, symlink-confined
 * enumeration) and `readWorkspaceFileContent` (guarded read + text extraction for md/text/code/docx/
 * xlsx/pptx). Secret-like files are excluded up front. The whole run is bounded (file count, file
 * size, chunk count, recursion depth) and cancellable via an AbortSignal so it never hangs the
 * service or the renderer. No network, no embeddings, no LLM — the graph edges are derived purely
 * from the folder hierarchy and Markdown links.
 */

import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { isTextFilePath, languageForPath } from "@cowork-ghc/contracts";
import { listWorkspaceChildren } from "../workspace/list.js";
import { readWorkspaceFileContent, type WorkspaceFileContentResult } from "../workspace/file-content.js";
import { isSecretLikeAttachmentPath } from "../workspace/attachment-secret-policy.js";
import type {
  KnowledgeChunkRow,
  KnowledgeDocumentKind,
  KnowledgeGraphEdgeRow,
  KnowledgeGraphNodeRow,
  KnowledgeIndexStatus,
} from "./types.js";
import type { KnowledgeLocalRepository } from "./repository.js";

const OFFICE_KIND: Readonly<Record<string, KnowledgeDocumentKind>> = {
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".pptx": "pptx",
};

/** Directories never worth indexing (VCS/build/deps/caches). Any dot-directory is also skipped. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "__pycache__",
]);

export interface IndexOptions {
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxDepth?: number;
  readonly maxChunksPerDoc?: number;
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: IndexProgress) => void;
  readonly now?: () => string;
}

export interface IndexProgress {
  readonly phase: "enumerate" | "index" | "graph" | "done";
  readonly processed: number;
  readonly total: number | null;
}

export interface IndexResult {
  readonly status: KnowledgeIndexStatus;
  readonly documentCount: number;
  readonly chunkCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly skipped: number;
  readonly interrupted: boolean;
}

interface ChunkSpan {
  readonly ordinal: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly text: string;
}

/** Classify a workspace-relative path into an indexable document kind, or null if not indexable. */
export function classifyKind(relativePath: string): KnowledgeDocumentKind | null {
  const ext = extname(relativePath).toLowerCase();
  if (ext in OFFICE_KIND) return OFFICE_KIND[ext] ?? null;
  if (!isTextFilePath(relativePath)) return null;
  const language = languageForPath(relativePath);
  if (language === "markdown") return "markdown";
  if (language === "plaintext" || language === undefined) return "text";
  return "code";
}

/** Split text into overlapping, newline-aware chunks with exact character offsets. */
export function chunkText(
  raw: string,
  size = 1600,
  overlap = 200,
  maxChunks = 400,
): readonly ChunkSpan[] {
  const clean = raw.replace(/\r\n/g, "\n");
  const chunks: ChunkSpan[] = [];
  if (clean.trim().length === 0) return chunks;
  let start = 0;
  let ordinal = 0;
  while (start < clean.length && chunks.length < maxChunks) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const nl = clean.lastIndexOf("\n", end);
      if (nl > start + Math.floor(size / 2)) end = nl;
    }
    const text = clean.slice(start, end);
    if (text.trim().length > 0) {
      chunks.push({ ordinal: ordinal++, charStart: start, charEnd: end, text });
    }
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Extract raw link targets from Markdown: `[label](target)` and `[[wikilink]]` (external skipped). */
export function extractLinkTargets(markdown: string): readonly string[] {
  const targets = new Set<string>();
  for (const m of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = (m[1] ?? "").trim().split(/\s+/)[0] ?? "";
    if (raw.length === 0) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith("#") || raw.startsWith("mailto:")) {
      continue;
    }
    targets.add(raw);
  }
  for (const m of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const raw = (m[1] ?? "").split("|")[0]?.trim() ?? "";
    if (raw.length > 0) targets.add(raw);
  }
  return [...targets];
}

/** Resolve a link target against the linking document's directory into a normalized ws-relative path. */
export function resolveLinkTarget(fromRelativePath: string, target: string): string | null {
  const cleaned = target.split(/[#?]/)[0]?.replace(/\\/g, "/").trim() ?? "";
  if (cleaned.length === 0) return null;
  const fromDir = fromRelativePath.replace(/\\/g, "/").split("/").slice(0, -1);
  const base = cleaned.startsWith("/") ? [] : fromDir;
  const segments = cleaned.replace(/^\//, "").split("/");
  const out: string[] = [...base];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length > 0 ? out.join("/") : null;
}

const nodeId = (kind: "ws" | "dir" | "doc", relativePath: string): string =>
  kind === "ws" ? "ws" : `${kind}:${relativePath}`;

/**
 * Build the deterministic node/edge set: workspace → folder → document `contains` hierarchy plus
 * `links_to` edges for Markdown links whose resolved target is itself an indexed document.
 */
export function buildHierarchyGraph(
  rootName: string,
  documentPaths: readonly string[],
  markdownLinks: ReadonlyMap<string, readonly string[]>,
): { nodes: Array<Omit<KnowledgeGraphNodeRow, "workspaceRoot">>; edges: Array<Omit<KnowledgeGraphEdgeRow, "workspaceRoot" | "id">> } {
  const nodes = new Map<string, Omit<KnowledgeGraphNodeRow, "workspaceRoot">>();
  const edges = new Map<string, Omit<KnowledgeGraphEdgeRow, "workspaceRoot" | "id">>();
  const indexed = new Set(documentPaths.map((p) => p.replace(/\\/g, "/")));

  nodes.set("ws", { id: "ws", kind: "workspace", label: rootName || "workspace", relativePath: null });

  const addEdge = (fromId: string, toId: string, type: KnowledgeGraphEdgeRow["type"]): void => {
    if (fromId === toId) return;
    edges.set(`${type}:${fromId}->${toId}`, { fromId, toId, type });
  };

  for (const rawPath of indexed) {
    const segments = rawPath.split("/").filter((s) => s.length > 0);
    let parentId = "ws";
    let accum = "";
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i] ?? "";
      accum = accum.length === 0 ? seg : `${accum}/${seg}`;
      const isLeafFile = i === segments.length - 1;
      const id = isLeafFile ? nodeId("doc", accum) : nodeId("dir", accum);
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          kind: isLeafFile ? "document" : "folder",
          label: seg,
          relativePath: accum,
        });
      }
      addEdge(parentId, id, "contains");
      parentId = id;
    }
  }

  for (const [fromPath, targets] of markdownLinks) {
    const fromId = nodeId("doc", fromPath.replace(/\\/g, "/"));
    if (!nodes.has(fromId)) continue;
    for (const target of targets) {
      const resolved = resolveLinkTarget(fromPath, target);
      if (resolved === null) continue;
      const candidates = [resolved, `${resolved}.md`, `${resolved}.markdown`];
      const hit = candidates.find((c) => indexed.has(c));
      if (hit === undefined) continue;
      addEdge(fromId, nodeId("doc", hit), "links_to");
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Extract plain searchable text from a read result (empty string when nothing is extractable). */
function extractText(result: WorkspaceFileContentResult): string {
  switch (result.kind) {
    case "text":
    case "docx":
      return result.content ?? "";
    case "spreadsheet":
      return (result.sheets ?? [])
        .map((s) => `# ${s.name}\n${s.rows.map((r) => r.join("\t")).join("\n")}`)
        .join("\n\n");
    case "presentation":
      return (result.slides ?? [])
        .map((sl) => [sl.title, sl.text].filter((t) => t.length > 0).join("\n"))
        .join("\n\n");
    default:
      return "";
  }
}

interface EnumeratedFile {
  readonly relativePath: string;
  readonly kind: KnowledgeDocumentKind;
  readonly sizeBytes: number;
}

async function enumerateFiles(
  workspaceRoot: string,
  options: Required<Pick<IndexOptions, "maxFiles" | "maxFileBytes" | "maxDepth">>,
  signal: AbortSignal | undefined,
): Promise<{ files: EnumeratedFile[]; skipped: number; truncated: boolean }> {
  const files: EnumeratedFile[] = [];
  let skipped = 0;
  let truncated = false;
  const queue: Array<{ relativePath: string; depth: number }> = [{ relativePath: "", depth: 0 }];

  while (queue.length > 0) {
    if (signal?.aborted === true) break;
    const dir = queue.shift();
    if (dir === undefined) break;
    if (dir.depth > options.maxDepth) continue;
    let listing;
    try {
      listing = await listWorkspaceChildren(workspaceRoot, { relativePath: dir.relativePath, limit: 500 });
    } catch {
      continue; // unreadable folder: skip, do not abort the whole index
    }
    for (const entry of listing.entries) {
      if (files.length >= options.maxFiles) {
        truncated = true;
        break;
      }
      if (entry.kind === "folder") {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        queue.push({ relativePath: entry.relativePath, depth: dir.depth + 1 });
        continue;
      }
      if (isSecretLikeAttachmentPath(entry.relativePath)) {
        skipped += 1;
        continue;
      }
      const kind = classifyKind(entry.relativePath);
      if (kind === null) {
        skipped += 1;
        continue;
      }
      if ((entry.sizeBytes ?? 0) > options.maxFileBytes) {
        skipped += 1;
        continue;
      }
      files.push({ relativePath: entry.relativePath, kind, sizeBytes: entry.sizeBytes ?? 0 });
    }
    if (truncated) break;
  }
  return { files, skipped, truncated };
}

/**
 * Index (or re-sync) the active workspace into the local knowledge store. Incremental: a file whose
 * content hash is unchanged keeps its existing chunks; files that vanished are pruned; the graph is
 * rebuilt from the current document set. Returns the final state; the caller persists progress.
 */
export async function indexWorkspace(
  repo: KnowledgeLocalRepository,
  workspaceRoot: string,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const maxFiles = options.maxFiles ?? 1500;
  const maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
  const maxDepth = options.maxDepth ?? 12;
  const maxChunksPerDoc = options.maxChunksPerDoc ?? 400;
  const chunkSize = options.chunkSize ?? 1600;
  const chunkOverlap = options.chunkOverlap ?? 200;
  const now = options.now ?? (() => new Date().toISOString());
  const signal = options.signal;
  const report = (p: IndexProgress): void => options.onProgress?.(p);

  report({ phase: "enumerate", processed: 0, total: null });
  const { files, skipped: skippedEnum } = await enumerateFiles(
    workspaceRoot,
    { maxFiles, maxFileBytes, maxDepth },
    signal,
  );

  let skipped = skippedEnum;
  // Aborting during (or before) enumeration also counts as interrupted, so we never prune against a
  // partial file set.
  let interrupted = signal?.aborted === true;
  const seenPaths = new Set<string>();
  const markdownLinks = new Map<string, readonly string[]>();

  report({ phase: "index", processed: 0, total: files.length });
  for (let i = 0; i < files.length; i += 1) {
    if (signal?.aborted === true) {
      interrupted = true;
      break;
    }
    const file = files[i];
    if (file === undefined) continue;
    let result: WorkspaceFileContentResult;
    try {
      result = await readWorkspaceFileContent(workspaceRoot, file.relativePath);
    } catch {
      skipped += 1;
      continue;
    }
    const text = extractText(result);
    if (text.trim().length === 0) {
      skipped += 1;
      continue;
    }
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    const hash = createHash("sha256").update(text).digest("hex");
    if (file.kind === "markdown") markdownLinks.set(normalizedPath, extractLinkTargets(text));
    seenPaths.add(normalizedPath);

    const existing = repo.getDocumentByPath(workspaceRoot, normalizedPath);
    if (existing !== null && existing.contentHash === hash) {
      if ((i & 15) === 0) report({ phase: "index", processed: i + 1, total: files.length });
      continue; // unchanged — keep existing chunks/FTS
    }

    const docId = existing?.id ?? `${hash.slice(0, 16)}:${normalizedPath}`;
    const spans = chunkText(text, chunkSize, chunkOverlap, maxChunksPerDoc);
    const chunks: KnowledgeChunkRow[] = spans.map((span) => ({
      id: `${docId}#${span.ordinal}`,
      documentId: docId,
      workspaceRoot,
      ordinal: span.ordinal,
      charStart: span.charStart,
      charEnd: span.charEnd,
      text: span.text,
    }));
    repo.transaction(() => {
      repo.upsertDocument({
        id: docId,
        workspaceRoot,
        relativePath: normalizedPath,
        title: basename(normalizedPath),
        kind: file.kind,
        sizeBytes: file.sizeBytes,
        contentHash: hash,
        indexedAt: now(),
      });
      repo.replaceChunks(docId, normalizedPath, chunks);
    });
    if ((i & 7) === 0) report({ phase: "index", processed: i + 1, total: files.length });
  }

  // Prune documents that no longer exist on disk (skip pruning if interrupted — the set is partial).
  if (!interrupted) {
    for (const doc of repo.listDocuments(workspaceRoot)) {
      if (!seenPaths.has(doc.relativePath)) repo.deleteDocument(doc.id);
    }
  }

  // Rebuild the graph from the current document set.
  report({ phase: "graph", processed: files.length, total: files.length });
  const rootName = basename(workspaceRoot.replace(/[\\/]+$/, "")) || workspaceRoot;
  const docPaths = repo.listDocuments(workspaceRoot).map((d) => d.relativePath);
  const graph = buildHierarchyGraph(rootName, docPaths, markdownLinks);
  repo.replaceGraph(
    workspaceRoot,
    graph.nodes.map((n) => ({ ...n, workspaceRoot })),
    graph.edges.map((e) => ({ ...e, id: `${e.type}:${e.fromId}->${e.toId}`, workspaceRoot })),
  );

  const counts = repo.counts(workspaceRoot);
  const status: KnowledgeIndexStatus = interrupted ? "interrupted" : "ready";
  repo.setState({
    workspaceRoot,
    status,
    documentCount: counts.documents,
    chunkCount: counts.chunks,
    nodeCount: counts.nodes,
    edgeCount: counts.edges,
    lastIndexedAt: now(),
    error: null,
    updatedAt: now(),
  });
  report({ phase: "done", processed: files.length, total: files.length });

  return {
    status,
    documentCount: counts.documents,
    chunkCount: counts.chunks,
    nodeCount: counts.nodes,
    edgeCount: counts.edges,
    skipped,
    interrupted,
  };
}
