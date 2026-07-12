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
