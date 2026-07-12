/**
 * LIVE OpenCode `permission.asked` → Cowork {@link ToolPermissionProxy} bridge (CGHC-028 Slice 5A).
 *
 * OpenCode blocks a tool until `POST /permission/{id}/reply` receives `{ response }`. Cowork's
 * permission gate + UI own the Allow/Deny decision and forward that reply. This bridge is the
 * missing ingress: it listens to real `/event` frames and submits them to the ONE gate via the
 * workspace-scoped proxy. It never fabricates a request — only forwards what OpenCode emitted.
 */

import { asRecord, isRawOpencodeEvent, readArray, readString } from "../execution/opencode-events.js";
import type { OpencodeToolPermissionEvent, ToolPermissionProxy } from "../files/tool-permission-proxy.js";

export interface PermissionBridgeOptions {
  readonly proxy: ToolPermissionProxy;
  /** Absolute workspace root used to normalize OpenCode absolute paths to workspace-relative. */
  readonly workspaceRoot: string;
  /** Optional redacted diagnostic sink; never receives secrets or full paths. */
  readonly onDiagnostic?: (message: string) => void;
}

export interface PermissionBridge {
  /** Ingest one decoded `/event` frame; no-op unless it is `permission.asked`. */
  handleFrame(frame: unknown): Promise<void>;
  /** Clear dedupe state (tests / service teardown). */
  reset(): void;
}

/** Map OpenCode permission keys onto tool names understood by {@link mapToolToActionKind}. */
function mapPermissionToTool(permission: string): string {
  switch (permission.trim().toLowerCase()) {
    case "edit":
    case "write":
      return "edit";
    case "bash":
    case "task":
      return "bash";
    case "delete":
    case "remove":
      return "delete";
    case "read":
    case "glob":
    case "grep":
    case "list":
      return "read";
    default:
      return permission;
  }
}

/** Convert an absolute in-workspace path to a workspace-relative path for the guard. */
function toWorkspaceRelative(workspaceRoot: string, target: string): string | undefined {
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const normTarget = target.replace(/\\/g, "/");
  const normRoot = root.replace(/\\/g, "/");
  const lowerTarget = normTarget.toLowerCase();
  const lowerRoot = normRoot.toLowerCase();
  if (lowerTarget === lowerRoot) return ".";
  const prefix = `${lowerRoot}/`;
  if (lowerTarget.startsWith(prefix)) {
    return normTarget.slice(normRoot.length + 1);
  }
  if (!/^[a-zA-Z]:/.test(target) && !target.startsWith("/") && !target.startsWith("\\")) {
    return target;
  }
  return undefined;
}

/** Prefer a concrete filepath from metadata; fall back to the first non-glob pattern. */
function resolveTargetPath(props: Record<string, unknown>): string | undefined {
  const metadata = asRecord(props.metadata);
  const direct =
    readString(metadata, "filepath") ??
    readString(metadata, "filePath") ??
    readString(metadata, "path");
  if (direct !== undefined && direct.length > 0) return direct;

  for (const entry of readArray(props, "patterns")) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (!entry.includes("*") && !entry.includes("?")) return entry;
  }
  return undefined;
}

export function createPermissionBridge(options: PermissionBridgeOptions): PermissionBridge {
  const seen = new Set<string>();

  return {
    async handleFrame(frame: unknown): Promise<void> {
      if (!isRawOpencodeEvent(frame) || frame.type !== "permission.asked") return;

      const props = asRecord(frame.properties);
      const requestId = readString(props, "id");
      const sessionId = readString(props, "sessionID");
      const permission = readString(props, "permission");
      if (requestId === undefined || sessionId === undefined || permission === undefined) return;
      if (seen.has(requestId)) return;

      const rawPath = resolveTargetPath(props);
      const relativePath =
        rawPath !== undefined ? toWorkspaceRelative(options.workspaceRoot, rawPath) : undefined;
      const event: OpencodeToolPermissionEvent = {
        requestId,
        sessionId,
        tool: mapPermissionToTool(permission),
        ...(relativePath !== undefined ? { path: relativePath } : {}),
      };

      seen.add(requestId);
      try {
        const outcome = await options.proxy.handle(event);
        if (outcome.outcome === "refused") {
          options.onDiagnostic?.(`permission proxy refused ${outcome.reason} for ${requestId}`);
        }
      } catch (err) {
        seen.delete(requestId);
        const message = err instanceof Error ? err.message : "permission bridge failed";
        options.onDiagnostic?.(message);
      }
    },
    reset(): void {
      seen.clear();
    },
  };
}
