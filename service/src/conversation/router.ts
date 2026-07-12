/**
 * Conversation HTTP router — persisted multi-session management.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { ConversationStore } from "./store.js";
import type { ConversationStatus } from "./types.js";
import { normalizeTitle } from "./title.js";

export const CONVERSATIONS_PATH = "/v1/conversations";
export const CONVERSATION_ITEM_PATH = "/v1/conversations/{id}";
export const CONVERSATION_MESSAGES_PATH = "/v1/conversations/{id}/messages";

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

export function createConversationRouter(store: ConversationStore): BoundaryRouter {
  return {
    name: "conversation",
    routes: [
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
          if (typeof rec["title"] === "string") {
            const conversation = await store.rename(id, normalizeTitle(rec["title"]));
            return { status: 200, data: { conversation } };
          }
          if (rec["status"] !== undefined) {
            const conversation = await store.updateStatus(id, parseStatus(rec["status"]));
            return { status: 200, data: { conversation } };
          }
          if (rec["runtimeSessionId"] === null) {
            const conversation = await store.setRuntimeSession(id, null);
            return { status: 200, data: { conversation } };
          }
          if (typeof rec["runtimeSessionId"] === "string") {
            const conversation = await store.setRuntimeSession(id, rec["runtimeSessionId"]);
            return { status: 200, data: { conversation } };
          }
          throw new ConversationRequestError("No supported patch fields.");
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
          if (role !== "user" && role !== "assistant") {
            throw new ConversationRequestError("role must be user or assistant.");
          }
          if (typeof text !== "string") throw new ConversationRequestError("text is required.");
          const conversation = await store.appendMessage(requireId(ctx.params), { role, text });
          return { status: 200, data: { conversation } };
        },
      },
    ],
  };
}
