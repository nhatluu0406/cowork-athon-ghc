/**
 * Persistent conversation records (Cowork GHC session management slice).
 *
 * Stored under the application user-data area — never in the workspace or repo.
 * Secret-free: no credentials, tokens, or raw provider payloads.
 */

import type { ModelRef } from "@cowork-ghc/contracts";

export type ConversationStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "cancelled"
  | "errored"
  | "interrupted";

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: string;
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
}

export interface CreateConversationInput {
  readonly title?: string;
  readonly workspacePath: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly parentId?: string;
}

export interface AppendMessageInput {
  readonly role: "user" | "assistant";
  readonly text: string;
}
