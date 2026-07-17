/**
 * Runtime-turn decision logic — reuse live OpenCode session or start a linked new turn.
 */

import type { ConversationRecord, ServiceClient } from "./service-client.js";

export type RuntimeTurnPlan =
  | { readonly action: "reuse"; readonly runtimeSessionId: string }
  | {
      readonly action: "new_turn";
      readonly priorMessages: readonly ConversationRecord["messages"][number][];
      readonly reason: "no_runtime" | "terminal" | "unavailable";
    };

const TERMINAL_STATUSES: readonly ConversationRecord["status"][] = [
  "completed",
  "cancelled",
  "errored",
  "interrupted",
];

export function conversationNeedsNewRuntimeTurn(record: ConversationRecord | null): boolean {
  if (record === null) return false;
  if (record.runtimeSessionId === null) return record.messages.length > 0;
  return TERMINAL_STATUSES.includes(record.status);
}

/**
 * Decide whether to reuse the current runtime session or create a new linked turn.
 */
export async function planRuntimeTurn(
  client: ServiceClient,
  record: ConversationRecord,
): Promise<RuntimeTurnPlan> {
  const priorMessages = record.messages;
  const runtimeId = record.runtimeSessionId;

  if (runtimeId === null) {
    return {
      action: "new_turn",
      priorMessages,
      reason: priorMessages.length > 0 ? "terminal" : "no_runtime",
    };
  }

  if (TERMINAL_STATUSES.includes(record.status)) {
    return { action: "new_turn", priorMessages, reason: "terminal" };
  }

  try {
    const refreshed = await client.getRuntimeSession(runtimeId);
    if (refreshed.canPrompt && refreshed.view.terminal === null) {
      return { action: "reuse", runtimeSessionId: runtimeId };
    }
    return { action: "new_turn", priorMessages, reason: "terminal" };
  } catch {
    return { action: "new_turn", priorMessages, reason: "unavailable" };
  }
}
