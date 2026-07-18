/**
 * Runtime desktop-app HTTP routes (token-guarded like every boundary router).
 *
 * The renderer never spawns anything: it asks this router to detect capability, request a
 * Build/Run launch (which raises a `command_exec` permission), resolve that permission, and read
 * state/output. Enforcement lives entirely in {@link AppService}.
 */

import type { RuntimeAppStartInput } from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { InvalidLaunchError } from "../runtime-preview/launch-policy.js";
import type { AppService } from "./app-service.js";

export const RUNTIME_APP_DETECT_PATH = "/v1/runtime-app/detect";
export const RUNTIME_APP_STATE_PATH = "/v1/runtime-app/state";
export const RUNTIME_APP_OUTPUT_PATH = "/v1/runtime-app/output";
export const RUNTIME_APP_REQUEST_LAUNCH_PATH = "/v1/runtime-app/request-launch";
export const RUNTIME_APP_RESOLVE_PATH = "/v1/runtime-app/resolve";
export const RUNTIME_APP_STOP_PATH = "/v1/runtime-app/stop";
export const RUNTIME_APP_RESTART_PATH = "/v1/runtime-app/restart";

class AppRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "AppRequestError";
  }
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new AppRequestError("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function parseStartInput(body: unknown): RuntimeAppStartInput {
  const rec = asObject(body);
  const act = rec["action"];
  if (act !== "build" && act !== "run") {
    throw new AppRequestError("action must be 'build' or 'run'.");
  }
  const script = rec["script"];
  const packageManager = rec["packageManager"];
  return {
    action: act,
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

export function createRuntimeAppRouter(app: AppService): BoundaryRouter {
  return {
    name: "runtime-app",
    routes: [
      {
        method: "GET",
        path: RUNTIME_APP_DETECT_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { info: await app.detect() } }),
      },
      {
        method: "GET",
        path: RUNTIME_APP_STATE_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { state: app.state() } }),
      },
      {
        method: "GET",
        path: RUNTIME_APP_OUTPUT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const afterRaw = ctx.url.searchParams.get("after");
          const after = afterRaw === null ? 0 : Number.parseInt(afterRaw, 10);
          return { status: 200, data: { output: app.output(Number.isFinite(after) ? after : 0) } };
        },
      },
      {
        method: "POST",
        path: RUNTIME_APP_REQUEST_LAUNCH_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> =>
          guard(async () => {
            const input = parseStartInput(ctx.body);
            const result = await app.requestLaunch(input);
            return { status: 200, data: result };
          }),
      },
      {
        method: "POST",
        path: RUNTIME_APP_RESOLVE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const rec = asObject(ctx.body);
          const requestId = rec["requestId"];
          const decision = rec["decision"];
          if (typeof requestId !== "string" || requestId.length === 0) {
            throw new AppRequestError("requestId is required.");
          }
          if (decision !== "allow" && decision !== "deny") {
            throw new AppRequestError("decision must be 'allow' or 'deny'.");
          }
          return { status: 200, data: { state: await app.resolveLaunch(requestId, decision) } };
        },
      },
      {
        method: "POST",
        path: RUNTIME_APP_STOP_PATH,
        handler: async (): Promise<RouteResult> => ({ status: 200, data: { state: await app.stop("user") } }),
      },
      {
        method: "POST",
        path: RUNTIME_APP_RESTART_PATH,
        handler: async (): Promise<RouteResult> =>
          guard(async () => ({ status: 200, data: { state: await app.restart() } })),
      },
    ],
  };
}
