/**
 * Local Knowledge boundary router (mounts on the loopback boundary, ADR 0003).
 *
 * Token-guarded like every domain router. It exposes the local KB/KG: index status, start/cancel a
 * background sync, keyword search, the graph, and clear. All operations are scoped to the active
 * workspace (resolved server-side); nothing here reaches the network. This is the LOCAL knowledge
 * system — separate from the dormant external M365 `/v1/knowledge/*` client.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { KnowledgeLocalService } from "./service.js";

export const KNOWLEDGE_LOCAL_STATUS_PATH = "/v1/knowledge-local/status";
export const KNOWLEDGE_LOCAL_SYNC_PATH = "/v1/knowledge-local/sync";
export const KNOWLEDGE_LOCAL_CANCEL_PATH = "/v1/knowledge-local/cancel";
export const KNOWLEDGE_LOCAL_CLEAR_PATH = "/v1/knowledge-local/clear";
export const KNOWLEDGE_LOCAL_SEARCH_PATH = "/v1/knowledge-local/search";
export const KNOWLEDGE_LOCAL_GRAPH_PATH = "/v1/knowledge-local/graph";

export class KnowledgeLocalRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeLocalRequestError";
  }
}

function parseLimit(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function createKnowledgeLocalRouter(service: KnowledgeLocalService): BoundaryRouter {
  return {
    name: "knowledge-local",
    routes: [
      {
        method: "GET",
        path: KNOWLEDGE_LOCAL_STATUS_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { status: service.status() } }),
      },
      {
        method: "POST",
        path: KNOWLEDGE_LOCAL_SYNC_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 202, data: { status: service.sync() } }),
      },
      {
        method: "POST",
        path: KNOWLEDGE_LOCAL_CANCEL_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { status: service.cancel() } }),
      },
      {
        method: "POST",
        path: KNOWLEDGE_LOCAL_CLEAR_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { status: service.clear() } }),
      },
      {
        method: "GET",
        path: KNOWLEDGE_LOCAL_SEARCH_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const query = ctx.url.searchParams.get("q")?.trim() ?? "";
          if (query.length === 0) {
            return { status: 200, data: { hits: [] } };
          }
          const limit = parseLimit(ctx.url.searchParams.get("limit"), 30, 100);
          return { status: 200, data: { hits: service.search(query, limit) } };
        },
      },
      {
        method: "GET",
        path: KNOWLEDGE_LOCAL_GRAPH_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const limit = parseLimit(ctx.url.searchParams.get("limit"), 120, 400);
          return { status: 200, data: { graph: service.graph(limit) } };
        },
      },
    ],
  };
}
