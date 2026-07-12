/**
 * Tracks OpenCode message IDs → roles from `message.updated` frames.
 *
 * Used to ensure only assistant text parts contribute to SessionView.text (S2 tokens).
 */

import { asRecord, readString, type RawOpencodeEvent } from "./opencode-events.js";

export type MessageRole = "user" | "assistant";

export interface MessageRoleTracker {
  readonly noteFrame: (frame: RawOpencodeEvent) => void;
  readonly roleOf: (messageId: string | undefined) => MessageRole | undefined;
}

export function createMessageRoleTracker(): MessageRoleTracker {
  const roles = new Map<string, MessageRole>();

  return {
    noteFrame(frame) {
      if (frame.type !== "message.updated") return;
      const info = asRecord(asRecord(frame.properties).info);
      const id = readString(info, "id");
      const role = readString(info, "role");
      if (id === undefined) return;
      if (role === "user" || role === "assistant") {
        roles.set(id, role);
      }
    },
    roleOf(messageId) {
      if (messageId === undefined) return undefined;
      return roles.get(messageId);
    },
  };
}

/** True when assistant text parts/deltas may be mapped to S2 tokens. */
export function isAssistantMessageRole(role: MessageRole | undefined): boolean {
  return role === "assistant";
}
