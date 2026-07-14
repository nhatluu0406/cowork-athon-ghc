/**
 * Agent catalog HTTP router (agent-harness-plan.md Task 5.1). Token-guarded like every sensitive
 * route. Read routes project the catalog; write routes validate a draft and persist a user agent.
 * Built-in agents are read-only (update/delete refuse). The router owns no policy — it delegates
 * to the {@link AgentCatalog}, whose validator enforces narrowing-only permission presets.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { AgentCatalogError, type AgentCatalog, type AgentDraft } from "./catalog.js";

export const AGENTS_PATH = "/v1/agents";
export const AGENT_ITEM_PATH = "/v1/agents/{id}";

export class AgentRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "AgentRequestError";
  }
}

function parseDraft(body: unknown): AgentDraft {
  if (typeof body !== "object" || body === null) {
    throw new AgentRequestError("Body must be a JSON object.");
  }
  const rec = body as Record<string, unknown>;
  if (typeof rec["name"] !== "string") throw new AgentRequestError("name is required.");
  if (typeof rec["systemPrompt"] !== "string") throw new AgentRequestError("systemPrompt is required.");
  const skillIds = rec["skillIds"];
  if (skillIds !== undefined && !Array.isArray(skillIds)) {
    throw new AgentRequestError("skillIds, when present, must be an array.");
  }
  const preset = rec["permissionPreset"];
  if (preset !== undefined && (typeof preset !== "object" || preset === null || Array.isArray(preset))) {
    throw new AgentRequestError("permissionPreset, when present, must be an object.");
  }
  return {
    ...(typeof rec["id"] === "string" ? { id: rec["id"] } : {}),
    name: rec["name"],
    systemPrompt: rec["systemPrompt"],
    ...(Array.isArray(skillIds) ? { skillIds: skillIds.filter((s): s is string => typeof s === "string") } : {}),
    ...(preset !== undefined ? { permissionPreset: preset as Record<string, string> } : {}),
    ...(isModelInput(rec["model"]) ? { model: rec["model"] } : {}),
  };
}

function isModelInput(value: unknown): value is { providerID: string; modelID: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["providerID"] === "string" &&
    typeof (value as Record<string, unknown>)["modelID"] === "string"
  );
}

function requireId(params: Readonly<Record<string, string>>): string {
  const id = params["id"];
  if (id === undefined || id.length === 0) throw new AgentRequestError("id is required.");
  return id;
}

/** Map a catalog error to a 400 so a bad draft never surfaces as a 500. */
function guard<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof AgentCatalogError) throw new AgentRequestError(err.message);
    throw err;
  });
}

export function createAgentRouter(catalog: AgentCatalog): BoundaryRouter {
  return {
    name: "agents",
    routes: [
      {
        method: "GET",
        path: AGENTS_PATH,
        handler: (): RouteResult => ({ status: 200, data: { agents: catalog.list() } }),
      },
      {
        method: "POST",
        path: AGENTS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const agent = await guard(() => catalog.createUserAgent(parseDraft(ctx.body)));
          return { status: 201, data: { agent } };
        },
      },
      {
        method: "PUT",
        path: AGENT_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const agent = await guard(() => catalog.updateUserAgent(requireId(ctx.params), parseDraft(ctx.body)));
          return { status: 200, data: { agent } };
        },
      },
      {
        method: "DELETE",
        path: AGENT_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          await guard(() => catalog.deleteUserAgent(requireId(ctx.params)));
          return { status: 200, data: { deleted: true } };
        },
      },
    ],
  };
}
