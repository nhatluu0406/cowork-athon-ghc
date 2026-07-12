/**
 * Knowledge boundary router (REQ-205 T1.7) — mounts `/v1/knowledge/*` on the existing
 * loopback boundary (ADR 0003), following the EXACT convention `credential/router.ts` /
 * `permission/router.ts` already use: every route is token-guarded (no `publicUnauthenticated`),
 * and a route validates its own body, throwing {@link BadRequestError} (→ HTTP 400) on
 * malformed input rather than a misleading 500.
 *
 * SECURITY: `POST /v1/knowledge/configure`'s raw `token` crosses the boundary INBOUND only —
 * every response below (including configure's own) carries ONLY the secret-free
 * {@link KnowledgeStatusView} projection (contracts/api.md), never the credential.
 *
 * `POST /v1/knowledge/query` is documented as "internal — invoked by the tool runtime, not
 * directly by the UI" (contracts/api.md); it is still mounted here (so the tool/router share
 * one `KnowledgeService`) but carries no permission check of its own — `tool.ts` is the ONLY
 * caller expected to reach it, and it does so only after `PermissionGate` has authorized the
 * call (FR-008). This mirrors `/v1/providers/*`'s configure/test-connection routes, which are
 * also NOT gated by `PermissionGate` (contracts/api.md "Permission model").
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { KnowledgeService } from "./knowledge-service.js";
import { KnowledgeConfigError } from "./knowledge-service.js";
import type {
  KnowledgeCitation,
  KnowledgeGraphResult,
  KnowledgeQueryOutcome,
  KnowledgeStatusView,
  KnowledgeToolOutcome,
} from "./types.js";

export const KNOWLEDGE_STATUS_PATH = "/v1/knowledge/status";
export const KNOWLEDGE_CONFIGURE_PATH = "/v1/knowledge/configure";
export const KNOWLEDGE_TEST_CONNECTION_PATH = "/v1/knowledge/test-connection";
export const KNOWLEDGE_CONNECTION_PATH = "/v1/knowledge/connection";
export const KNOWLEDGE_QUERY_PATH = "/v1/knowledge/query";
export const KNOWLEDGE_GRAPH_PATH = "/v1/knowledge/graph";

/** Malformed knowledge request (bad client input). Message stays generic, never a secret. */
export class KnowledgeRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeRequestError";
  }
}

interface ConfigureBody {
  readonly baseUrl: string;
  readonly token: string;
}

function parseConfigureBody(body: unknown): ConfigureBody {
  if (typeof body !== "object" || body === null) {
    throw new KnowledgeRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const { baseUrl, token } = record;
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    throw new KnowledgeRequestError("baseUrl is required.");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new KnowledgeRequestError("token is required.");
  }
  return { baseUrl, token };
}

interface QueryBody {
  readonly query: string;
}

function parseQueryBody(body: unknown): QueryBody {
  if (typeof body !== "object" || body === null) {
    throw new KnowledgeRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const { query } = record;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new KnowledgeRequestError("query is required.");
  }
  return { query };
}

/** The wire shape for `POST /v1/knowledge/query`'s response (contracts/api.md). */
export interface ApiQueryResult {
  readonly outcome: KnowledgeToolOutcome;
  readonly answer: string | null;
  readonly citations: readonly KnowledgeCitation[];
  readonly syncedAt: string | null;
}

/** Map the client-level outcome to the tool-facing/API enum (contracts/api.md — no `auth_failed`). */
function toApiQueryResult(outcome: KnowledgeQueryOutcome): ApiQueryResult {
  if (outcome.outcome === "answered") {
    return { outcome: "answered", answer: outcome.answer, citations: outcome.citations, syncedAt: outcome.syncedAt };
  }
  // `auth_failed` folds into `unavailable` for this API surface (see types.ts doc comment).
  const mapped = outcome.outcome === "auth_failed" ? "unavailable" : outcome.outcome;
  return { outcome: mapped, answer: null, citations: [], syncedAt: null };
}

/** Build the knowledge router against the composed {@link KnowledgeService}. */
export function createKnowledgeRouter(service: KnowledgeService): BoundaryRouter {
  return {
    name: "knowledge",
    routes: [
      {
        method: "GET",
        path: KNOWLEDGE_STATUS_PATH,
        handler: async (): Promise<RouteResult<KnowledgeStatusView>> => ({
          status: 200,
          data: await service.status(),
        }),
      },
      {
        method: "POST",
        path: KNOWLEDGE_CONFIGURE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<KnowledgeStatusView>> => {
          const input = parseConfigureBody(ctx.body);
          try {
            const view = await service.configure(input);
            return { status: 200, data: view };
          } catch (cause) {
            if (cause instanceof KnowledgeConfigError) {
              throw new KnowledgeRequestError(cause.message);
            }
            throw cause;
          }
        },
      },
      {
        method: "POST",
        path: KNOWLEDGE_TEST_CONNECTION_PATH,
        handler: async (): Promise<RouteResult<KnowledgeStatusView>> => ({
          status: 200,
          data: await service.testConnection(),
        }),
      },
      {
        method: "DELETE",
        path: KNOWLEDGE_CONNECTION_PATH,
        handler: async (): Promise<RouteResult<{ status: "not_configured" }>> => ({
          status: 200,
          data: await service.disconnect(),
        }),
      },
      {
        method: "POST",
        path: KNOWLEDGE_QUERY_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<ApiQueryResult>> => {
          const input = parseQueryBody(ctx.body);
          const outcome = await service.query(input.query);
          return { status: 200, data: toApiQueryResult(outcome) };
        },
      },
      {
        method: "GET",
        path: KNOWLEDGE_GRAPH_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<KnowledgeGraphResult>> => {
          const entityId = ctx.url.searchParams.get("entityId") ?? undefined;
          return { status: 200, data: await service.getGraph(entityId) };
        },
      },
    ],
  };
}
