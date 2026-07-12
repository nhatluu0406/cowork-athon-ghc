/**
 * Explicit dispatch planning for attachments + prior context + user request.
 *
 * Fail-fast when any selected attachment cannot fit the final 12k-char dispatch budget.
 */
import { assembleAttachmentContext, } from "./attachment-context.js";
import { assembleTranscriptContext } from "./transcript-context.js";
import { USER_REQUEST_END, USER_REQUEST_START } from "./transcript-context.js";
import { DISPATCH_MAX_CHARS } from "./attachment-limits.js";
function withInclusion(snapshot, status, reason) {
    return {
        ...snapshot.metadata,
        inclusionStatus: status,
        ...(reason !== undefined ? { inclusionReason: reason } : {}),
    };
}
function buildUserBlock(userPrompt) {
    const trimmed = userPrompt.trim();
    return `${USER_REQUEST_START}\n${trimmed}\n${USER_REQUEST_END}`;
}
/**
 * Plan the full outbound dispatch. Any selected attachment that cannot be included
 * causes fail-fast (no silent omission).
 */
export function planDispatchPrompt(priorMessages, attachments, userPrompt, maxChars = DISPATCH_MAX_CHARS) {
    const userBlock = buildUserBlock(userPrompt);
    const entries = attachments.map((s) => ({
        relativePath: s.metadata.relativePath,
        filename: s.metadata.filename,
        status: "selected",
    }));
    if (attachments.length === 0) {
        const prior = assembleTranscriptContext(priorMessages, maxChars - userBlock.length - 4);
        const parts = [];
        if (prior.text.length > 0)
            parts.push(prior.text);
        parts.push(userBlock);
        const text = parts.join("\n\n");
        if (text.length > maxChars) {
            return {
                ok: false,
                message: `Yêu cầu và ngữ cảnh trước vượt giới hạn ${maxChars} ký tự. ` +
                    "Hãy rút ngắn tin nhắn hoặc bắt đầu cuộc trò chuyện mới.",
                entries,
            };
        }
        return {
            ok: true,
            text,
            entries,
            includedMetadata: [],
            priorTruncated: prior.truncated,
        };
    }
    let remaining = maxChars - userBlock.length - 4;
    if (remaining < 200) {
        const omitted = entries.map((e) => ({
            ...e,
            status: "omitted_by_budget",
            reason: `Không đủ ngân sách dispatch (${maxChars} ký tự) sau yêu cầu hiện tại.`,
        }));
        return {
            ok: false,
            message: formatBudgetFailure(omitted, maxChars),
            entries: omitted,
        };
    }
    const priorBudget = Math.floor(remaining * 0.55);
    const prior = assembleTranscriptContext(priorMessages, priorBudget);
    remaining -= prior.text.length > 0 ? prior.text.length + 2 : 0;
    const attachmentAssembly = assembleAttachmentContext(attachments, remaining);
    const includedCount = attachmentAssembly.fileCount;
    const allIncluded = includedCount === attachments.length && !attachmentAssembly.truncated;
    if (!allIncluded) {
        const omittedPaths = new Set(attachments.slice(includedCount).map((s) => s.metadata.relativePath));
        const nextEntries = entries.map((e) => {
            if (omittedPaths.has(e.relativePath)) {
                return {
                    ...e,
                    status: "omitted_by_budget",
                    reason: `Không đủ ngân sách dispatch cuối (${maxChars} ký tự) ` +
                        "sau ngữ cảnh hội thoại trước và yêu cầu hiện tại.",
                };
            }
            return { ...e, status: "included" };
        });
        return {
            ok: false,
            message: formatBudgetFailure(nextEntries, maxChars),
            entries: nextEntries,
        };
    }
    const parts = [];
    if (prior.text.length > 0)
        parts.push(prior.text);
    if (attachmentAssembly.text.length > 0)
        parts.push(attachmentAssembly.text);
    parts.push(userBlock);
    const text = parts.join("\n\n");
    if (text.length > maxChars) {
        const nextEntries = entries.map((e) => ({
            ...e,
            status: "omitted_by_budget",
            reason: `Tổng dispatch vượt ${maxChars} ký tự.`,
        }));
        return {
            ok: false,
            message: formatBudgetFailure(nextEntries, maxChars),
            entries: nextEntries,
        };
    }
    const includedMetadata = attachments.map((s) => withInclusion(s, "included"));
    const finalEntries = entries.map((e) => ({ ...e, status: "included" }));
    return {
        ok: true,
        text,
        entries: finalEntries,
        includedMetadata,
        priorTruncated: prior.truncated,
    };
}
function formatBudgetFailure(entries, maxChars) {
    const omitted = entries.filter((e) => e.status === "omitted_by_budget");
    const names = omitted.map((e) => e.filename).join(", ");
    return (`Không thể gửi: tệp đính kèm không vừa ngân sách dispatch (${maxChars} ký tự). ` +
        (names.length > 0 ? `Không fit: ${names}. ` : "") +
        "Hãy gỡ bớt tệp, rút ngắn yêu cầu, hoặc bắt đầu cuộc trò chuyện mới.");
}
//# sourceMappingURL=dispatch-plan.js.map