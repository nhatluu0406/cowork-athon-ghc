/**
 * Deterministic transcript context assembly for linked runtime turns.
 *
 * When Cowork GHC creates a new OpenCode session for the same conversation, prior user/assistant
 * messages are sent in a bounded, role-isolated internal envelope — never persisted or displayed.
 */
import type { ConversationMessage } from "./service-client.js";
export declare const MAX_CONTEXT_CHARS = 12000;
/** Markers for the internal transport envelope (never shown to users). */
export declare const CONTEXT_ENVELOPE_START = "<<<CGHC_UNTRUSTED_PRIOR_TURNS>>>";
export declare const CONTEXT_ENVELOPE_END = "<<<END_CGHC_UNTRUSTED_PRIOR_TURNS>>>";
export declare const USER_REQUEST_START = "<<<CGHC_CURRENT_USER_REQUEST>>>";
export declare const USER_REQUEST_END = "<<<END_CGHC_CURRENT_USER_REQUEST>>>";
export interface AssembledContext {
    readonly text: string;
    readonly truncated: boolean;
    readonly messageCount: number;
}
/** True when text looks like a leaked internal context transport block. */
export declare function containsTransportArtifact(text: string): boolean;
/** Remove known transport wrapper artifacts from assistant text (display/persist cleanup). */
export declare function stripTransportArtifacts(text: string): string;
/** Sanitize a stored message before it enters future context assembly. */
export declare function sanitizeMessageForContext(message: ConversationMessage): ConversationMessage;
/**
 * Build a bounded context block from prior messages (most recent retained when truncating).
 * Excludes transport artifacts and never includes augmented prompts.
 */
export declare function assembleTranscriptContext(messages: readonly ConversationMessage[], maxChars?: number): AssembledContext;
/** Augment the outbound OpenCode prompt with prior transcript context (transport only). */
export declare function augmentPromptWithContext(priorMessages: readonly ConversationMessage[], userPrompt: string, maxChars?: number): string;
//# sourceMappingURL=transcript-context.d.ts.map