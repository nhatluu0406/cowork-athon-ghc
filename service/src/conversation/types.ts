/**
 * Persistent conversation records (Cowork GHC session management slice).
 *
 * Stored under the application user-data area — never in the workspace or repo.
 * Secret-free: no credentials, tokens, or raw provider payloads.
 */

import type { ModelRef } from "@cowork-ghc/contracts";
import type { SkillUseMetadata } from "../skills/types.js";

export type ConversationStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "cancelled"
  | "errored"
  | "interrupted";

/** Inclusion outcome for a workspace attachment on a specific turn. */
export type AttachmentInclusionStatus =
  | "selected"
  | "included"
  | "rejected"
  | "omitted_by_budget";

/** Metadata persisted for workspace text-file attachments (no raw content). */
export interface AttachmentMetadata {
  readonly relativePath: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly contentHash: string;
  readonly truncated: boolean;
  readonly maxBytesApplied: number;
  readonly inclusionStatus?: AttachmentInclusionStatus;
  readonly inclusionReason?: string;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: string;
  /** Workspace attachment metadata only — file content is never stored in transcript. */
  readonly attachments?: readonly AttachmentMetadata[];
  /** Immutable Skill provenance used for this turn; raw Skill content is never persisted. */
  readonly skills?: readonly SkillUseMetadata[];
}

/** One OpenCode runtime session linked to a Cowork conversation (a single turn). */
export interface RuntimeTurnRecord {
  readonly runtimeSessionId: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: "running" | "completed" | "cancelled" | "errored";
}

/** Redacted activity metadata persisted for session reopen (no secrets / raw EV). */
export interface PersistedActivitySnapshot {
  readonly items: readonly {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
    readonly status: string;
    readonly at: string;
    readonly seq: number;
    readonly toolName?: string;
    readonly callId?: string;
    readonly summary?: string;
    readonly relativePath?: string;
    readonly operation?: string;
    readonly detail?: string;
  }[];
  readonly fileChanges: readonly {
    readonly id: string;
    readonly operation: string;
    readonly relativePath: string;
    readonly at: string;
    readonly seq: number;
    readonly callId?: string;
  }[];
  readonly permissionHistory: readonly {
    readonly id: string;
    readonly requestId: string;
    readonly at: string;
    readonly actionLabel: string;
    readonly targetSummary: string;
    readonly decision: string;
    readonly outcomeLabel: string;
  }[];
  readonly readPaths: readonly string[];
  readonly terminalState: string | null;
}

/** Summary row for list/search (no messages). */
export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly workspacePath: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly runtimeSessionId: string | null;
  readonly parentId?: string;
  readonly status: ConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface ConversationRecord extends ConversationSummary {
  readonly messages: readonly ConversationMessage[];
  readonly model?: ModelRef;
  readonly activity?: PersistedActivitySnapshot;
  /** Historical OpenCode runtime turns for this conversation (newest last). */
  readonly runtimeTurns?: readonly RuntimeTurnRecord[];
}

export interface CreateConversationInput {
  readonly title?: string;
  readonly workspacePath: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly parentId?: string;
}

/** Atomic patch for conversation records (router applies all fields in one write). */
export interface ConversationPatch {
  readonly title?: string;
  readonly status?: ConversationStatus;
  readonly runtimeSessionId?: string | null;
  readonly activity?: PersistedActivitySnapshot;
  readonly registerRuntimeTurn?: RuntimeTurnRecord;
  readonly completeRuntimeTurn?: {
    readonly runtimeSessionId: string;
    readonly status: RuntimeTurnRecord["status"];
    readonly completedAt: string;
  };
}

export interface AppendMessageInput {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly attachments?: readonly AttachmentMetadata[];
  readonly skills?: readonly SkillUseMetadata[];
}
