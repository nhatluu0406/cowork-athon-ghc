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
import { resolveWorkspaceRelativePath } from "../workspace/resolve-relative.js";

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

/**
 * Extract the agent web-access target (webfetch URL / websearch query, #29) from an OpenCode
 * permission.asked frame. OpenCode carries tool arguments under `metadata`; the URL/query keys
 * differ across tool versions, so probe the common shapes. Returns undefined when none is present
 * (the proxy then treats it as no-target and the SSRF guard refuses an empty URL).
 */
function resolveWebTarget(props: Record<string, unknown>): string | undefined {
  const metadata = asRecord(props.metadata);
  const candidate =
    readString(metadata, "url") ??
    readString(metadata, "uri") ??
    readString(metadata, "query") ??
    readString(props, "url") ??
    readString(props, "query");
  if (candidate !== undefined && candidate.length > 0) return candidate;
  return undefined;
}

/** True when an OpenCode permission key/tool denotes agent web access (webfetch/websearch). */
function isWebAccess(permission: string, tool: string | undefined): boolean {
  const p = permission.trim().toLowerCase();
  const t = (tool ?? "").trim().toLowerCase();
  return (
    p === "webfetch" || p === "websearch" || t === "webfetch" || t === "websearch"
  );
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
      if (!isRawOpencodeEvent(frame)) return;

      if (frame.type === "permission.replied") {
        const props = asRecord(frame.properties);
        const requestId =
          readString(props, "id") ??
          readString(props, "requestID") ??
          readString(props, "requestId");
        if (requestId !== undefined) seen.delete(requestId);
        return;
      }

      if (frame.type === "session.idle" || frame.type === "session.completed") {
        // OpenCode may scope permission request identifiers to a session. Clearing the transient
        // de-dupe set at terminal session boundaries prevents a later turn from being suppressed.
        seen.clear();
        return;
      }

      if (frame.type !== "permission.asked") return;

      const props = asRecord(frame.properties);
      const requestId = readString(props, "id");
      const sessionId = readString(props, "sessionID");
      const permission = readString(props, "permission");
      const runtimeTool = readString(props, "tool");
      if (requestId === undefined || sessionId === undefined || permission === undefined) return;
      if (seen.has(requestId)) return;

      // Agent web access (#29): the target is a URL, not a workspace path — forward it verbatim so
      // the proxy can SSRF-guard it and show it on the card. Skip filepath resolution for these.
      if (isWebAccess(permission, runtimeTool)) {
        const webUrl = resolveWebTarget(props);
        const webEvent: OpencodeToolPermissionEvent = {
          requestId,
          sessionId,
          tool: runtimeTool ?? permission,
          ...(webUrl !== undefined ? { url: webUrl } : {}),
        };
        seen.add(requestId);
        try {
          const outcome = await options.proxy.handle(webEvent);
          if (outcome.outcome === "refused") {
            options.onDiagnostic?.(`permission proxy refused ${outcome.reason} for ${requestId}`);
          }
        } catch (err) {
          seen.delete(requestId);
          options.onDiagnostic?.(err instanceof Error ? err.message : "permission bridge failed");
        }
        return;
      }

      const rawPath = resolveTargetPath(props);
      const resolved =
        rawPath !== undefined
          ? await resolveWorkspaceRelativePath(options.workspaceRoot, rawPath)
          : undefined;
      const relativePath = resolved?.ok ? resolved.relativePath : undefined;
      const event: OpencodeToolPermissionEvent = {
        requestId,
        sessionId,
        tool: runtimeTool ?? mapPermissionToTool(permission),
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
