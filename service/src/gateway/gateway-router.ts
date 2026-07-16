import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { GatewayService } from "./gateway-service.js";
import type { GatewayAccount, GatewayStatus } from "./types.js";

export const GATEWAY_PATH = "/v1/gateway";

function parseAddAccountBody(body: unknown): { providerId: string; label: string; apiKey: string } {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const { providerId, label, apiKey } = record;
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    throw new BadRequestError("providerId is required.");
  }
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new BadRequestError("label is required.");
  }
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new BadRequestError("apiKey is required.");
  }
  return { providerId, label, apiKey };
}

/** Strip the apiKey — only credentialRef is returned, never the raw secret. */
function sanitizeAccount(account: GatewayAccount): Omit<GatewayAccount, never> {
  // GatewayAccount never carries apiKey; credentialRef is the handle. Return as-is.
  return account;
}

export function createGatewayRouter(service: GatewayService): BoundaryRouter {
  return {
    name: "gateway",
    routes: [
      {
        method: "GET" as const,
        path: `${GATEWAY_PATH}/status`,
        handler: async (_ctx: RouteContext): Promise<RouteResult<GatewayStatus>> => {
          const status = service.getStatus();
          return { status: 200, data: status };
        },
      },
      {
        method: "POST" as const,
        path: `${GATEWAY_PATH}/accounts`,
        handler: async (ctx: RouteContext): Promise<RouteResult<GatewayAccount>> => {
          const input = parseAddAccountBody(ctx.body);
          const account = await service.addAccount(input);
          return { status: 201, data: sanitizeAccount(account) };
        },
      },
      {
        method: "DELETE" as const,
        path: `${GATEWAY_PATH}/accounts/{id}`,
        handler: async (ctx: RouteContext): Promise<RouteResult<Record<string, never>>> => {
          const id = ctx.params["id"];
          if (typeof id !== "string" || id.length === 0) {
            throw new BadRequestError("Account id is required.");
          }
          await service.removeAccount(id);
          return { status: 204, data: {} };
        },
      },
      {
        method: "PUT" as const,
        path: `${GATEWAY_PATH}/accounts/{id}/activate`,
        handler: async (ctx: RouteContext): Promise<RouteResult<GatewayStatus>> => {
          const id = ctx.params["id"];
          if (typeof id !== "string" || id.length === 0) {
            throw new BadRequestError("Account id is required.");
          }
          await service.activateAccount(id);
          const status = service.getStatus();
          return { status: 200, data: status };
        },
      },
    ],
  };
}
