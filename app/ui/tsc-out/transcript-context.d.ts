/**
 * Deterministic transcript context assembly for linked runtime turns.
 *
 * When Cowork GHC creates a new OpenCode session for the same conversation, prior user/assistant
 * messages are prepended in a bounded block — no extra model call, no credentials.
 */
import type { ConversationMessage } from "./service-client.js";
export declare const MAX_CONTEXT_CHARS = 12000;
export interface AssembledContext {
    readonly text: string;
    readonly truncated: boolean;
    readonly messageCount: number;
}
/**
 * Build a bounded context block from prior messages (most recent retained when truncating).
 */
export declare function assembleTranscriptContext(messages: readonly ConversationMessage[], maxChars?: number): AssembledContext;
/** Augment the outbound OpenCode prompt with prior transcript context. */
export declare function augmentPromptWithContext(priorMessages: readonly ConversationMessage[], userPrompt: string, maxChars?: number): string;
//# sourceMappingURL=transcript-context.d.ts.map