/**
 * Deterministic transcript context assembly for linked runtime turns.
 *
 * When Cowork GHC creates a new OpenCode session for the same conversation, prior user/assistant
 * messages are prepended in a bounded block — no extra model call, no credentials.
 */

import type { ConversationMessage } from "./service-client.js";

export const MAX_CONTEXT_CHARS = 12_000;
const CONTEXT_HEADER =
  "[Ngữ cảnh cuộc trò chuyện trước — dùng để trả lời nhất quán; không lặp lại nguyên văn trừ khi được hỏi.]";
const CONTEXT_FOOTER = "[Hết ngữ cảnh — trả lời yêu cầu mới bên dưới.]";

export interface AssembledContext {
  readonly text: string;
  readonly truncated: boolean;
  readonly messageCount: number;
}

function formatLine(message: ConversationMessage): string {
  const role = message.role === "user" ? "Người dùng" : "Trợ lý";
  return `${role}: ${message.text.trim()}`;
}

/**
 * Build a bounded context block from prior messages (most recent retained when truncating).
 */
export function assembleTranscriptContext(
  messages: readonly ConversationMessage[],
  maxChars: number = MAX_CONTEXT_CHARS,
): AssembledContext {
  if (messages.length === 0) {
    return { text: "", truncated: false, messageCount: 0 };
  }

  const lines: string[] = [];
  let truncated = false;
  let used = `${CONTEXT_HEADER}\n\n`.length + `\n\n${CONTEXT_FOOTER}`.length;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const line = formatLine(messages[i]!);
    const nextLen = used + line.length + 1;
    if (nextLen > maxChars) {
      truncated = true;
      break;
    }
    lines.unshift(line);
    used = nextLen;
  }

  if (lines.length === 0) {
    return { text: "", truncated: true, messageCount: 0 };
  }

  const body = lines.join("\n");
  return {
    text: `${CONTEXT_HEADER}\n\n${body}\n\n${CONTEXT_FOOTER}`,
    truncated,
    messageCount: lines.length,
  };
}

/** Augment the outbound OpenCode prompt with prior transcript context. */
export function augmentPromptWithContext(
  priorMessages: readonly ConversationMessage[],
  userPrompt: string,
  maxChars: number = MAX_CONTEXT_CHARS,
): string {
  const trimmed = userPrompt.trim();
  const assembled = assembleTranscriptContext(priorMessages, maxChars);
  if (assembled.text.length === 0) return trimmed;
  return `${assembled.text}\n\n---\n\n${trimmed}`;
}
