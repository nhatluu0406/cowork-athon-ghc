/**
 * MCP Phase 1 HTTP router (Wave 2B) — CRUD + enable/disable/health over the extension {@link
 * McpRegistry} lifecycle, persisted through {@link McpStore} so servers survive a relaunch.
 *
 * No OAuth. A `headerSecret` crosses this boundary ONLY inbound (create/update body) and is
 * written straight to the ONE credential store under `mcp:<id>:header`; every response carries
 * only {@link McpServerWireView.hasHeaderSecret} — never the value (mirrors the credential router
 * discipline). Unknown-id and validation failures map to `bad_request` (400), matching the other
 * boundary routers (e.g. provider-profiles) — there is no dedicated `not_found` boundary code.
 */

import { randomUUID } from "node:crypto";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { CredentialStore } from "../credential/index.js";
import type { McpRegistry, McpServerEntry } from "../extensions/index.js";
import type { McpStore } from "../db/index.js";
import { assertValidMcpId, mcpHeaderSecretAccount, type McpServerWireView } from "./types.js";

export const MCP_SERVERS_PATH = "/v1/mcp/servers";
export const MCP_SERVER_ITEM_PATH = "/v1/mcp/servers/{id}";
export const MCP_SERVER_ENABLE_PATH = "/v1/mcp/servers/{id}/enable";
export const MCP_SERVER_DISABLE_PATH = "/v1/mcp/servers/{id}/disable";
export const MCP_SERVER_HEALTH_PATH = "/v1/mcp/servers/{id}/health";

export class McpRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "McpRequestError";
  }
}

export interface McpRouterDeps {
  readonly registry: McpRegistry;
  readonly store: McpStore;
  /** The ONE credential store; a header secret is written/removed here, never in `mcp_servers`. */
  readonly credentials: CredentialStore;
  readonly now?: () => string;
}

interface CreateBody {
  readonly id?: string;
  readonly name: string;
  readonly command?: string;
  readonly url?: string;
  readonly headerSecret?: string;
}

interface PatchBody {
  readonly name?: string;
  readonly command?: string;
  readonly url?: string;
  /** `null` clears an existing header secret; `undefined` leaves it untouched. */
  readonly headerSecret?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new McpRequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function parseTransport(rec: Record<string, unknown>): { command?: string; url?: string } {
  const command = rec["command"];
  const url = rec["url"];
  if (command !== undefined && typeof command !== "string") {
    throw new McpRequestError("command, when present, must be a string.");
  }
  if (url !== undefined && typeof url !== "string") {
    throw new McpRequestError("url, when present, must be a string.");
  }
  return {
    ...(typeof command === "string" && command.trim().length > 0 ? { command: command.trim() } : {}),
    ...(typeof url === "string" && url.trim().length > 0 ? { url: url.trim() } : {}),
  };
}

function parseCreateBody(body: unknown): CreateBody {
  const rec = asRecord(body);
  const name = rec["name"];
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new McpRequestError("name is required.");
  }
  const id = rec["id"];
  if (id !== undefined && (typeof id !== "string" || id.trim().length === 0)) {
    throw new McpRequestError("id, when present, must be a non-empty string.");
  }
  const headerSecret = rec["headerSecret"];
  if (headerSecret !== undefined && typeof headerSecret !== "string") {
    throw new McpRequestError("headerSecret, when present, must be a string.");
  }
  return {
    name: name.trim(),
    ...(typeof id === "string" ? { id: id.trim() } : {}),
    ...parseTransport(rec),
    ...(typeof headerSecret === "string" ? { headerSecret } : {}),
  };
}

function parsePatchBody(body: unknown): PatchBody {
  const rec = asRecord(body);
  const name = rec["name"];
  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
    throw new McpRequestError("name, when present, must be a non-empty string.");
  }
  const headerSecret = rec["headerSecret"];
  if (headerSecret !== undefined && headerSecret !== null && typeof headerSecret !== "string") {
    throw new McpRequestError("headerSecret, when present, must be a string or null.");
  }
  return {
    ...(typeof name === "string" ? { name: name.trim() } : {}),
    ...parseTransport(rec),
    ...(headerSecret === null ? { headerSecret: null } : typeof headerSecret === "string" ? { headerSecret } : {}),
  };
}

function requireId(ctx: RouteContext): string {
  const id = ctx.params["id"];
  if (id === undefined || id.trim().length === 0) throw new McpRequestError("id is required.");
  return assertValidMcpId(id);
}

/** Build the composition helpers once so every route shares the SAME store/credentials/now. */
export function createMcpRouter(deps: McpRouterDeps): BoundaryRouter {
  const now = deps.now ?? (() => new Date().toISOString());

  function toWireView(entry: McpServerEntry): McpServerWireView {
    return {
      id: entry.config.id,
      name: entry.config.name,
      enabled: entry.status === "enabled",
      status: entry.status,
      connection: entry.connection,
      hasHeaderSecret: deps.store.getSecretRef(entry.config.id) !== null,
      // Phase 1: no live MCP protocol client yet (see createProcessMcpAdapter) — never fabricated.
      toolCount: 0,
      updatedAt: deps.store.get(entry.config.id)?.updatedAt ?? now(),
      ...(entry.config.command !== undefined ? { command: entry.config.command } : {}),
      ...(entry.config.url !== undefined ? { url: entry.config.url } : {}),
    };
  }

  async function setHeaderSecret(id: string, secret: string): Promise<void> {
    if (secret.trim().length === 0) throw new McpRequestError("headerSecret must be a non-empty string.");
    const account = mcpHeaderSecretAccount(id);
    await deps.credentials.set(account, secret);
    deps.store.setSecretRef(id, account);
  }

  async function clearHeaderSecret(id: string): Promise<void> {
    const ref = deps.store.getSecretRef(id);
    if (ref === null) return;
    await deps.credentials.delete(ref.secretAccount);
    deps.store.deleteSecretRef(id);
  }

  function requireEntry(id: string): McpServerEntry {
    const entry = deps.registry.get(id);
    if (entry === undefined) throw new McpRequestError(`Unknown MCP server "${id}".`);
    return entry;
  }

  return {
    name: "mcp",
    routes: [
      {
        method: "GET",
        path: MCP_SERVERS_PATH,
        handler: (): RouteResult => ({
          status: 200,
          data: { servers: deps.registry.list().map(toWireView) },
        }),
      },
      {
        method: "POST",
        path: MCP_SERVERS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const body = parseCreateBody(ctx.body);
          const id = assertValidMcpId(body.id ?? randomUUID());
          const added = await deps.registry.add({
            id,
            name: body.name,
            ...(body.command !== undefined ? { command: body.command } : {}),
            ...(body.url !== undefined ? { url: body.url } : {}),
          });
          if (!added.ok) throw new McpRequestError(added.error.message);
          deps.store.upsert({
            id,
            name: body.name,
            enabled: false,
            updatedAt: now(),
            ...(body.command !== undefined ? { command: body.command } : {}),
            ...(body.url !== undefined ? { url: body.url } : {}),
          });
          if (body.headerSecret !== undefined) await setHeaderSecret(id, body.headerSecret);
          return { status: 201, data: { server: toWireView(added.value) } };
        },
      },
      {
        method: "GET",
        path: MCP_SERVER_ITEM_PATH,
        handler: (ctx: RouteContext): RouteResult => {
          const id = requireId(ctx);
          return { status: 200, data: { server: toWireView(requireEntry(id)) } };
        },
      },
      {
        method: "PATCH",
        path: MCP_SERVER_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx);
          const existing = requireEntry(id);
          const body = parsePatchBody(ctx.body);
          const wasEnabled = existing.status === "enabled";
          const nextName = body.name ?? existing.config.name;
          const nextCommand = body.command ?? existing.config.command;
          const nextUrl = body.url ?? existing.config.url;

          // The registry has no in-place update; re-add under the SAME id (exactly-one-transport
          // validation runs again inside add()) and, if it was live, best-effort re-enable so a
          // pure rename/header-secret patch does not silently drop a running connection.
          const removed = await deps.registry.remove(id);
          if (!removed.ok) throw new McpRequestError(removed.error.message);
          const added = await deps.registry.add({
            id,
            name: nextName,
            ...(nextCommand !== undefined ? { command: nextCommand } : {}),
            ...(nextUrl !== undefined ? { url: nextUrl } : {}),
          });
          if (!added.ok) throw new McpRequestError(added.error.message);
          let finalEntry = added.value;
          if (wasEnabled) {
            const enabled = await deps.registry.enable(id);
            if (enabled.ok) finalEntry = enabled.value;
            // A re-enable failure is honestly surfaced via registry diagnostics; the PATCH itself
            // still succeeds with the server left disabled rather than throwing away the edit.
          }

          deps.store.upsert({
            id,
            name: nextName,
            enabled: finalEntry.status === "enabled",
            updatedAt: now(),
            ...(nextCommand !== undefined ? { command: nextCommand } : {}),
            ...(nextUrl !== undefined ? { url: nextUrl } : {}),
          });
          if (body.headerSecret === null) await clearHeaderSecret(id);
          else if (body.headerSecret !== undefined) await setHeaderSecret(id, body.headerSecret);

          return { status: 200, data: { server: toWireView(finalEntry) } };
        },
      },
      {
        method: "DELETE",
        path: MCP_SERVER_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx);
          requireEntry(id);
          const removed = await deps.registry.remove(id);
          if (!removed.ok) throw new McpRequestError(removed.error.message);
          await clearHeaderSecret(id);
          deps.store.delete(id);
          return { status: 200, data: { deleted: true } };
        },
      },
      {
        method: "POST",
        path: MCP_SERVER_ENABLE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx);
          const enabled = await deps.registry.enable(id);
          if (!enabled.ok) throw new McpRequestError(enabled.error.message);
          const existing = deps.store.get(id);
          if (existing !== null) deps.store.upsert({ ...existing, enabled: true, updatedAt: now() });
          return { status: 200, data: { server: toWireView(enabled.value) } };
        },
      },
      {
        method: "POST",
        path: MCP_SERVER_DISABLE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx);
          const disabled = await deps.registry.disable(id);
          if (!disabled.ok) throw new McpRequestError(disabled.error.message);
          const existing = deps.store.get(id);
          if (existing !== null) deps.store.upsert({ ...existing, enabled: false, updatedAt: now() });
          return { status: 200, data: { server: toWireView(disabled.value) } };
        },
      },
      {
        method: "GET",
        path: MCP_SERVER_HEALTH_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx);
          const health = await deps.registry.health(id);
          if (!health.ok) throw new McpRequestError(health.error.message);
          return { status: 200, data: { id, connection: health.value } };
        },
      },
    ],
  };
}
