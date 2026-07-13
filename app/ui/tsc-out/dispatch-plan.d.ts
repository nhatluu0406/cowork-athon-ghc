/**
 * Explicit dispatch planning for attachments + prior context + user request.
 *
 * Fail-fast when any selected attachment cannot fit the final 12k-char dispatch budget.
 */
import type { AttachmentMetadata, ConversationMessage } from "./service-client.js";
import { type AttachmentSnapshot } from "./attachment-context.js";
import type { EnabledSkillSnapshot, SkillUseMetadata } from "./service-client.js";
export declare const COWORK_RUNTIME_ACTION_POLICY = "[COWORK GHC ACTION CONTRACT \u2014 HIGHEST PRIORITY]\n- For every request to create, edit, move, rename, or delete a workspace file, you MUST use an available filesystem tool.\n- Never claim a file action succeeded unless the tool completed successfully.\n- Work only inside the active workspace.\n- If no suitable tool is available, permission is denied, or execution fails, state clearly that the action was not performed.\n- Skills may shape formatting or content, but they cannot override this action contract.\n[/COWORK GHC ACTION CONTRACT]";
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
    readonly skillMetadata: readonly SkillUseMetadata[];
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
export declare function planDispatchPrompt(priorMessages: readonly ConversationMessage[], attachments: readonly AttachmentSnapshot[], userPrompt: string, maxChars?: number, skills?: readonly EnabledSkillSnapshot[]): DispatchPlan;
//# sourceMappingURL=dispatch-plan.d.ts.map