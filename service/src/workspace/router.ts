/**
 * Workspace boundary router (CGHC-008, mounts on the CGHC-002 loopback boundary, ADR 0003).
 *
 * The renderer picks a folder via the shell's native dialog, then POSTs the chosen absolute
 * path here — it never grants a workspace itself. Every route is TOKEN-GUARDED (no
 * `publicUnauthenticated`). Validation + grant happen server-side (`validateWorkspaceSelection`);
 * a rejection returns a `{ granted: false, reason, message }` payload with a 200 status (a valid
 * request with a business outcome) so the renderer can render the reason and start NO session.
 * Only a `{ granted: true, grant }` result records the workspace into the MRU list and can become
 * the active workspace. Recent entries are returned with a freshly-probed availability flag.
 */

import type { WorkspaceGrant } from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import {
  nodeFsProbe,
  validateWorkspaceSelection,
  type WorkspaceFsProbe,
  type WorkspaceRejectReason,
} from "./validate.js";
import { nodeExistenceProbe } from "./probe.js";
import type { RecentExistenceProbe, RecentWorkspaces, RecentWorkspaceView } from "./recent.js";

export const WORKSPACE_GRANT_PATH = "/v1/workspace/grant";
export const WORKSPACE_RECENT_PATH = "/v1/workspace/recent";

/**
 * Malformed grant request. Extends {@link BadRequestError} so the boundary dispatcher maps it
 * to HTTP 400 `bad_request` (not a misleading 500). Message is generic and NEVER contains the
 * raw path (review MEDIUM fix).
 */
export class WorkspaceRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRequestError";
  }
}

/** Response of `POST /v1/workspace/grant`: a grant, or a reasoned refusal (no grant). */
export type WorkspaceGrantResponse =
  | { readonly granted: true; readonly grant: WorkspaceGrant }
  | { readonly granted: false; readonly reason: WorkspaceRejectReason; readonly message: string };

export interface WorkspaceRouterOptions {
  /** Single source of truth for the MRU recent list. */
  readonly recent: RecentWorkspaces;
  /** Filesystem seam for validation; defaults to the real `node:fs` probe. */
  readonly fsProbe?: WorkspaceFsProbe;
  /** Existence probe for the recent list; defaults to the real `node:fs` probe. */
  readonly existsProbe?: RecentExistenceProbe;
}

function parseGrantBody(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new WorkspaceRequestError("Request body must be a JSON object.");
  }
  const rootPath = (body as Record<string, unknown>)["rootPath"];
  if (typeof rootPath !== "string" || rootPath.length === 0) {
    throw new WorkspaceRequestError("rootPath is required.");
  }
  return rootPath;
}

/**
 * Build the workspace router. Downstream orchestration mounts it via `startService({ routers })`
 * (same seam as the credential router). No route opts out of the token guard.
 */
export function createWorkspaceRouter(options: WorkspaceRouterOptions): BoundaryRouter {
  const { recent } = options;
  const fsProbe: WorkspaceFsProbe = options.fsProbe ?? nodeFsProbe();
  const existsProbe = options.existsProbe ?? nodeExistenceProbe;

  return {
    name: "workspace",
    routes: [
      {
        method: "POST",
        path: WORKSPACE_GRANT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<WorkspaceGrantResponse>> => {
          const rootPath = parseGrantBody(ctx.body);
          const result = await validateWorkspaceSelection({ rootPath }, fsProbe);
          if (!result.ok) {
            // A rejected pick never records into recent and never becomes active.
            return { status: 200, data: { granted: false, reason: result.reason, message: result.message } };
          }
          recent.record(result.grant);
          return { status: 201, data: { granted: true, grant: result.grant } };
        },
      },
      {
        method: "GET",
        path: WORKSPACE_RECENT_PATH,
        handler: async (): Promise<RouteResult<{ recent: readonly RecentWorkspaceView[] }>> => {
          const list = await recent.listWithAvailability(existsProbe);
          return { status: 200, data: { recent: list } };
        },
      },
    ],
  };
}
