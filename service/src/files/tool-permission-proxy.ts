/**
 * `ToolPermissionProxy` — the OpenCode tool-permission boundary (CGHC-018, F1 + no-escape).
 *
 * For each proxied OpenCode tool-permission event this component:
 *  (a) maps the tool name to a boundary {@link PermissionActionKind} (fail-closed: an unmappable
 *      tool is refused, never silently escalated);
 *  (b) re-validates the tool's target path(s) through {@link WorkspaceGuard.assertRealPathInside}
 *      so a symlink/UNC/`..` tool argument cannot escape the granted workspace — an escape is
 *      refused BEFORE any disk change and recorded via the guard's workspace audit sink (P5);
 *  (c) submits a {@link PermissionRequest} to the {@link PermissionGate} (the single authority),
 *      whose recomputed approval level makes delete/move ELEVATED regardless of the event;
 *  (d) leaves the actual Allow/Deny reply to the gate's {@link RuntimeReplyPort} on resolution;
 *      only the pre-gate REFUSAL path replies deny directly here, so the runtime is never
 *      stranded on a rejected tool call.
 *
 * The proxy never touches the filesystem itself and never trusts a client-supplied approval
 * level — enforcement lives in the gate + guard it delegates to.
 */

import path from "node:path";
import type { PermissionActionKind } from "@cowork-ghc/contracts";
import type { WorkspaceGuard } from "../workspace/index.js";
import { WorkspaceBoundaryError } from "../workspace/index.js";
import {
  createPermissionRequest,
  type PermissionGate,
  type RuntimeReplyPort,
} from "../permission/index.js";

/** A tool-permission event surfaced by the OpenCode runtime (non-secret fields only). */
export interface OpencodeToolPermissionEvent {
  /** The runtime's permission id; used as the gate `requestId` and the reply key. */
  readonly requestId: string;
  readonly sessionId: string;
  /** The tool the agent wants to run (e.g. `write`, `edit`, `delete`, `move`, `bash`). */
  readonly tool: string;
  /** Primary target path for a file tool (source path for a move). */
  readonly path?: string;
  /** Destination path for a move/rename tool. */
  readonly destinationPath?: string;
}

/** Why the proxy refused an event before it ever reached the gate. */
export type ProxyRefusalReason = "path_escape" | "missing_path" | "unmappable_tool";

/** Result of proxying one event. `submitted` handed a live request to the gate. */
export type ProxyOutcome =
  | { readonly outcome: "submitted"; readonly requestId: string; readonly actionKind: PermissionActionKind }
  | { readonly outcome: "refused"; readonly requestId: string; readonly reason: ProxyRefusalReason };

export interface ToolPermissionProxyOptions {
  readonly guard: WorkspaceGuard;
  readonly gate: PermissionGate;
  /** Outbound runtime reply — used ONLY for the pre-gate refusal deny (the gate owns the rest). */
  readonly reply: RuntimeReplyPort;
  /** Injectable clock for the request timestamp (deterministic tests). */
  readonly now: () => string;
  /** Redacting reporter for a refusal-deny transport failure. Receives only a non-secret line. */
  readonly onReplyError?: (message: string, requestId: string) => void;
}

/**
 * Map an OpenCode tool name to a boundary action kind. Unknown tools return `undefined` so the
 * proxy fails CLOSED (refuse) rather than guessing a weaker/stronger level.
 */
export function mapToolToActionKind(tool: string): PermissionActionKind | undefined {
  switch (tool.trim().toLowerCase()) {
    case "write":
    case "create":
    case "new":
      return "file_create";
    case "edit":
    case "patch":
    case "update":
    case "apply":
      return "file_edit";
    case "delete":
    case "remove":
    case "rm":
    case "unlink":
      return "file_delete";
    case "move":
    case "rename":
    case "mv":
      return "file_move";
    case "bash":
    case "shell":
    case "exec":
    case "command":
    case "run":
      return "command_exec";
    default:
      return undefined;
  }
}

export class ToolPermissionProxy {
  private readonly guard: WorkspaceGuard;
  private readonly gate: PermissionGate;
  private readonly reply: RuntimeReplyPort;
  private readonly now: () => string;
  private readonly onReplyError: (message: string, requestId: string) => void;

  constructor(options: ToolPermissionProxyOptions) {
    this.guard = options.guard;
    this.gate = options.gate;
    this.reply = options.reply;
    this.now = options.now;
    this.onReplyError =
      options.onReplyError ??
      ((message, requestId) =>
        // The deny reply object carries no secret; a non-secret diagnostic line is safe.
        console.error(`[files] refusal-deny transport error for ${requestId}: ${message}`));
  }

  async handle(event: OpencodeToolPermissionEvent): Promise<ProxyOutcome> {
    const kind = mapToolToActionKind(event.tool);
    if (kind === undefined) return this.refuse(event.requestId, "unmappable_tool");

    if (kind === "command_exec") {
      return this.submit(event, kind, undefined);
    }

    // File tools: confine the primary target (and destination for a move) real path.
    if (event.path === undefined || event.path.length === 0) {
      return this.refuse(event.requestId, "missing_path");
    }
    let targetReal: string;
    try {
      const primaryReal = await this.guard.assertRealPathInside(event.path);
      targetReal = primaryReal;
      if (kind === "file_move") {
        if (event.destinationPath === undefined || event.destinationPath.length === 0) {
          return this.refuse(event.requestId, "missing_path");
        }
        // The destination is the path being WRITTEN — confine it and use it as the target.
        targetReal = await this.guard.assertRealPathInside(event.destinationPath);
      }
    } catch (err) {
      if (err instanceof WorkspaceBoundaryError) {
        // The guard already recorded a workspace_path_rejected audit event (P5).
        return this.refuse(event.requestId, "path_escape");
      }
      throw err;
    }

    return this.submit(event, kind, targetReal);
  }

  private submit(
    event: OpencodeToolPermissionEvent,
    kind: PermissionActionKind,
    targetReal: string | undefined,
  ): ProxyOutcome {
    const request = createPermissionRequest({
      requestId: event.requestId,
      sessionId: event.sessionId,
      action: {
        kind,
        ...(targetReal !== undefined ? { targetPath: targetReal } : {}),
        description: describe(event.tool, kind, targetReal),
      },
      requestedAt: this.now(),
    });
    this.gate.submit(request);
    return { outcome: "submitted", requestId: event.requestId, actionKind: kind };
  }

  /** Refuse an event pre-gate: forward an explicit deny so the runtime is not stranded. */
  private async refuse(requestId: string, reason: ProxyRefusalReason): Promise<ProxyOutcome> {
    try {
      await this.reply.reply({ requestId, decision: "deny" });
    } catch (err) {
      // The live adapter redacts its own transport errors; surface a non-secret line only.
      this.onReplyError(err instanceof Error ? err.message : "reply failed", requestId);
    }
    return { outcome: "refused", requestId, reason };
  }
}

/** Build a non-secret, human-readable description (a basename, never a full path or secret). */
function describe(tool: string, kind: PermissionActionKind, targetReal: string | undefined): string {
  if (targetReal === undefined) return `Tool ${tool} requested ${kind}.`;
  return `Tool ${tool} requested ${kind} on ${path.basename(targetReal)}.`;
}
