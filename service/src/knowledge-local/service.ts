/**
 * Local Knowledge service — orchestrates the repository + indexer behind a small stateful API.
 *
 * `sync()` starts a BACKGROUND index job (non-blocking) so it never hangs the renderer; the renderer
 * polls `status()` for live progress and the terminal state. Only one job runs per workspace at a
 * time; `cancel()` aborts it (leaving the partial index intact). Everything is scoped to the active
 * workspace; switching workspace is just a different `workspace_root`.
 */

import { indexWorkspace, type IndexOptions } from "./indexer.js";
import type { KnowledgeLocalRepository } from "./repository.js";
import type {
  KnowledgeGraphApiResult,
  KnowledgeIndexStatus,
  KnowledgeIndexView,
  KnowledgeSearchHit,
} from "./types.js";
import { KNOWLEDGE_GRAPH_MAX_NODES, KNOWLEDGE_SEARCH_DEFAULT_LIMIT } from "./types.js";

export type { KnowledgeIndexView, KnowledgeGraphApiResult } from "./types.js";

export interface KnowledgeLocalServiceOptions {
  readonly repo: KnowledgeLocalRepository;
  readonly activeWorkspaceRoot: () => string | undefined;
  /** Override index bounds (tests use small caps). */
  readonly indexOptions?: Omit<IndexOptions, "signal" | "onProgress">;
  readonly now?: () => string;
}

export interface KnowledgeLocalService {
  status(): KnowledgeIndexView;
  sync(): KnowledgeIndexView;
  cancel(): KnowledgeIndexView;
  clear(): KnowledgeIndexView;
  search(query: string, limit?: number): readonly KnowledgeSearchHit[];
  graph(limit?: number): KnowledgeGraphApiResult;
  /** Test-only: resolves when no index job is running. */
  whenIdle(): Promise<void>;
}

interface ActiveJob {
  readonly workspaceRoot: string;
  readonly controller: AbortController;
  progress: { processed: number; total: number | null };
  readonly done: Promise<unknown>;
}

const EMPTY_STATUS = (hasWorkspace: boolean, status: KnowledgeIndexStatus): KnowledgeIndexView => ({
  status,
  hasWorkspace,
  documentCount: 0,
  chunkCount: 0,
  nodeCount: 0,
  edgeCount: 0,
  lastIndexedAt: null,
  error: null,
  indexing: null,
});

export function createKnowledgeLocalService(
  options: KnowledgeLocalServiceOptions,
): KnowledgeLocalService {
  const { repo, activeWorkspaceRoot } = options;
  const now = options.now ?? (() => new Date().toISOString());
  let job: ActiveJob | null = null;

  const statusFor = (workspaceRoot: string): KnowledgeIndexView => {
    const state = repo.getState(workspaceRoot);
    const running = job !== null && job.workspaceRoot === workspaceRoot;
    if (state === null) {
      return { ...EMPTY_STATUS(true, running ? "indexing" : "not_initialized"), indexing: running ? job!.progress : null };
    }
    return {
      status: running ? "indexing" : state.status,
      hasWorkspace: true,
      documentCount: state.documentCount,
      chunkCount: state.chunkCount,
      nodeCount: state.nodeCount,
      edgeCount: state.edgeCount,
      lastIndexedAt: state.lastIndexedAt,
      error: state.error,
      indexing: running ? job!.progress : null,
    };
  };

  const status = (): KnowledgeIndexView => {
    const ws = activeWorkspaceRoot();
    if (ws === undefined) return EMPTY_STATUS(false, "not_initialized");
    return statusFor(ws);
  };

  return {
    status,
    sync(): KnowledgeIndexView {
      const ws = activeWorkspaceRoot();
      if (ws === undefined) return EMPTY_STATUS(false, "not_initialized");
      if (job !== null) return statusFor(job.workspaceRoot); // already running
      const controller = new AbortController();
      const active: ActiveJob = {
        workspaceRoot: ws,
        controller,
        progress: { processed: 0, total: null },
        done: Promise.resolve(),
      };
      // Persist an immediate "indexing" marker so a status poll before the first progress tick is honest.
      const existing = repo.getState(ws);
      repo.setState({
        workspaceRoot: ws,
        status: "indexing",
        documentCount: existing?.documentCount ?? 0,
        chunkCount: existing?.chunkCount ?? 0,
        nodeCount: existing?.nodeCount ?? 0,
        edgeCount: existing?.edgeCount ?? 0,
        lastIndexedAt: existing?.lastIndexedAt ?? null,
        error: null,
        updatedAt: now(),
      });
      const run = indexWorkspace(repo, ws, {
        ...options.indexOptions,
        signal: controller.signal,
        now,
        onProgress: (p) => {
          active.progress = { processed: p.processed, total: p.total };
        },
      })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Index thất bại.";
          const counts = repo.counts(ws);
          repo.setState({
            workspaceRoot: ws,
            status: "error",
            documentCount: counts.documents,
            chunkCount: counts.chunks,
            nodeCount: counts.nodes,
            edgeCount: counts.edges,
            lastIndexedAt: repo.getState(ws)?.lastIndexedAt ?? null,
            error: message.slice(0, 300),
            updatedAt: now(),
          });
        })
        .finally(() => {
          if (job !== null && job.workspaceRoot === ws) job = null;
        });
      (active as { done: Promise<unknown> }).done = run;
      job = active;
      return statusFor(ws);
    },
    cancel(): KnowledgeIndexView {
      if (job !== null) job.controller.abort();
      return status();
    },
    clear(): KnowledgeIndexView {
      const ws = activeWorkspaceRoot();
      if (ws === undefined) return EMPTY_STATUS(false, "not_initialized");
      if (job !== null && job.workspaceRoot === ws) job.controller.abort();
      repo.clearWorkspace(ws);
      return EMPTY_STATUS(true, "not_initialized");
    },
    search(query, limit = KNOWLEDGE_SEARCH_DEFAULT_LIMIT): readonly KnowledgeSearchHit[] {
      const ws = activeWorkspaceRoot();
      if (ws === undefined) return [];
      return repo.search(ws, query, limit);
    },
    graph(limit = KNOWLEDGE_GRAPH_MAX_NODES): KnowledgeGraphApiResult {
      const ws = activeWorkspaceRoot();
      if (ws === undefined) return { nodes: [], edges: [], truncated: false };
      const view = repo.getGraph(ws, limit);
      return {
        nodes: view.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          kind: n.kind,
          relativePath: n.relativePath,
        })),
        edges: view.edges.map((e) => ({ from: e.fromId, to: e.toId, type: e.type })),
        truncated: view.truncated,
      };
    },
    async whenIdle(): Promise<void> {
      while (job !== null) {
        await job.done;
      }
    },
  };
}
