/**
 * `KnowledgeSourceClient` — the REST client to the (external, unmodified) M365 Knowledge
 * Graph Go backend (REQ-204 contracts/api.md), following the injectable-`fetch` +
 * `AbortController` pattern already used by `runtime/opencode-client.ts` /
 * `boundary/client.ts` (no new HTTP transport is invented).
 *
 * R2 (reactive refresh, research.md): a `401` from the backend is treated as a signal to call
 * `POST /api/auth/token/refresh` ONCE, retry the original request ONCE with the refreshed
 * token, and only THEN surface `auth_failed` if the retry still fails. No proactive/background
 * refresh — the client is otherwise inert (D5).
 *
 * R3 (35s timeout): every call is bounded by {@link M365_KNOWLEDGE_QUERY_TIMEOUT_MS}. A
 * timeout resolves to a clean `{ outcome: "timeout" }` / `"unreachable"` value — never a hung
 * promise or an unhandled rejection (the `AbortController` timer is always cleared in
 * `finally`, mirroring `opencode-client.ts`).
 *
 * This client deliberately does NOT reuse `provider/http-connector.ts`'s SSRF/IP-pinning
 * machinery: that hardening exists because a provider `base_url` is attacker-influenced
 * (an arbitrary user-typed endpoint that then receives an LLM-provider credential). The M365KG
 * `baseUrl` is the user's own locally-run/organization-internal backend (D2) that the user
 * explicitly points Cowork at, analogous to `ServiceClient`'s own loopback target — so the
 * SSRF-guard machinery is out of scope here (see the Phase 1 report for this design call).
 */

import type {
  KnowledgeCitation,
  KnowledgeEntityType,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphResult,
  KnowledgeHealthStatus,
  KnowledgeQueryOutcome,
  LLMConfigRequest,
  LLMConfigResponse,
  LLMConfigView,
} from "./types.js";
import { KNOWLEDGE_PANEL_MAX_NODES } from "./types.js";

/** R3 — hard bound on a `query()` call (35s). */
export const M365_KNOWLEDGE_QUERY_TIMEOUT_MS = 35_000;

/** The client contract this module implements; a fake is used for the tool/router unit tests. */
export interface KnowledgeSourceClient {
  query(query: string): Promise<KnowledgeQueryOutcome>;
  getGraph(entityId?: string): Promise<KnowledgeGraphResult>;
  checkHealth(): Promise<KnowledgeHealthStatus>;
  /** Force a token refresh now (also called internally on a 401). Returns whether it succeeded. */
  refreshToken(): Promise<boolean>;
  /** Configure LLM provider settings (POST /api/llm/config). Requires server restart to apply. */
  configureLLM(config: LLMConfigRequest): Promise<LLMConfigResponse>;
  /** Retrieve current LLM configuration (GET /api/llm/config/current). API key is masked. */
  getCurrentLLMConfig(): Promise<LLMConfigView | null>;
}

export interface KnowledgeSourceClientOptions {
  readonly baseUrl: string;
  /** Resolve the current bearer/refresh token from the keyring; `null` when none is stored. */
  readonly getToken: () => Promise<string | null>;
  /** Injectable fetch (default: global `fetch`). Tests inject a fake transport. */
  readonly fetch?: typeof fetch;
  /** Per-call bound; default {@link M365_KNOWLEDGE_QUERY_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

type RawResult =
  | { readonly kind: "ok"; readonly status: number; readonly body: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "network_error" };

interface QueryResponseBody {
  readonly answer?: string;
  readonly sources?: readonly { chunk_id: number; file_name: string; heading_path: string | null }[];
  readonly entities?: readonly { id: string; type: string; name: string }[];
  readonly latency_ms?: number;
}

interface RefreshResponseBody {
  readonly access_token?: string;
  readonly expires_in?: number;
}

interface GraphNodeBody {
  readonly id: string;
  readonly label: string;
  readonly properties?: Record<string, unknown>;
}

interface GraphEdgeBody {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}

function isKnowledgeEntityType(value: string): value is KnowledgeEntityType {
  return (
    value === "Person" ||
    value === "Project" ||
    value === "Document" ||
    value === "Technology" ||
    value === "Customer" ||
    value === "Department"
  );
}

/** Map a `/api/knowledge/query` 200 body to `KnowledgeCitation[]` (data-model.md §1.3). */
function mapCitations(body: QueryResponseBody): KnowledgeCitation[] {
  const citations: KnowledgeCitation[] = [];
  for (const entity of body.entities ?? []) {
    if (!isKnowledgeEntityType(entity.type)) continue;
    citations.push({
      entityType: entity.type,
      entityId: entity.id,
      displayName: entity.name,
      sourceRef: null,
    });
  }
  for (const source of body.sources ?? []) {
    citations.push({
      entityType: "Document",
      entityId: String(source.chunk_id),
      displayName: source.file_name,
      sourceRef: source.heading_path ?? null,
    });
  }
  return citations;
}

/** Build the real REST {@link KnowledgeSourceClient} against one configured M365KG backend. */
export function createM365KgClient(options: KnowledgeSourceClientOptions): KnowledgeSourceClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? M365_KNOWLEDGE_QUERY_TIMEOUT_MS;
  const base = options.baseUrl;

  async function rawCall(
    path: string,
    init: { readonly method: "GET" | "POST"; readonly body?: unknown; readonly token: string | null },
  ): Promise<RawResult> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (init.body !== undefined) headers["content-type"] = "application/json";
      if (init.token !== null) headers["authorization"] = `Bearer ${init.token}`;
      const res = await doFetch(new URL(path, base), {
        method: init.method,
        headers,
        signal: controller.signal,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      return { kind: "ok", status: res.status, body };
    } catch {
      return timedOut ? { kind: "timeout" } : { kind: "network_error" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** R2: call `/api/auth/token/refresh` once, using the stored token as the refresh token. */
  async function doRefresh(): Promise<{ readonly ok: true; readonly token: string } | { readonly ok: false }> {
    const refreshToken = await options.getToken();
    if (refreshToken === null) return { ok: false };
    const result = await rawCall("/api/auth/token/refresh", {
      method: "POST",
      body: { refresh_token: refreshToken },
      token: null,
    });
    if (result.kind !== "ok" || result.status < 200 || result.status >= 300) return { ok: false };
    const body = result.body as RefreshResponseBody | undefined;
    if (typeof body?.access_token !== "string" || body.access_token.length === 0) return { ok: false };
    return { ok: true, token: body.access_token };
  }

  /**
   * Run one authenticated call; on a 401, refresh once and retry once (R2). `onOk` maps a
   * non-timeout/non-network-error/non-401 response to the caller's result type.
   */
  async function withAuthRetry<T>(
    call: (token: string | null) => Promise<RawResult>,
    onOk: (result: Extract<RawResult, { kind: "ok" }>) => T,
    onTimeout: () => T,
    onUnavailable: () => T,
    onAuthFailed: () => T,
  ): Promise<T> {
    const token = await options.getToken();
    const first = await call(token);
    if (first.kind === "timeout") return onTimeout();
    if (first.kind === "network_error") return onUnavailable();
    if (first.status !== 401) return onOk(first);

    const refreshed = await doRefresh();
    if (!refreshed.ok) return onAuthFailed();

    const second = await call(refreshed.token);
    if (second.kind === "timeout") return onTimeout();
    if (second.kind === "network_error") return onUnavailable();
    if (second.status === 401) return onAuthFailed();
    return onOk(second);
  }

  return {
    async query(queryText: string): Promise<KnowledgeQueryOutcome> {
      return withAuthRetry<KnowledgeQueryOutcome>(
        (token) => rawCall("/api/knowledge/query", { method: "POST", body: { query: queryText }, token }),
        (result) => {
          if (result.status < 200 || result.status >= 300) return { outcome: "unavailable" };
          const body = (result.body ?? {}) as QueryResponseBody;
          return {
            outcome: "answered",
            answer: body.answer ?? "",
            citations: mapCitations(body),
            syncedAt: null,
          };
        },
        () => ({ outcome: "timeout" }),
        () => ({ outcome: "unavailable" }),
        () => ({ outcome: "auth_failed" }),
      );
    },

    async getGraph(entityId?: string): Promise<KnowledgeGraphResult> {
      const nodesPath = `/api/graph/nodes?limit=${KNOWLEDGE_PANEL_MAX_NODES + 1}`;
      const edgesPath = "/api/graph/edges";
      return withAuthRetry<KnowledgeGraphResult>(
        async (token) => {
          const nodesResult = await rawCall(nodesPath, { method: "GET", token });
          if (nodesResult.kind !== "ok") return nodesResult;
          const edgesResult = await rawCall(edgesPath, { method: "GET", token });
          if (edgesResult.kind !== "ok") return edgesResult;
          // Fold both bodies into one "ok" carrier for onOk below.
          return {
            kind: "ok",
            status: nodesResult.status,
            body: { nodes: nodesResult.body, edges: edgesResult.body },
          };
        },
        (result) => {
          const body = result.body as { nodes?: unknown; edges?: unknown };
          const rawNodes = Array.isArray(body.nodes) ? (body.nodes as GraphNodeBody[]) : [];
          const rawEdges = Array.isArray(body.edges) ? (body.edges as GraphEdgeBody[]) : [];
          const truncated = rawNodes.length > KNOWLEDGE_PANEL_MAX_NODES;
          const nodes: KnowledgeGraphNode[] = rawNodes
            .slice(0, KNOWLEDGE_PANEL_MAX_NODES)
            .map((n) => ({ id: n.id, label: n.label, properties: n.properties ?? {} }));
          const keptIds = new Set(nodes.map((n) => n.id));
          const edges: KnowledgeGraphEdge[] = rawEdges
            .filter((e) => keptIds.has(e.from) && keptIds.has(e.to))
            .map((e) => ({ from: e.from, to: e.to, type: e.type }));
          void entityId; // reserved for a future /api/graph/path-scoped fetch; nodes/edges pass-through for now
          return { nodes, edges, truncated };
        },
        () => ({ nodes: [], edges: [], truncated: false }),
        () => ({ nodes: [], edges: [], truncated: false }),
        () => ({ nodes: [], edges: [], truncated: false }),
      );
    },

    async checkHealth(): Promise<KnowledgeHealthStatus> {
      return withAuthRetry<KnowledgeHealthStatus>(
        (token) => rawCall("/api/stats/overview", { method: "GET", token }),
        (result) => (result.status >= 200 && result.status < 300 ? "connected" : "unreachable"),
        () => "unreachable",
        () => "unreachable",
        () => "auth_failed",
      );
    },

    async refreshToken(): Promise<boolean> {
      const result = await doRefresh();
      return result.ok;
    },

    async configureLLM(config: LLMConfigRequest): Promise<LLMConfigResponse> {
      return withAuthRetry<LLMConfigResponse>(
        (token) =>
          rawCall("/api/llm/config", {
            method: "POST",
            body: {
              provider: config.provider,
              base_url: config.baseUrl ?? "",
              api_key: config.apiKey,
              model: config.model,
              nlp_mode: config.nlpMode ?? 1,
            },
            token,
          }),
        (result) => {
          if (result.status >= 200 && result.status < 300) {
            const body = result.body as { ok: boolean; message?: string };
            return { ok: body.ok, message: body.message };
          }
          return { ok: false, message: `HTTP ${result.status}` };
        },
        () => ({ ok: false, message: "Request timeout" }),
        () => ({ ok: false, message: "Service unavailable" }),
        () => ({ ok: false, message: "Authentication failed" }),
      );
    },

    async getCurrentLLMConfig(): Promise<LLMConfigView | null> {
      return withAuthRetry<LLMConfigView | null>(
        (token) => rawCall("/api/llm/config/current", { method: "GET", token }),
        (result) => {
          if (result.status >= 200 && result.status < 300) {
            const body = result.body as {
              provider: string;
              base_url: string;
              model: string;
              nlp_mode: number;
              updated_at: string;
              updated_by: string;
            };
            return {
              provider: body.provider,
              baseUrl: body.base_url,
              model: body.model,
              nlpMode: body.nlp_mode,
              updatedAt: body.updated_at,
              updatedBy: body.updated_by,
            };
          }
          // 404 or other error - no config stored yet
          return null;
        },
        () => null,
        () => null,
        () => null,
      );
    },
  };
}
