/**
 * File review HTTP routes (snapshot capture + review build).
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { buildFileReviewArtifact } from "./review.js";
import { captureWorkspaceFileSnapshot } from "./snapshot.js";
import type { FileSnapshotCapture } from "./types.js";

export const FILE_REVIEW_SNAPSHOT_PATH = "/v1/file-review/snapshot";
export const FILE_REVIEW_BUILD_PATH = "/v1/file-review/build";

export interface FileReviewRouterOptions {
  readonly activeWorkspaceRoot?: () => string | undefined;
}

class FileReviewRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "FileReviewRequestError";
  }
}

function parseRelativePath(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new FileReviewRequestError("Request body must be a JSON object.");
  }
  const path = (body as Record<string, unknown>)["relativePath"];
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new FileReviewRequestError("relativePath is required.");
  }
  const trimmed = path.trim();
  if (trimmed.includes("..") || trimmed.startsWith("/") || /^[a-zA-Z]:/u.test(trimmed)) {
    throw new FileReviewRequestError("relativePath must be workspace-relative.");
  }
  return trimmed;
}

function parseSnapshot(raw: unknown): FileSnapshotCapture | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") throw new FileReviewRequestError("snapshot must be an object.");
  return raw as FileSnapshotCapture;
}

export function createFileReviewRouter(options: FileReviewRouterOptions): BoundaryRouter {
  return {
    name: "file-review",
    routes: [
      {
        method: "POST",
        path: FILE_REVIEW_SNAPSHOT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const relativePath = parseRelativePath(ctx.body);
          const root = options.activeWorkspaceRoot?.();
          if (root === undefined) {
            return { status: 404, data: { error: "no_active_workspace" } };
          }
          const snapshot = await captureWorkspaceFileSnapshot(root, relativePath);
          return { status: 200, data: { snapshot } };
        },
      },
      {
        method: "POST",
        path: FILE_REVIEW_BUILD_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          if (typeof ctx.body !== "object" || ctx.body === null) {
            throw new FileReviewRequestError("Request body must be a JSON object.");
          }
          const rec = ctx.body as Record<string, unknown>;
          const id = rec["id"];
          const at = rec["at"];
          const seq = rec["seq"];
          const source = rec["source"];
          if (typeof id !== "string" || typeof at !== "string" || typeof seq !== "number") {
            throw new FileReviewRequestError("id, at, and seq are required.");
          }
          if (source !== "user_attachment" && source !== "runtime_tool" && source !== "system") {
            throw new FileReviewRequestError("source is invalid.");
          }
          const relativePath = parseRelativePath(ctx.body);
          const before = parseSnapshot(rec["before"]);
          const after = parseSnapshot(rec["after"]);
          const root = options.activeWorkspaceRoot?.();
          let currentFileHash: string | undefined;
          if (root !== undefined && after?.hash !== undefined) {
            try {
              const current = await captureWorkspaceFileSnapshot(root, relativePath);
              currentFileHash = current.hash;
            } catch {
              // best effort — mismatch detection is optional
            }
          }
          const review = buildFileReviewArtifact({
            id,
            relativePath,
            at,
            seq,
            source,
            ...(typeof rec["operation"] === "string"
              ? { operation: rec["operation"] as "create" | "edit" | "delete" | "move" }
              : {}),
            ...(typeof rec["callId"] === "string" ? { callId: rec["callId"] } : {}),
            ...(typeof rec["runtimeTurnId"] === "string" ? { runtimeTurnId: rec["runtimeTurnId"] } : {}),
            ...(typeof rec["permissionDecision"] === "string"
              ? {
                  permissionDecision: rec["permissionDecision"] as
                    | "allowed_once"
                    | "allowed_always"
                    | "denied"
                    | "timeout",
                }
              : {}),
            ...(before !== undefined ? { before } : {}),
            ...(after !== undefined ? { after } : {}),
            ...(currentFileHash !== undefined ? { currentFileHash } : {}),
          });
          return { status: 200, data: { review } };
        },
      },
    ],
  };
}
