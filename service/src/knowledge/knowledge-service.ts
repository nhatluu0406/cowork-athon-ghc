/**
 * `KnowledgeService` — the ONE place that ties the persisted `KnowledgeSourceConfig`
 * (store.ts), the `m365-knowledge` credential kind (credential/m365-knowledge.ts), and the
 * `KnowledgeSourceClient` (m365kg-client.ts) together. Both `router.ts` (the `/v1/knowledge/*`
 * HTTP surface) and `tool.ts` (the permission-gated `m365_knowledge_search` invocation) call
 * through this one service so there is a single source of truth for "is a source configured,
 * and what does the backend currently say" (NFR-002 — no cached "looks connected").
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import type { CredentialService } from "../credential/credential-service.js";
import {
  hasM365KnowledgeToken,
  m365KnowledgeCredentialRef,
  removeM365KnowledgeToken,
  resolveM365KnowledgeToken,
  storeM365KnowledgeToken,
} from "../credential/m365-knowledge.js";
import { createM365KgClient, type KnowledgeSourceClient } from "./m365kg-client.js";
import type { KnowledgeSourceConfigStore } from "./store.js";
import type {
  KnowledgeGraphResult,
  KnowledgeQueryOutcome,
  KnowledgeStatusView,
} from "./types.js";

export interface KnowledgeServiceOptions {
  readonly configStore: KnowledgeSourceConfigStore;
  readonly credentialService: CredentialService;
  readonly now: () => string;
  /** Injectable client factory (tests supply a fake client / capture calls). */
  readonly createClient?: (baseUrl: string, getToken: () => Promise<string | null>) => KnowledgeSourceClient;
}

/** Malformed configure request (bad client input, never a secret in the message). */
export class KnowledgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeConfigError";
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function toView(config: { status: KnowledgeStatusView["status"]; baseUrl: string | null; lastHealthCheckAt: string | null }): KnowledgeStatusView {
  return { status: config.status, baseUrl: config.baseUrl, lastHealthCheckAt: config.lastHealthCheckAt };
}

export interface KnowledgeService {
  /** GET /v1/knowledge/status — never returns the credential. */
  status(): Promise<KnowledgeStatusView>;
  /** POST /v1/knowledge/configure — stores the token via the keyring, then health-checks it. */
  configure(input: { readonly baseUrl: string; readonly token: string }): Promise<KnowledgeStatusView>;
  /** POST /v1/knowledge/test-connection — forces a real health check (no cached status). */
  testConnection(): Promise<KnowledgeStatusView>;
  /** DELETE /v1/knowledge/connection — clears config + removes the keyring entry (R6). */
  disconnect(): Promise<{ readonly status: "not_configured" }>;
  /** Internal — invoked by `tool.ts` ONLY after the PermissionGate has authorized the call. */
  query(queryText: string): Promise<KnowledgeQueryOutcome>;
  /** GET /v1/knowledge/graph — pass-through + truncation only, no graph computation. */
  getGraph(entityId?: string): Promise<KnowledgeGraphResult>;
}

/** Build a client bound to the CURRENT config's baseUrl + a lazy token resolver. */
function defaultCreateClient(
  baseUrl: string,
  getToken: () => Promise<string | null>,
): KnowledgeSourceClient {
  return createM365KgClient({ baseUrl, getToken });
}

export function createKnowledgeService(options: KnowledgeServiceOptions): KnowledgeService {
  const { configStore, credentialService, now } = options;
  const createClient = options.createClient ?? defaultCreateClient;

  /** Resolve the raw token for `ref` (SOLE point it leaves the store for a live call). */
  function tokenResolver(ref: CredentialRef): () => Promise<string | null> {
    return async () => {
      try {
        return await resolveM365KnowledgeToken(credentialService, ref);
      } catch {
        return null;
      }
    };
  }

  /** Build a client for the current persisted config, or `undefined` if not fully configured. */
  async function clientForCurrentConfig(): Promise<KnowledgeSourceClient | undefined> {
    const config = await configStore.read();
    if (config.baseUrl === null || config.credentialRef === null) return undefined;
    return createClient(config.baseUrl, tokenResolver(config.credentialRef));
  }

  return {
    async status(): Promise<KnowledgeStatusView> {
      return toView(await configStore.read());
    },

    async configure(input): Promise<KnowledgeStatusView> {
      const baseUrl = input.baseUrl.trim();
      const token = input.token;
      if (baseUrl.length === 0 || !isHttpUrl(baseUrl)) {
        throw new KnowledgeConfigError("baseUrl must be a well-formed http(s) URL.");
      }
      if (typeof token !== "string" || token.length === 0) {
        throw new KnowledgeConfigError("token is required.");
      }
      // The raw token is written ONLY to the keyring; the ref (handle) is what gets persisted.
      const ref = await storeM365KnowledgeToken(credentialService, token);
      const at = now();
      const client = createClient(baseUrl, tokenResolver(ref));
      const health = await client.checkHealth();
      await configStore.write({
        baseUrl,
        credentialRef: ref,
        status: health,
        lastHealthCheckAt: at,
        configuredAt: at,
      });
      return toView({ status: health, baseUrl, lastHealthCheckAt: at });
    },

    async testConnection(): Promise<KnowledgeStatusView> {
      const config = await configStore.read();
      if (config.baseUrl === null || config.credentialRef === null) {
        return toView(config); // not_configured — nothing to probe.
      }
      const client = createClient(config.baseUrl, tokenResolver(config.credentialRef));
      const status = await client.checkHealth();
      const at = now();
      await configStore.write({ ...config, status, lastHealthCheckAt: at });
      return toView({ status, baseUrl: config.baseUrl, lastHealthCheckAt: at });
    },

    async disconnect(): Promise<{ readonly status: "not_configured" }> {
      const config = await configStore.read();
      if (config.credentialRef !== null) {
        await removeM365KnowledgeToken(credentialService, config.credentialRef);
      } else {
        // Defensive: even with no persisted ref, clear the stable account handle too.
        await removeM365KnowledgeToken(credentialService, m365KnowledgeCredentialRef());
      }
      await configStore.clear();
      return { status: "not_configured" };
    },

    async query(queryText: string): Promise<KnowledgeQueryOutcome> {
      const client = await clientForCurrentConfig();
      if (client === undefined) return { outcome: "unavailable" };
      return client.query(queryText);
    },

    async getGraph(entityId?: string): Promise<KnowledgeGraphResult> {
      const client = await clientForCurrentConfig();
      if (client === undefined) return { nodes: [], edges: [], truncated: false };
      return client.getGraph(entityId);
    },
  };
}

/** Exported for callers that just need "is a token currently stored" without the full service. */
export { hasM365KnowledgeToken };
