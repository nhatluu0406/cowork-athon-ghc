/**
 * Explicit dispatch planning for attachments + prior context + user request.
 *
 * Fail-fast when any selected attachment cannot fit the final 12k-char dispatch budget.
 */
import type { AttachmentMetadata, ConversationMessage } from "./service-client.js";
import { type AttachmentSnapshot } from "./attachment-context.js";
export type AttachmentInclusionStatus = "selected" | "included" | "rejected" | "omitted_by_budget";
export interface AttachmentDispatchEntry {
    readonly relativePath: string;
    readonly filename: string;
    readonly status: AttachmentInclusionStatus;
    readonly reason?: string;
}
export interface DispatchPlanSuccess {
    readonly ok: true;
    readonly text: string;
    readonly entries: readonly AttachmentDispatchEntry[];
    readonly includedMetadata: readonly AttachmentMetadata[];
    readonly priorTruncated: boolean;
}
export interface DispatchPlanFailure {
    readonly ok: false;
    readonly message: string;
    readonly entries: readonly AttachmentDispatchEntry[];
}
export type DispatchPlan = DispatchPlanSuccess | DispatchPlanFailure;
/**
 * Plan the full outbound dispatch. Any selected attachment that cannot be included
 * causes fail-fast (no silent omission).
 */
export declare function planDispatchPrompt(priorMessages: readonly ConversationMessage[], attachments: readonly AttachmentSnapshot[], userPrompt: string, maxChars?: number): DispatchPlan;
//# sourceMappingURL=dispatch-plan.d.ts.map