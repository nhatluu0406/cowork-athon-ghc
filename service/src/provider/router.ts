/**
 * Provider boundary router (mounts on the CGHC-002 loopback boundary, ADR 0003/0005).
 *
 * SECURITY: every route is TOKEN-GUARDED — no `publicUnauthenticated` (forbidden for
 * provider routes, per the CGHC-002 carry-forward). This router exposes ONLY provider
 * MANAGEMENT that this task owns: list descriptors and configure the custom endpoint's
 * base_url (SSRF-validated at the service). It deliberately exposes NO way to pass the
 * SSRF test-mode escape flag — that flag is a launch-config input, never a request field,
 * so it is unreachable from the renderer / model-generated content (ADR 0005 guardrail).
 *
 * Credential add + test-connection routes are OUT of scope here (CGHC-011); model routes
 * are CGHC-019. This keeps the surface minimal and the SSRF seam the only wire concern.
 */

import type { ProviderDescriptor } from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { SsrfBlockedError } from "./ssrf-policy.js";
import type { ProviderPort } from "./provider-port.js";

export const PROVIDERS_PATH = "/v1/providers";
export const PROVIDER_ENDPOINT_PATH = "/v1/providers/endpoint";

/**
 * Malformed / policy-refused provider request (bad client input: a malformed body or an
 * SSRF-refused base_url). Extends {@link BadRequestError} so the boundary dispatcher maps it to
 * HTTP 400 (not a misleading 500). The message stays generic and never carries a secret.
 */
export class ProviderRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

interface EndpointBody {
  readonly id: string;
  readonly baseUrl: string;
}

function parseEndpointBody(body: unknown): EndpointBody {
  if (typeof body !== "object" || body === null) {
    throw new ProviderRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const { id, baseUrl } = record;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new ProviderRequestError("id is required.");
  }
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    throw new ProviderRequestError("baseUrl is required.");
  }
  // NOTE: any `loopbackEscape`/test-mode field in the body is intentionally IGNORED — the
  // SSRF escape is decided by launch config baked into the port's policy, not the caller.
  return { id, baseUrl };
}

/** Build the provider router. The orchestrator mounts it via `service.mount`. */
export function createProviderRouter(port: ProviderPort): BoundaryRouter {
  return {
    name: "provider",
    routes: [
      {
        method: "GET",
        path: PROVIDERS_PATH,
        handler: (): RouteResult<{ providers: readonly ProviderDescriptor[] }> => ({
          status: 200,
          data: { providers: port.list() },
        }),
      },
      {
        method: "POST",
        path: PROVIDER_ENDPOINT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ configured: true }>> => {
          const input = parseEndpointBody(ctx.body);
          try {
            await port.configureEndpoint(input.id, { baseUrl: input.baseUrl });
          } catch (cause) {
            if (cause instanceof SsrfBlockedError) {
              // Non-secret, mapped refusal — the UI surfaces it; the action is blocked.
              throw new ProviderRequestError(`base_url refused by SSRF policy: ${cause.reason}`);
            }
            throw cause;
          }
          return { status: 200, data: { configured: true } };
        },
      },
    ],
  };
}
