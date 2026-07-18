import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { GatewayProxyUnavailableError, type GatewayService } from "./gateway-service.js";
import type { GatewayAccount, GatewayRequestLogEntry, GatewayStatus } from "./types.js";

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

function parseLinkAccountBody(
  body: unknown,
): { providerId: string; label: string; credentialAccount: string } {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const { providerId, label, credentialAccount } = record;
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    throw new BadRequestError("providerId is required.");
  }
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new BadRequestError("label is required.");
  }
  if (typeof credentialAccount !== "string" || credentialAccount.trim().length === 0) {
    throw new BadRequestError("credentialAccount is required.");
  }
  return { providerId, label, credentialAccount };
}

export function createGatewayRouter(service: GatewayService): BoundaryRouter {
  return {
    name: "gateway",
    routes: [
      {
        method: "GET" as const,
        path: `${GATEWAY_PATH}/status`,
        handler: async (_ctx: RouteContext): Promise<RouteResult<GatewayStatus>> => {
          await service.refreshFromDisk();
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
          return { status: 201, data: account };
        },
      },
      {
        method: "POST" as const,
        path: `${GATEWAY_PATH}/accounts/link`,
        handler: async (ctx: RouteContext): Promise<RouteResult<GatewayAccount>> => {
          const input = parseLinkAccountBody(ctx.body);
          const account = await service.linkAccount(input);
          return { status: 201, data: account };
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
      {
        method: "PUT" as const,
        path: `${GATEWAY_PATH}/enabled`,
        handler: async (ctx: RouteContext): Promise<RouteResult<GatewayStatus>> => {
          const record = ctx.body as Record<string, unknown> | null;
          const enabled = record?.["enabled"];
          if (typeof enabled !== "boolean") {
            throw new BadRequestError("enabled must be a boolean.");
          }
          try {
            await service.setEnabled(enabled);
          } catch (err) {
            // Only boundary-owned error types (BadRequestError et al.) keep their real message
            // through `HttpService.fail` — rewrap so the UI actually sees the honest reason
            // instead of a generic "Internal boundary error."
            if (err instanceof GatewayProxyUnavailableError) {
              throw new BadRequestError(err.message);
            }
            throw err;
          }
          return { status: 200, data: service.getStatus() };
        },
      },
      {
        method: "PUT" as const,
        path: `${GATEWAY_PATH}/server-port`,
        handler: async (ctx: RouteContext): Promise<RouteResult<GatewayStatus>> => {
          const record = ctx.body as Record<string, unknown> | null;
          const port = record?.["port"];
          if (typeof port !== "number" || !Number.isInteger(port)) {
            throw new BadRequestError("port must be an integer.");
          }
          try {
            await service.setConfiguredPort(port);
          } catch (err) {
            // `setServerPort` throws a plain Error for an out-of-range port — rewrap so the
            // real (secret-free) validation message reaches the UI, not a generic 500.
            throw new BadRequestError(err instanceof Error ? err.message : "Invalid port.");
          }
          return { status: 200, data: service.getStatus() };
        },
      },
      {
        method: "GET" as const,
        path: `${GATEWAY_PATH}/logs`,
        handler: async (
          _ctx: RouteContext,
        ): Promise<RouteResult<{ logs: readonly GatewayRequestLogEntry[] }>> => {
          await service.refreshFromDisk();
          return { status: 200, data: { logs: service.listLogs() } };
        },
      },
    ],
  };
}
