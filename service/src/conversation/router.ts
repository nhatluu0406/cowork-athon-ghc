/**
 * Conversation HTTP router — CRUD + message append.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { ConversationStore } from "./store.js";
import type { ConversationStatus, ConversationPatch, PersistedActivitySnapshot, RuntimeTurnRecord } from "./types.js";
import { normalizeTitle } from "./title.js";

export const CONVERSATIONS_PATH = "/v1/conversations";
export const CONVERSATION_ITEM_PATH = "/v1/conversations/{id}";
export const CONVERSATION_MESSAGES_PATH = "/v1/conversations/{id}/messages";
export const CONVERSATION_LAST_ACTIVE_PATH = "/v1/conversations/last-active";

export class ConversationRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "ConversationRequestError";
  }
}

function requireId(params: Readonly<Record<string, string>>): string {
  const id = params["id"];
  if (id === undefined || id.length === 0) throw new ConversationRequestError("id is required.");
  return id;
}

function parseCreateBody(body: unknown) {
  if (typeof body !== "object" || body === null) throw new ConversationRequestError("Body must be an object.");
  const rec = body as Record<string, unknown>;
  const workspacePath = rec["workspacePath"];
  if (typeof workspacePath !== "string" || workspacePath.trim().length === 0) {
    throw new ConversationRequestError("workspacePath is required.");
  }
  const title = rec["title"];
  if (title !== undefined && typeof title !== "string") {
    throw new ConversationRequestError("title must be a string.");
  }
  const parentId = rec["parentId"];
  if (parentId !== undefined && typeof parentId !== "string") {
    throw new ConversationRequestError("parentId must be a string.");
  }
  return {
    workspacePath: workspacePath.trim(),
    ...(typeof title === "string" ? { title } : {}),
    ...(typeof rec["providerId"] === "string" ? { providerId: rec["providerId"] } : {}),
    ...(typeof rec["modelId"] === "string" ? { modelId: rec["modelId"] } : {}),
    ...(typeof parentId === "string" ? { parentId } : {}),
  };
}

function parseStatus(value: unknown): ConversationStatus {
  const allowed: readonly ConversationStatus[] = [
    "draft", "ready", "running", "completed", "cancelled", "errored", "interrupted",
  ];
  if (typeof value !== "string" || !allowed.includes(value as ConversationStatus)) {
    throw new ConversationRequestError("Invalid status.");
  }
  return value as ConversationStatus;
}

function parseRuntimeTurn(value: unknown): RuntimeTurnRecord {
  if (typeof value !== "object" || value === null) {
    throw new ConversationRequestError("registerRuntimeTurn must be an object.");
  }
  const rec = value as Record<string, unknown>;
  const runtimeSessionId = rec["runtimeSessionId"];
  const startedAt = rec["startedAt"];
  const status = rec["status"];
  if (typeof runtimeSessionId !== "string" || typeof startedAt !== "string") {
    throw new ConversationRequestError("registerRuntimeTurn requires runtimeSessionId and startedAt.");
  }
  if (status !== "running" && status !== "completed" && status !== "cancelled" && status !== "errored") {
    throw new ConversationRequestError("Invalid registerRuntimeTurn.status.");
  }
  return { runtimeSessionId, startedAt, status };
}

function parseCompleteRuntimeTurn(value: unknown): {
  runtimeSessionId: string;
  completedAt: string;
  status: RuntimeTurnRecord["status"];
} {
  if (typeof value !== "object" || value === null) {
    throw new ConversationRequestError("completeRuntimeTurn must be an object.");
  }
  const rec = value as Record<string, unknown>;
  const runtimeSessionId = rec["runtimeSessionId"];
  const completedAt = rec["completedAt"];
  const status = rec["status"];
  if (typeof runtimeSessionId !== "string" || typeof completedAt !== "string") {
    throw new ConversationRequestError("completeRuntimeTurn requires runtimeSessionId and completedAt.");
  }
  if (status !== "running" && status !== "completed" && status !== "cancelled" && status !== "errored") {
    throw new ConversationRequestError("Invalid completeRuntimeTurn.status.");
  }
  return { runtimeSessionId, completedAt, status: status as RuntimeTurnRecord["status"] };
}

export function createConversationRouter(store: ConversationStore): BoundaryRouter {
  return {
    name: "conversation",
    routes: [
      {
        method: "GET",
        path: CONVERSATION_LAST_ACTIVE_PATH,
        handler: async (): Promise<RouteResult> => ({
          status: 200,
          data: { conversationId: await store.getLastActiveId() },
        }),
      },
      {
        method: "GET",
        path: CONVERSATIONS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const q = ctx.url.searchParams.get("q") ?? undefined;
          return { status: 200, data: { conversations: await store.list(q) } };
        },
      },
      {
        method: "POST",
        path: CONVERSATIONS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const conversation = await store.create(parseCreateBody(ctx.body));
          return { status: 201, data: { conversation } };
        },
      },
      {
        method: "GET",
        path: CONVERSATION_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const conversation = await store.get(requireId(ctx.params));
          if (conversation === undefined) return { status: 404, data: { error: "not_found" } };
          return { status: 200, data: { conversation } };
        },
      },
      {
        method: "PATCH",
        path: CONVERSATION_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx.params);
          if (typeof ctx.body !== "object" || ctx.body === null) {
            throw new ConversationRequestError("Body must be an object.");
          }
          const rec = ctx.body as Record<string, unknown>;

          const patch: ConversationPatch = {
            ...(typeof rec["title"] === "string" ? { title: normalizeTitle(rec["title"]) } : {}),
            ...(rec["status"] !== undefined ? { status: parseStatus(rec["status"]) } : {}),
            ...(rec["runtimeSessionId"] === null ? { runtimeSessionId: null } : {}),
            ...(typeof rec["runtimeSessionId"] === "string"
              ? { runtimeSessionId: rec["runtimeSessionId"] }
              : {}),
            ...(rec["activity"] !== undefined && typeof rec["activity"] === "object"
              ? { activity: rec["activity"] as PersistedActivitySnapshot }
              : {}),
            ...(rec["registerRuntimeTurn"] !== undefined
              ? { registerRuntimeTurn: parseRuntimeTurn(rec["registerRuntimeTurn"]) }
              : {}),
            ...(rec["completeRuntimeTurn"] !== undefined
              ? { completeRuntimeTurn: parseCompleteRuntimeTurn(rec["completeRuntimeTurn"]) }
              : {}),
          };

          if (Object.keys(patch).length === 0 && rec["lastActive"] !== true) {
            throw new ConversationRequestError("No supported patch fields.");
          }

          let conversation =
            Object.keys(patch).length > 0 ? await store.patch(id, patch) : await store.get(id);
          if (conversation === undefined) return { status: 404, data: { error: "not_found" } };

          if (rec["lastActive"] === true) {
            await store.setLastActiveId(id);
          }

          return { status: 200, data: { conversation } };
        },
      },
      {
        method: "DELETE",
        path: CONVERSATION_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const removed = await store.delete(requireId(ctx.params));
          if (!removed) return { status: 404, data: { error: "not_found" } };
          return { status: 200, data: { deleted: true } };
        },
      },
      {
        method: "POST",
        path: CONVERSATION_MESSAGES_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          if (typeof ctx.body !== "object" || ctx.body === null) {
            throw new ConversationRequestError("Body must be an object.");
          }
          const rec = ctx.body as Record<string, unknown>;
          const role = rec["role"];
          const text = rec["text"];
          const attachments = rec["attachments"];
          if (role !== "user" && role !== "assistant") {
            throw new ConversationRequestError("role must be user or assistant.");
          }
          if (typeof text !== "string") throw new ConversationRequestError("text is required.");
          const conversation = await store.appendMessage(requireId(ctx.params), {
            role,
            text,
            ...(Array.isArray(attachments) ? { attachments } : {}),
          });
          return { status: 200, data: { conversation } };
        },
      },
    ],
  };
}
