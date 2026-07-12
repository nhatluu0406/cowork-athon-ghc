/**
 * Shared types for the M365 Knowledge Graph integration (REQ-205, data-model.md §1).
 *
 * Cowork never stores a copy of M365KG's underlying entity/graph/chunk data — every
 * {@link KnowledgeCitation} is a reference, re-resolved against the live backend (data-model.md
 * §2 "Key invariant"). These types are secret-free: `KnowledgeSourceConfig.credentialRef` is a
 * handle only (never the raw token).
 */

import type { CredentialRef } from "@cowork-ghc/contracts";

/** Mirrors M365KG's Neo4j node labels 1:1 (REQ-204 data-model.md §2.1); not redefined there. */
export type KnowledgeEntityType =
  | "Person"
  | "Project"
  | "Document"
  | "Technology"
  | "Customer"
  | "Department";

/** data-model.md §1.3 — nested within a {@link KnowledgeToolInvocation}/query response. */
export interface KnowledgeCitation {
  readonly entityType: KnowledgeEntityType;
  readonly entityId: string;
  readonly displayName: string;
  readonly sourceRef: string | null;
}

/** Bound on graph nodes returned to the Knowledge Panel (R4). */
export const KNOWLEDGE_PANEL_MAX_NODES = 50;

export interface KnowledgeGraphNode {
  readonly id: string;
  readonly label: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface KnowledgeGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}

/** data-model.md §1.4 — ephemeral, computed at render time; never persisted. */
export interface KnowledgeGraphResult {
  readonly nodes: readonly KnowledgeGraphNode[];
  readonly edges: readonly KnowledgeGraphEdge[];
  /** True when the raw node set exceeded {@link KNOWLEDGE_PANEL_MAX_NODES} and was truncated. */
  readonly truncated: boolean;
}

/**
 * The outcome of one `KnowledgeSourceClient.query()` call. `auth_failed` is a CLIENT-level
 * outcome (surfaced when R2's refresh-then-retry still fails) — it is narrower than the
 * tool-facing/API outcome enum (contracts/api.md), which folds `auth_failed` into
 * `unavailable` since the tool caller has no actionable difference between the two.
 */
export type KnowledgeQueryOutcome =
  | {
      readonly outcome: "answered";
      readonly answer: string;
      readonly citations: readonly KnowledgeCitation[];
      readonly syncedAt: string | null;
    }
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "timeout" }
  | { readonly outcome: "auth_failed" };

/** Health/status outcome for `checkHealth()` — mirrors `KnowledgeSourceConfig.status` minus `not_configured`. */
export type KnowledgeHealthStatus = "connected" | "unreachable" | "auth_failed";

/** data-model.md §1.1 `KnowledgeSourceConfig.status`. */
export type KnowledgeSourceStatus = "not_configured" | "connected" | "unreachable" | "auth_failed";

/** data-model.md §1.1 — persisted to `.runtime/knowledge-source.json` (write-temp-then-rename). */
export interface KnowledgeSourceConfig {
  readonly baseUrl: string | null;
  /** Opaque keyring handle — NEVER the raw token. `null` only when `status = not_configured`. */
  readonly credentialRef: CredentialRef | null;
  readonly status: KnowledgeSourceStatus;
  readonly lastHealthCheckAt: string | null;
  readonly configuredAt: string | null;
}

/** The default, pristine config (no source ever configured). */
export const DEFAULT_KNOWLEDGE_SOURCE_CONFIG: KnowledgeSourceConfig = {
  baseUrl: null,
  credentialRef: null,
  status: "not_configured",
  lastHealthCheckAt: null,
  configuredAt: null,
};

/** Non-secret projection returned by status/configure/test-connection/disconnect (contracts/api.md). */
export interface KnowledgeStatusView {
  readonly status: KnowledgeSourceStatus;
  readonly baseUrl: string | null;
  readonly lastHealthCheckAt: string | null;
}

/** contracts/api.md tool contract — the outcome enum persisted as `KnowledgeToolInvocation.outcome`. */
export type KnowledgeToolOutcome = "answered" | "unavailable" | "timeout" | "permission_denied";

/** The shape returned to the agent runtime AND persisted as `KnowledgeToolInvocation` (data-model.md §1.2). */
export interface KnowledgeToolResult {
  readonly outcome: KnowledgeToolOutcome;
  readonly answer: string | null;
  readonly citations: readonly KnowledgeCitation[];
  readonly syncedAt: string | null;
}
