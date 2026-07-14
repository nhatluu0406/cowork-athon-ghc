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

export const MS365_TOOL_CALL_PATH = "/v1/ms365/tool-call";
export const MS365_CONNECT_PATH = "/v1/ms365/connect";
export const MS365_VIEW_PATH = "/v1/ms365/view";

const TOOL_NAMES: readonly Ms365ToolName[] = [
  "sharepoint_search",
  "sharepoint_list_site_files",
  "sharepoint_get_file_summary",
  "sharepoint_upload_file",
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

export interface Ms365RouterDeps {
  readonly tools: ToolDeps;
  readonly connector: Ms365Connector;
  readonly scopes: readonly string[];
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
    ],
  };
}
