/**
 * `m365_knowledge_search` — the agent-invoked knowledge tool (REQ-205 T1.8, FR-006/FR-008/FR-009).
 *
 * DESIGN NOTE (T0.3 gap, documented per the task): `mapToolToActionKind`
 * (`files/tool-permission-proxy.ts`) maps OpenCode's OWN built-in tool names
 * (write/edit/delete/move/bash) as surfaced by its LIVE `permission.asked` event stream
 * (`runtime/permission-bridge.ts`). OpenCode has no plugin/custom-tool-registration mechanism
 * in this codebase (confirmed: `runtime/` package has no tool registry) — `m365_knowledge_search`
 * is a Cowork-native, /service-side tool (plan.md: "tool registration is a /service-side
 * concern"), so there is no live OpenCode event for it to proxy. Rather than inventing a new
 * bridge/registry (rebuilding an existing runtime without an ADR — forbidden), this module
 * wires DIRECTLY through the SAME {@link PermissionGate} using the exact
 * submit-then-`proceed()` shape `files/file-service.ts`'s `runGated` already uses for
 * Cowork-native (non-OpenCode-event) actions: a request is submitted to the gate, and the real
 * network call runs ONLY inside `gate.proceed()`, which invokes the callback ONLY when a
 * recorded Allow exists (P3) — so a Deny (or an unknown/pending request) makes the M365KG call
 * IMPOSSIBLE, not merely skipped in the UI.
 */

import type { PermissionActionKind, SessionId } from "@cowork-ghc/contracts";
import { createPermissionRequest, type PermissionGate } from "../permission/index.js";
import type { KnowledgeQueryOutcome, KnowledgeToolResult } from "./types.js";

/** FR-006 — the exact tool name registered for the agent runtime. */
export const M365_KNOWLEDGE_TOOL_NAME = "m365_knowledge_search" as const;

/**
 * The `PermissionActionKind` this tool declares (T0.3/T1.8) — a read-only external-data-access
 * action, never a filesystem/local-execution one (contracts/api.md "Permission semantics").
 */
export const M365_KNOWLEDGE_ACTION_KIND: PermissionActionKind = "network_access";

/** The minimal query capability the tool needs — satisfied by `KnowledgeSourceClient` or `KnowledgeService`. */
export interface KnowledgeQueryPort {
  query(queryText: string): Promise<KnowledgeQueryOutcome>;
}

export interface KnowledgeToolInput {
  /** Must be unique per invocation; becomes the `PermissionGate` requestId. */
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly query: string;
}

/** Map the client-level outcome to the tool/persisted outcome enum (data-model.md §1.2). */
function toToolResult(outcome: KnowledgeQueryOutcome): KnowledgeToolResult {
  if (outcome.outcome === "answered") {
    return { outcome: "answered", answer: outcome.answer, citations: outcome.citations, syncedAt: outcome.syncedAt };
  }
  // `auth_failed` has no dedicated tool-facing outcome (contracts/api.md) — it folds into
  // `unavailable`, same as any other backend-reachability failure from the agent's perspective.
  const mapped = outcome.outcome === "auth_failed" ? "unavailable" : outcome.outcome;
  return { outcome: mapped, answer: null, citations: [], syncedAt: null };
}

export interface KnowledgeToolOptions {
  readonly gate: PermissionGate;
  readonly port: KnowledgeQueryPort;
  readonly now: () => string;
}

export interface KnowledgeTool {
  /**
   * Step 1: submit the permission request to the gate (P1). Call this BEFORE `invoke` — the
   * request must exist (and be resolved Allow) before `invoke` can ever reach the network.
   */
  requestPermission(input: KnowledgeToolInput): void;
  /**
   * Step 2: run the tool strictly behind a recorded Allow (P3). `port.query` — and therefore
   * any network call to the M365KG backend — NEVER runs unless `gate.proceed` reports
   * `performed: true`. A denial (or no decision yet) short-circuits to `permission_denied`
   * WITHOUT touching `port` at all.
   */
  invoke(requestId: string, queryText: string): Promise<KnowledgeToolResult>;
}

/** Build the `m365_knowledge_search` tool bound to the ONE {@link PermissionGate}. */
export function createKnowledgeTool(options: KnowledgeToolOptions): KnowledgeTool {
  const { gate, port, now } = options;

  return {
    requestPermission(input: KnowledgeToolInput): void {
      const request = createPermissionRequest({
        requestId: input.requestId,
        sessionId: input.sessionId,
        action: {
          kind: M365_KNOWLEDGE_ACTION_KIND,
          description: `Truy vấn tri thức M365 (${M365_KNOWLEDGE_TOOL_NAME}).`,
        },
        requestedAt: now(),
      });
      gate.submit(request);
    },

    async invoke(requestId: string, queryText: string): Promise<KnowledgeToolResult> {
      const gated = gate.proceed(requestId, () => port.query(queryText));
      if (!gated.performed) {
        return { outcome: "permission_denied", answer: null, citations: [], syncedAt: null };
      }
      const outcome = await gated.result;
      return toToolResult(outcome);
    },
  };
}
