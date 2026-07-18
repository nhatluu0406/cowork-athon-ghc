/**
 * UI-only contracts for external integration slots.
 *
 * These are intentionally passive shapes. They do not call a backend, fabricate production data,
 * or imply that D1-D4 are implemented.
 */

export type IntegrationState =
  | "idle"
  | "running"
  | "permission_wait"
  | "cancelling"
  | "completed"
  | "failed";

export interface ProvenanceRef {
  readonly label: string;
  readonly source: string;
  readonly at?: string;
}

export interface DispatchTaskSummary {
  readonly id: string;
  readonly title: string;
  readonly state: IntegrationState;
  readonly childTaskCount: number;
  readonly permissionWaitCount: number;
  readonly canCancel: boolean;
  readonly provenance: readonly ProvenanceRef[];
}

export interface DispatchChildTask {
  readonly id: string;
  readonly parentId: string;
  readonly title: string;
  readonly state: IntegrationState;
  readonly resultProvenance: readonly ProvenanceRef[];
}

export type MicrosoftConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "needs_reconnect"
  | "error";

export interface MicrosoftIntegrationView {
  readonly connectionState: MicrosoftConnectionState;
  readonly services: readonly { readonly id: string; readonly label: string; readonly connected: boolean }[];
  readonly scopes: readonly string[];
  readonly actionHistory: readonly ProvenanceRef[];
  readonly error?: string;
}

export type KnowledgeIndexState = "not_indexed" | "indexing" | "ready" | "stale" | "error";

export interface KnowledgeSourceView {
  readonly id: string;
  readonly label: string;
  readonly state: KnowledgeIndexState;
  readonly lastIndexedAt?: string;
}

export interface KnowledgeQueryResult {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly provenance: readonly ProvenanceRef[];
}

export interface KnowledgeIntegrationView {
  readonly indexState: KnowledgeIndexState;
  readonly sources: readonly KnowledgeSourceView[];
  readonly queryResults: readonly KnowledgeQueryResult[];
  readonly staleReason?: string;
}

export type GatewayHealth = "off" | "unknown" | "healthy" | "degraded" | "down";

export interface GatewayRouteView {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly health: GatewayHealth;
  readonly latencyMs?: number;
  readonly usageTokens?: number;
  readonly costUsd?: number;
  readonly fallbackActive: boolean;
  readonly error?: string;
}

export interface GatewayIntegrationView {
  readonly health: GatewayHealth;
  readonly routes: readonly GatewayRouteView[];
}
