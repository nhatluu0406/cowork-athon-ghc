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
import { detectLocalOneDrive } from "./onedrive-local.js";
import { handleToolCall, type ToolCall, type ToolDeps, type ToolResult, type Ms365ToolName } from "./ms365-tools.js";
import type { SiteScopeService } from "./site-scope-service.js";
import type { Ms365WriteMode, WriteModeStore } from "./write-mode-store.js";
import type { Ms365SessionScope } from "./ms365-session-scope.js";
import { DEFAULT_FLOW_TIMEOUT_MS, type PowerAutomateStore } from "./power-automate-store.js";

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
export const MS365_FLOWS_PATH = "/v1/ms365/flows";
export const MS365_FLOWS_DELETE_PATH = "/v1/ms365/flows/delete";
export const MS365_FLOWS_TOGGLE_PATH = "/v1/ms365/flows/toggle";
export const MS365_FLOWS_TIMEOUT_PATH = "/v1/ms365/flows/timeout";
export const MS365_FLOWS_UPDATE_PATH = "/v1/ms365/flows/update";

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
  "calendar_list_events",
  "calendar_search_events",
  "calendar_create_event",
  "onedrive_search_files",
  "onedrive_list_folder",
  "power_automate_list_flows",
  "power_automate_trigger_flow",
  "resolve_user",
  "get_me",
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

interface PublicFlow {
  name: string;
  enabled: boolean;
  timeoutMs: number;
  description: string;
  payloadSchema: string;
}

function publicFlows(store: PowerAutomateStore): PublicFlow[] {
  return store.list().map((f) => ({ name: f.name, enabled: f.enabled, timeoutMs: f.timeoutMs, description: f.description, payloadSchema: f.payloadSchema }));
}

/** Empty is allowed; otherwise the text must be parseable JSON. Returns the text or throws 400. */
function validateSchemaText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Ms365RouterRequestError("payloadSchema must be a string.");
  if (value.length === 0) return "";
  try {
    JSON.parse(value);
  } catch {
    throw new Ms365RouterRequestError("payloadSchema must be valid JSON.");
  }
  return value;
}

function parseAddFlowBody(body: unknown): { name: string; url: string; description: string; payloadSchema: string; timeoutMs?: number } {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.name)) throw new Ms365RouterRequestError("name is required.");
  if (!nonEmptyString(record.url)) throw new Ms365RouterRequestError("url is required.");
  const out: { name: string; url: string; description: string; payloadSchema: string; timeoutMs?: number } = {
    name: record.name,
    url: record.url,
    description: typeof record.description === "string" ? record.description : "",
    payloadSchema: validateSchemaText(record.payloadSchema),
  };
  if (typeof record.timeoutMs === "number") out.timeoutMs = record.timeoutMs;
  return out;
}

function parseUpdateFlowBody(body: unknown): { name: string; description: string; timeoutMs: number; payloadSchema: string; url?: string } {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.name)) throw new Ms365RouterRequestError("name is required.");
  if (typeof record.timeoutMs !== "number") throw new Ms365RouterRequestError("timeoutMs must be a number.");
  const out: { name: string; description: string; timeoutMs: number; payloadSchema: string; url?: string } = {
    name: record.name,
    description: typeof record.description === "string" ? record.description : "",
    timeoutMs: record.timeoutMs,
    payloadSchema: validateSchemaText(record.payloadSchema),
  };
  if (nonEmptyString(record.url)) out.url = record.url;
  return out;
}

function parseFlowNameBody(body: unknown): { name: string } {
  if (typeof body !== "object" || body === null) {
    throw new Ms365RouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (!nonEmptyString(record.name)) throw new Ms365RouterRequestError("name is required.");
  return { name: record.name };
}

function parseFlowToggleBody(body: unknown): { name: string; enabled: boolean } {
  const { name } = parseFlowNameBody(body);
  const enabled = (body as Record<string, unknown>).enabled;
  if (typeof enabled !== "boolean") throw new Ms365RouterRequestError("enabled must be a boolean.");
  return { name, enabled };
}

function parseFlowTimeoutBody(body: unknown): { name: string; timeoutMs: number } {
  const { name } = parseFlowNameBody(body);
  const timeoutMs = (body as Record<string, unknown>).timeoutMs;
  if (typeof timeoutMs !== "number") throw new Ms365RouterRequestError("timeoutMs must be a number.");
  return { name, timeoutMs };
}

export interface Ms365RouterDeps {
  readonly tools: ToolDeps;
  readonly connector: Ms365Connector;
  readonly scopes: readonly string[];
  readonly siteScope: SiteScopeService;
  readonly writeMode: WriteModeStore;
  readonly sessionScope: Ms365SessionScope;
  readonly powerAutomateStore: PowerAutomateStore;
}

/** Build the MS365 router. The orchestrator mounts it via `service.mount`. */
export function createMs365Router(deps: Ms365RouterDeps): BoundaryRouter {
  // The connected view + the local OneDrive folder (detected fresh per request — it is a cheap
  // env+existsSync check and the folder can appear/disappear while the app runs).
  const view = (): Ms365ViewData =>
    buildMs365View(deps.connector, deps.scopes, detectLocalOneDrive());
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
          return { status: 200, data: view() };
        },
      },
      {
        method: "GET",
        path: MS365_VIEW_PATH,
        handler: (): RouteResult<Ms365ViewData> => ({
          status: 200,
          data: view(),
        }),
      },
      {
        method: "POST",
        path: MS365_DISCONNECT_PATH,
        handler: async (): Promise<RouteResult<Ms365ViewData>> => {
          // Defense-in-depth: clear every MS365-scoped session so no session retains tool
          // access after disconnect (independent of the UI's per-session revoke). Done BEFORE
          // connector.disconnect() so tool access is revoked even if disconnect throws.
          deps.sessionScope.revokeAll();
          await deps.connector.disconnect();
          return { status: 200, data: view() };
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
                ? { status, view: view() }
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
      {
        method: "GET",
        path: MS365_FLOWS_PATH,
        handler: (): RouteResult<{ flows: PublicFlow[] }> => ({
          status: 200,
          data: { flows: publicFlows(deps.powerAutomateStore) },
        }),
      },
      {
        method: "POST",
        path: MS365_FLOWS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name, url, description, payloadSchema, timeoutMs } = parseAddFlowBody(ctx.body);
          if (deps.powerAutomateStore.resolve(name) !== null) {
            throw new Ms365RouterRequestError("A flow with this name already exists.");
          }
          await deps.powerAutomateStore.add({ name, url, description, payloadSchema, timeoutMs: timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS });
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
      {
        method: "POST",
        path: MS365_FLOWS_DELETE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name } = parseFlowNameBody(ctx.body);
          await deps.powerAutomateStore.remove(name);
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
      {
        method: "POST",
        path: MS365_FLOWS_TOGGLE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name, enabled } = parseFlowToggleBody(ctx.body);
          await deps.powerAutomateStore.setEnabled(name, enabled);
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
      {
        method: "POST",
        path: MS365_FLOWS_TIMEOUT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name, timeoutMs } = parseFlowTimeoutBody(ctx.body);
          await deps.powerAutomateStore.setTimeout(name, timeoutMs);
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
      {
        method: "POST",
        path: MS365_FLOWS_UPDATE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ flows: PublicFlow[] }>> => {
          const { name, description, timeoutMs, payloadSchema, url } = parseUpdateFlowBody(ctx.body);
          if (deps.powerAutomateStore.resolve(name) === null) {
            throw new Ms365RouterRequestError("No flow with this name exists.");
          }
          await deps.powerAutomateStore.update(name, url !== undefined ? { description, timeoutMs, payloadSchema, url } : { description, timeoutMs, payloadSchema });
          return { status: 200, data: { flows: publicFlows(deps.powerAutomateStore) } };
        },
      },
    ],
  };
}
