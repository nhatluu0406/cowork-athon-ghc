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
 *
 * D1 fix (ADR 0011 Open item): when the event's session is bound to a dispatch branch's
 * {@link PermissionPreset} (via the injected {@link ToolPermissionProxyOptions.branchPreset}
 * lookup) and the preset's level for the mapped tool is `deny`, the request is auto-denied HERE,
 * before it ever reaches {@link PermissionGate.submit} as an ask — via
 * {@link PermissionGate.denyByPolicy}, the gate's SEPARATE boundary-policy deny path (not the
 * user-facing `resolve()`), so the audit trail honestly records `reason: "agent_preset"` rather
 * than misattributing the auto-deny to a human, no second permission path exists, and no
 * `pending` state is ever created for the request to appear as an Allow/Deny prompt. Only `deny`
 * is ever read from the preset — any other value (including a looser `allow` that should never
 * have passed `isNarrowingPreset`) is inert here, so this can only ever narrow, never widen, what
 * the gate/base-policy would otherwise decide. The preset key looked up for a given action kind
 * is {@link presetKeyForActionKind} — imported from `@cowork-ghc/contracts` rather than kept as a
 * local copy, so `validateAgentDefinition`'s notion of an "enforceable" key and this proxy's
 * notion can never drift apart (D1 fix, follow-up finding 2). Concretely this means an MS365
 * write is NOT governed by a branch's `permissionPreset` today: MS365 tool calls submit directly
 * to the {@link PermissionGate} from `ms365/ms365-tools.ts` and never reach this proxy at all.
 */

import path from "node:path";
import { presetKeyForActionKind, type PermissionActionKind, type PermissionPreset } from "@cowork-ghc/contracts";
import { evaluateWebAccess } from "./web-access-guard.js";
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
  /** Target URL / query for an agent web-access tool (webfetch/websearch, #29). */
  readonly url?: string;
}

/** Why the proxy refused an event before it ever reached the gate. */
export type ProxyRefusalReason =
  | "path_escape"
  | "missing_path"
  | "unmappable_tool"
  | "web_target_blocked";

/** Result of proxying one event. `submitted` handed a live request to the gate. */
export type ProxyOutcome =
  | { readonly outcome: "submitted"; readonly requestId: string; readonly actionKind: PermissionActionKind }
  | { readonly outcome: "refused"; readonly requestId: string; readonly reason: ProxyRefusalReason }
  | { readonly outcome: "denied_by_preset"; readonly requestId: string; readonly actionKind: PermissionActionKind };

export interface ToolPermissionProxyOptions {
  readonly guard: WorkspaceGuard;
  readonly gate: PermissionGate;
  /** Outbound runtime reply — used ONLY for the pre-gate refusal deny (the gate owns the rest). */
  readonly reply: RuntimeReplyPort;
  /** Injectable clock for the request timestamp (deterministic tests). */
  readonly now: () => string;
  /** Redacting reporter for a refusal-deny transport failure. Receives only a non-secret line. */
  readonly onReplyError?: (message: string, requestId: string) => void;
  /**
   * D1 fix: look up the {@link PermissionPreset} bound to a dispatch branch session (absent for
   * an ordinary interactive session — the common case, and byte-for-byte unchanged behavior).
   * Backed by `permission/branch-permission-bindings.ts` in production; a test may inject any
   * function. Only a `deny` level is ever consulted (see the class doc for why this cannot widen).
   */
  readonly branchPreset?: (sessionId: string) => PermissionPreset | undefined;
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
    case "webfetch":
    case "web_fetch":
    case "websearch":
    case "web_search":
      // Agent web access (#29): elevated, URL surfaced in the card, SSRF-guarded pre-gate.
      return "web_access";
    default:
      return undefined;
  }
}

/** True when the web-access tool is a search (query string) rather than a fetch (URL). */
function isWebSearchTool(tool: string): boolean {
  const t = tool.trim().toLowerCase();
  return t === "websearch" || t === "web_search";
}

/** Bound a search query for the permission card (non-secret display, avoid an unbounded card). */
function truncateQuery(query: string): string {
  const oneLine = query.replace(/\s+/gu, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}

export class ToolPermissionProxy {
  private readonly guard: WorkspaceGuard;
  private readonly gate: PermissionGate;
  private readonly reply: RuntimeReplyPort;
  private readonly now: () => string;
  private readonly onReplyError: (message: string, requestId: string) => void;
  private readonly branchPreset: ((sessionId: string) => PermissionPreset | undefined) | undefined;

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
    this.branchPreset = options.branchPreset;
  }

  async handle(event: OpencodeToolPermissionEvent): Promise<ProxyOutcome> {
    const kind = mapToolToActionKind(event.tool);
    if (kind === undefined) return this.refuse(event.requestId, "unmappable_tool");

    // D1 fix: checked BEFORE any path resolution — if the branch's own agent preset forbids this
    // action kind entirely, there is nothing to ask about (fail fast, and never touch the fs).
    const preset = this.branchPreset?.(event.sessionId);
    if (preset !== undefined && preset[presetKeyForActionKind(kind)] === "deny") {
      return this.denyByPreset(event, kind);
    }

    if (kind === "command_exec") {
      return this.submit(event, kind, undefined);
    }

    // Agent web access (#29). websearch = a query string (no host to probe) → surface the raw text
    // on the card. webfetch = a URL → SSRF-guard it BEFORE the gate so an internal/loopback target
    // never even reaches an Allow prompt. On block, refuse (explicit deny reply → runtime unstuck).
    if (kind === "web_access") {
      const raw = (event.url ?? "").trim();
      if (isWebSearchTool(event.tool)) {
        if (raw.length === 0) return this.refuse(event.requestId, "web_target_blocked");
        return this.submitWeb(event, `truy vấn: ${truncateQuery(raw)}`);
      }
      const decision = evaluateWebAccess(raw);
      if (!decision.allowed) return this.refuse(event.requestId, "web_target_blocked");
      return this.submitWeb(event, decision.url.href);
    }

    // File tools: when OpenCode omits a concrete path (glob-only permission.asked), still surface
    // the request to the gate so the UI can approve/deny — OpenCode blocks until the reply.
    if (event.path === undefined || event.path.length === 0) {
      return this.submit(event, kind, undefined);
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

  /**
   * Submit an agent web-access request (#29). The card shows the target (an SSRF-validated https
   * URL for webfetch, or the raw search query for websearch) in the description rather than a
   * `targetPath`, which is filesystem-only.
   */
  private submitWeb(event: OpencodeToolPermissionEvent, safeTarget: string): ProxyOutcome {
    const request = createPermissionRequest({
      requestId: event.requestId,
      sessionId: event.sessionId,
      action: {
        kind: "web_access",
        description: `Tool ${event.tool} muốn truy cập web (${safeTarget})`,
      },
      requestedAt: this.now(),
    });
    this.gate.submit(request);
    return { outcome: "submitted", requestId: event.requestId, actionKind: "web_access" };
  }

  /**
   * D1 fix: auto-deny a request the branch's own preset forbids — through the SAME
   * `PermissionGate`, not a second path, via {@link PermissionGate.denyByPolicy}. That method is
   * NOT the user-facing `resolve()` path: it audits the honest `"agent_preset"` reason (never
   * `"user_decision"` — a security reviewer must be able to tell a policy auto-deny apart from a
   * real human decision), and it never creates a `pending` entry at all, so there is no window
   * in which this request could be observed as an Allow/Deny prompt. The gate's usual deny
   * handling (session driven terminal, explicit deny reply forwarded — P3) still applies.
   */
  private async denyByPreset(
    event: OpencodeToolPermissionEvent,
    kind: PermissionActionKind,
  ): Promise<ProxyOutcome> {
    const request = createPermissionRequest({
      requestId: event.requestId,
      sessionId: event.sessionId,
      action: { kind, description: describe(event.tool, kind, undefined) },
      requestedAt: this.now(),
    });
    await this.gate.denyByPolicy(request);
    return { outcome: "denied_by_preset", requestId: event.requestId, actionKind: kind };
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
