/**
 * Workspace text-file attachment transport envelope (Phase 1).
 *
 * Attachment content is untrusted data — never system instructions. Combined with prior-turn
 * context in {@link augmentDispatchPrompt} for a single OpenCode text part.
 */
import type { AttachmentMetadata, ConversationMessage } from "./service-client.js";
import { containsTransportArtifact } from "./transcript-context.js";
import { planDispatchPrompt, type DispatchPlan } from "./dispatch-plan.js";
export declare const ATTACHMENT_ENVELOPE_START = "<<<CGHC_UNTRUSTED_ATTACHMENT_CONTEXT>>>";
export declare const ATTACHMENT_ENVELOPE_END = "<<<END_CGHC_UNTRUSTED_ATTACHMENT_CONTEXT>>>";
export interface AttachmentSnapshot {
    readonly metadata: AttachmentMetadata;
    readonly content: string;
}
export interface AssembledAttachments {
    readonly text: string;
    readonly truncated: boolean;
    readonly fileCount: number;
}
/** True when text looks like a leaked attachment transport block. */
export declare function containsAttachmentArtifact(text: string): boolean;
/**
 * Build a bounded attachment context block from snapshots (files processed in order).
 */
export declare function assembleAttachmentContext(snapshots: readonly AttachmentSnapshot[], maxChars: number): AssembledAttachments;
export interface DispatchAssembly {
    readonly text: string;
    readonly priorTruncated: boolean;
    readonly attachmentTruncated: boolean;
}
/**
 * Assemble the full outbound dispatch: prior turns + attachments + current user request.
 * @deprecated Prefer {@link planDispatchPrompt} for explicit inclusion/fail-fast semantics.
 */
export declare function augmentDispatchPrompt(priorMessages: readonly ConversationMessage[], attachments: readonly AttachmentSnapshot[], userPrompt: string, maxChars?: number): DispatchAssembly;
/** Explicit dispatch plan with per-file inclusion status (fail-fast on omission). */
export { planDispatchPrompt, type DispatchPlan };
/** Re-export for transport artifact detection in assistant output sanitization. */
export { containsTransportArtifact };
//# sourceMappingURL=attachment-context.d.ts.map