/**
 * Pending workspace attachment chips (pre-send state).
 */
export function createPendingAttachmentId() {
    return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function totalValidBytes(pending) {
    let sum = 0;
    for (const item of pending) {
        if (item.status === "valid" && item.metadata !== undefined) {
            sum += Math.min(item.metadata.sizeBytes, item.metadata.maxBytesApplied);
        }
    }
    return sum;
}
//# sourceMappingURL=attachment-pending.js.map