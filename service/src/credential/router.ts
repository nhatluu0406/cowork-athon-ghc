/**
 * Credential boundary router (mounts on the CGHC-002 loopback boundary, ADR 0003/0006).
 *
 * SECURITY: every route is TOKEN-GUARDED (no `publicUnauthenticated` — that is forbidden
 * for credential routes, per CGHC-002 carry-forward). A key value crosses this boundary
 * ONLY inbound, in the request body of a store call; the response carries ONLY a
 * secret-free {@link CredentialRef} handle (AC3). No key is ever placed in a response
 * envelope or a log line here.
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import type { CredentialService } from "./credential-service.js";

export const CREDENTIALS_PATH = "/v1/credentials";

/** Malformed credential request. Its message is generic and NEVER contains the secret. */
export class CredentialRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialRequestError";
  }
}

interface StoreBody {
  readonly providerId: string;
  readonly secret: string;
  readonly account?: string;
}

function parseStoreBody(body: unknown): StoreBody {
  if (typeof body !== "object" || body === null) {
    throw new CredentialRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const { providerId, secret, account } = record;
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    throw new CredentialRequestError("providerId is required.");
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new CredentialRequestError("secret is required.");
  }
  if (account !== undefined && typeof account !== "string") {
    throw new CredentialRequestError("account, when present, must be a string.");
  }
  return account === undefined ? { providerId, secret } : { providerId, secret, account };
}

function parseRefBody(body: unknown): CredentialRef {
  if (typeof body !== "object" || body === null) {
    throw new CredentialRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const ref = record["ref"];
  if (typeof ref !== "object" || ref === null) {
    throw new CredentialRequestError("ref is required.");
  }
  const { store, account } = ref as Record<string, unknown>;
  if (store !== "os" || typeof account !== "string" || account.length === 0) {
    throw new CredentialRequestError("ref must be { store: \"os\", account: string }.");
  }
  return { store, account };
}

/**
 * Build the credential router. Downstream orchestration mounts it via `service.mount`
 * (or `startService({ routers })`). No route opts out of the token guard.
 */
export function createCredentialRouter(service: CredentialService): BoundaryRouter {
  return {
    name: "credential",
    routes: [
      {
        method: "POST",
        path: CREDENTIALS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ ref: CredentialRef }>> => {
          const input = parseStoreBody(ctx.body);
          const ref = await service.store(input);
          // Response carries the handle ONLY — never the secret.
          return { status: 201, data: { ref } };
        },
      },
      {
        method: "DELETE",
        path: CREDENTIALS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ removed: boolean }>> => {
          const ref = parseRefBody(ctx.body);
          const removed = await service.remove(ref);
          return { status: 200, data: { removed } };
        },
      },
    ],
  };
}
