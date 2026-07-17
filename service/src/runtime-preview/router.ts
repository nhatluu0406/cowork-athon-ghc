/**
 * Runtime preview HTTP routes (token-guarded like every boundary router).
 *
 * The renderer never spawns anything: it asks this router to detect capability, request a
 * launch (which raises a `command_exec` permission), resolve that permission, and read
 * state/output. Enforcement lives entirely in {@link PreviewService}.
 */

import type { RuntimePreviewStartInput } from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { InvalidLaunchError } from "./launch-policy.js";
import type { PreviewService } from "./preview-service.js";

export const RUNTIME_PREVIEW_DETECT_PATH = "/v1/runtime-preview/detect";
export const RUNTIME_PREVIEW_STATE_PATH = "/v1/runtime-preview/state";
export const RUNTIME_PREVIEW_OUTPUT_PATH = "/v1/runtime-preview/output";
export const RUNTIME_PREVIEW_START_STATIC_PATH = "/v1/runtime-preview/start-static";
export const RUNTIME_PREVIEW_REQUEST_LAUNCH_PATH = "/v1/runtime-preview/request-launch";
export const RUNTIME_PREVIEW_RESOLVE_PATH = "/v1/runtime-preview/resolve";
export const RUNTIME_PREVIEW_STOP_PATH = "/v1/runtime-preview/stop";
export const RUNTIME_PREVIEW_RESTART_PATH = "/v1/runtime-preview/restart";

class PreviewRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "PreviewRequestError";
  }
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new PreviewRequestError("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function parseStartInput(body: unknown): RuntimePreviewStartInput {
  const rec = asObject(body);
  const kind = rec["kind"];
  if (kind !== "dev-server" && kind !== "static") {
    throw new PreviewRequestError("kind must be 'dev-server' or 'static'.");
  }
  const script = rec["script"];
  const packageManager = rec["packageManager"];
  return {
    kind,
    ...(typeof script === "string" ? { script } : {}),
    ...(packageManager === "npm" || packageManager === "pnpm" || packageManager === "yarn"
      ? { packageManager }
      : {}),
  };
}

/** Map an InvalidLaunchError to a 400 with a non-secret message. */
function guard(fn: () => Promise<RouteResult>): Promise<RouteResult> {
  return fn().catch((err) => {
    if (err instanceof InvalidLaunchError) {
      return { status: 400, data: { error: "invalid_launch", message: err.message } };
    }
    throw err;
  });
}

export function createRuntimePreviewRouter(preview: PreviewService): BoundaryRouter {
  return {
    name: "runtime-preview",
    routes: [
      {
        method: "GET",
        path: RUNTIME_PREVIEW_DETECT_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { info: await preview.detect() } }),
      },
      {
        method: "GET",
        path: RUNTIME_PREVIEW_STATE_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { state: preview.state() } }),
      },
      {
        method: "GET",
        path: RUNTIME_PREVIEW_OUTPUT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const afterRaw = ctx.url.searchParams.get("after");
          const after = afterRaw === null ? 0 : Number.parseInt(afterRaw, 10);
          return { status: 200, data: { output: preview.output(Number.isFinite(after) ? after : 0) } };
        },
      },
      {
        method: "POST",
        path: RUNTIME_PREVIEW_START_STATIC_PATH,
        handler: async (): Promise<RouteResult> =>
          guard(async () => ({ status: 200, data: { state: await preview.startStaticPreview() } })),
      },
      {
        method: "POST",
        path: RUNTIME_PREVIEW_REQUEST_LAUNCH_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> =>
          guard(async () => {
            const input = parseStartInput(ctx.body);
            const result = await preview.requestLaunch(input);
            return { status: 200, data: result };
          }),
      },
      {
        method: "POST",
        path: RUNTIME_PREVIEW_RESOLVE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const rec = asObject(ctx.body);
          const requestId = rec["requestId"];
          const decision = rec["decision"];
          if (typeof requestId !== "string" || requestId.length === 0) {
            throw new PreviewRequestError("requestId is required.");
          }
          if (decision !== "allow" && decision !== "deny") {
            throw new PreviewRequestError("decision must be 'allow' or 'deny'.");
          }
          return { status: 200, data: { state: await preview.resolveLaunch(requestId, decision) } };
        },
      },
      {
        method: "POST",
        path: RUNTIME_PREVIEW_STOP_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { state: await preview.stop("user") } }),
      },
      {
        method: "POST",
        path: RUNTIME_PREVIEW_RESTART_PATH,
        handler: async (): Promise<RouteResult> =>
          guard(async () => ({ status: 200, data: { state: await preview.restart() } })),
      },
    ],
  };
}
