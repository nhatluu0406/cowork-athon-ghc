/**
 * File-action truthfulness helpers.
 *
 * A model response is not evidence that a workspace mutation happened. These helpers keep
 * the user-facing result honest by detecting an explicit file-action request and requiring
 * a verified File Work Review artifact for the same runtime turn before Cowork presents the
 * action as verified.
 */
const FILE_REFERENCE = /(?:\b(?:file|tệp|tep|document|tài liệu)\b|[\w ._-]+\.[a-z0-9]{1,10}\b)/iu;
const CREATE_VERB = /\b(?:tạo|tao|create|generate|write)\b/iu;
const EDIT_VERB = /\b(?:sửa|sua|chỉnh\s*sửa|edit|modify|update|append|thêm\s+(?:dòng|nội\s*dung))\b/iu;
const DELETE_VERB = /\b(?:xóa|xoá|delete|remove)\b/iu;
const MOVE_VERB = /\b(?:di\s*chuyển|đổi\s*tên|move|rename)\b/iu;
/** Detect only explicit file-mutation requests; normal chat is intentionally ignored. */
export function detectFileActionIntent(text) {
    const value = text.trim();
    if (value.length === 0 || !FILE_REFERENCE.test(value))
        return null;
    if (DELETE_VERB.test(value))
        return "delete";
    if (MOVE_VERB.test(value))
        return "move";
    if (EDIT_VERB.test(value))
        return "edit";
    if (CREATE_VERB.test(value))
        return "create";
    return null;
}
function reviewMatchesIntent(review, intent) {
    if (review.operation !== intent)
        return false;
    switch (intent) {
        case "create":
            return review.afterExists;
        case "edit":
            return (review.beforeExists &&
                review.afterExists &&
                ((review.beforeHash !== undefined &&
                    review.afterHash !== undefined &&
                    review.beforeHash !== review.afterHash) ||
                    (review.unifiedDiff !== undefined && review.unifiedDiff.trim().length > 0)));
        case "delete":
            return review.beforeExists && !review.afterExists;
        case "move":
            return review.afterExists;
    }
}
/** True only when this runtime turn has a disk-backed review matching the requested action. */
export function hasVerifiedFileAction(reviews, runtimeTurnId, intent) {
    return reviews.some((review) => review.runtimeTurnId === runtimeTurnId &&
        review.source === "runtime_tool" &&
        reviewMatchesIntent(review, intent));
}
export const UNVERIFIED_FILE_ACTION_WARNING = "Cowork GHC chưa xác minh được thay đổi tệp. Không có bằng chứng thực thi và trạng thái tệp phù hợp, nên yêu cầu này được xem là chưa hoàn tất.";
/** Preserve the model text as context, but never present it as verified product truth. */
export function markFileActionUnverified(text) {
    const response = text.trim();
    if (response.length === 0)
        return UNVERIFIED_FILE_ACTION_WARNING;
    return `${UNVERIFIED_FILE_ACTION_WARNING}\n\nPhản hồi của Agent (chưa xác minh):\n${response}`;
}
//# sourceMappingURL=file-action-integrity.js.map