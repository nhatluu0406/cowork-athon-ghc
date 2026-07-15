/**
 * MS365 boundary router (mounts on the CGHC-002 loopback boundary, ADR 0003/0005).
 *
 * SECURITY: every route is TOKEN-GUARDED — no `publicUnauthenticated` (a public MS365 route
 * would leak SharePoint access / connect flow to any loopback caller, so it is forbidden here
 * just like the provider router). This is an INTERNAL SERVICE TOOL surface reached over the
 * loopback HTTP boundary, NOT an MCP server — the runtime calls `MS365_TOOL_CALL_PATH` the
 * same way it calls any other boundary route.
 *
 * Three routes: dispatch a tool call (`handleToolCall`, Task 9), connect with a manual token
 * (`Ms365Connector.connectWithToken`, Task 6), and read the current view (`buildMs365View`,
 * Task 8). Invalid bodies are rejected as `Ms365RouterRequestError` (extends `BadRequestError`)
 * so the dispatcher maps them to HTTP 400, mirroring `provider/router.ts`.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { Ms365Connector } from "./ms365-connector.js";
import { buildMs365View, type Ms365ViewData } from "./ms365-view.js";
import { handleToolCall, type ToolCall, type ToolDeps, type ToolResult, type Ms365ToolName } from "./ms365-tools.js";
import type { SiteScopeService } from "./site-scope-service.js";
import type { Ms365WriteMode, WriteModeStore } from "./write-mode-store.js";
import type { Ms365SessionScope } from "./ms365-session-scope.js";

export const MS365_TOOL_CALL_PATH = "/v1/ms365/tool-call";
export const MS365_CONNECT_PATH = "/v1/ms365/connect";
export const MS365_VIEW_PATH = "/v1/ms365/view";
export const MS365_DEVICE_BEGIN_PATH = "/v1/ms365/device/begin";
export const MS365_DEVICE_POLL_PATH = "/v1/ms365/device/poll";
export const MS365_DISCONNECT_PATH = "/v1/ms365/disconnect";
export const MS365_SITES_PATH = "/v1/ms365/sites";
export const MS365_SITES_TOGGLE_PATH = "/v1/ms365/sites/toggle";
export const MS365_WRITE_MODE_PATH = "/v1/ms365/write-mode";
export const MS365_SESSION_SCOPE_PATH = "/v1/ms365/session-scope";

export const TOOL_NAMES: readonly Ms365ToolName[] = [
  "sharepoint_search",
  "sharepoint_list_site_files",
  "sharepoint_get_file_summary",
  "sharepoint_upload_file",
  "ms365_list_joined_sites",
  "outlook_search_messages",
  "outlook_get_message",
  "outlook_summarize_message",
  "planner_list_plans",
  "planner_list_tasks",
  "planner_create_task",
  "planner_create_tasks",
  "planner_edit_task",
  "planner_delete_task",
  "lists_get_lists",
  "lists_get_items",
  "lists_add_item",
  "lists_edit_item",
  "lists_delete_item",
  "teams_list_chats",
  "teams_list_teams",
  "teams_list_channels",
  "teams_list_members",
  "teams_get_messages",
  "teams_post_message",
];

/**
 * Malformed MS365 request body (bad client input). Extends {@link BadRequestError} so the
 * boundary dispatcher maps it to HTTP 400 (not a misleading 500). The message stays generic
 * and never carries a secret/token.
 */
export class Ms365RouterRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "Ms365RouterRequestError";
  }
}

function isToolName(value: unknown): value is Ms365ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseToolCallBody(body: unknown): ToolCall {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!isToolName(record.name)) {
    throw new Ms365RouterRequestError("name must be a known MS365 tool name.");
  }
  if (typeof record.args !== "object" || record.args === null || Array.isArray(record.args)) {
    throw new Ms365RouterRequestError("args must be a JSON object.");
  }
  if (!nonEmptyString(record.sessionId)) {
    throw new Ms365RouterRequestError("sessionId is required.");
  }
  if (!nonEmptyString(record.requestId)) {
    throw new Ms365RouterRequestError("requestId is required.");
  }
  return {
    name: record.name,
    args: record.args as Record<string, unknown>,
    sessionId: record.sessionId,
    requestId: record.requestId,
  };
}

function parseConnectBody(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.token)) {
    throw new Ms365RouterRequestError("token is required.");
  }
  return record.token;
}

function parseToggleBody(body: unknown): { siteId: string; enabled: boolean } {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.siteId)) {
    throw new Ms365RouterRequestError("siteId is required.");
  }
  if (typeof record.enabled !== "boolean") {
    throw new Ms365RouterRequestError("enabled must be a boolean.");
  }
  return { siteId: record.siteId, enabled: record.enabled };
}

function parseSessionScopeBody(body: unknown): { sessionId: string; enabled: boolean } {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.sessionId)) {
    throw new Ms365RouterRequestError("sessionId is required.");
  }
  if (typeof record.enabled !== "boolean") {
    throw new Ms365RouterRequestError("enabled must be a boolean.");
  }
  return { sessionId: record.sessionId, enabled: record.enabled };
}

function parseWriteModeBody(body: unknown): Ms365WriteMode {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const mode = (body as Record<string, unknown>).mode;
  if (mode !== "manual" && mode !== "auto") {
    throw new Ms365RouterRequestError('mode must be "manual" or "auto".');
  }
  return mode;
}

export interface Ms365RouterDeps {
  readonly tools: ToolDeps;
  readonly connector: Ms365Connector;
  readonly scopes: readonly string[];
  readonly siteScope: SiteScopeService;
  readonly writeMode: WriteModeStore;
  readonly sessionScope: Ms365SessionScope;
}

/** Build the MS365 router. The orchestrator mounts it via `service.mount`. */
export function createMs365Router(deps: Ms365RouterDeps): BoundaryRouter {
  return {
    name: "ms365",
    routes: [
      {
        method: "POST",
        path: MS365_TOOL_CALL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<ToolResult>> => {
          const call = parseToolCallBody(ctx.body);
          const result = await handleToolCall(deps.tools, call);
          return { status: 200, data: result };
        },
      },
      {
        method: "POST",
        path: MS365_CONNECT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<Ms365ViewData>> => {
          const token = parseConnectBody(ctx.body);
          await deps.connector.connectWithToken(token);
          return { status: 200, data: buildMs365View(deps.connector, deps.scopes) };
        },
      },
      {
        method: "GET",
        path: MS365_VIEW_PATH,
        handler: (): RouteResult<Ms365ViewData> => ({
          status: 200,
          data: buildMs365View(deps.connector, deps.scopes),
        }),
      },
      {
        method: "POST",
        path: MS365_DISCONNECT_PATH,
        handler: async (): Promise<RouteResult<Ms365ViewData>> => {
          await deps.connector.disconnect();
          return { status: 200, data: buildMs365View(deps.connector, deps.scopes) };
        },
      },
      {
        method: "POST",
        path: MS365_DEVICE_BEGIN_PATH,
        handler: async (): Promise<RouteResult<{ userCode?: string; verificationUri?: string; expiresInSec?: number; error?: string }>> => {
          if (!deps.connector.deviceConfigured()) {
            return { status: 200, data: { error: "not_configured" } };
          }
          return { status: 200, data: await deps.connector.beginDeviceCode() };
        },
      },
      {
        method: "POST",
        path: MS365_DEVICE_POLL_PATH,
        handler: async (): Promise<RouteResult<{ status: string; view?: Ms365ViewData }>> => {
          const status = await deps.connector.pollDeviceCode();
          return {
            status: 200,
            data:
              status === "connected"
                ? { status, view: buildMs365View(deps.connector, deps.scopes) }
                : { status },
          };
        },
      },
      {
        method: "GET",
        path: MS365_SITES_PATH,
        handler: async (): Promise<RouteResult<{ sites: Awaited<ReturnType<SiteScopeService["listJoinedSites"]>> }>> => ({
          status: 200,
          data: { sites: await deps.siteScope.listJoinedSites() },
        }),
      },
      {
        method: "POST",
        path: MS365_SITES_TOGGLE_PATH,
        handler: async (
          ctx: RouteContext,
        ): Promise<RouteResult<{ sites: Awaited<ReturnType<SiteScopeService["listJoinedSites"]>> }>> => {
          const { siteId, enabled } = parseToggleBody(ctx.body);
          await deps.siteScope.setSiteEnabled(siteId, enabled);
          return { status: 200, data: { sites: await deps.siteScope.listJoinedSites() } };
        },
      },
      {
        method: "GET",
        path: MS365_WRITE_MODE_PATH,
        handler: (): RouteResult<{ mode: Ms365WriteMode }> => ({
          status: 200,
          data: { mode: deps.writeMode.mode() },
        }),
      },
      {
        method: "POST",
        path: MS365_WRITE_MODE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ mode: Ms365WriteMode }>> => {
          const mode = parseWriteModeBody(ctx.body);
          await deps.writeMode.setMode(mode);
          return { status: 200, data: { mode: deps.writeMode.mode() } };
        },
      },
      {
        // Registers/revokes a session for MS365 tool access (P5.5 Task 5, PO decision
        // 2026-07-14). ONLY the Microsoft 365 tab is expected to call this route for its own
        // session id — the Task 2 scoped child token that the OpenCode child holds is scoped
        // to `MS365_TOOL_CALL_PATH` ONLY (see `ms365-scoped-token.test.ts`), so that child can
        // never reach this route to self-register. The main client token (used by the UI
        // process) does reach it, same as every other MS365 route.
        method: "POST",
        path: MS365_SESSION_SCOPE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ allowed: boolean }>> => {
          const { sessionId, enabled } = parseSessionScopeBody(ctx.body);
          if (enabled) {
            deps.sessionScope.allow(sessionId);
          } else {
            deps.sessionScope.revoke(sessionId);
          }
          return { status: 200, data: { allowed: deps.sessionScope.isAllowed(sessionId) } };
        },
      },
    ],
  };
}
