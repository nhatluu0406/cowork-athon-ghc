/**
 * Pending workspace attachment chips (pre-send state).
 */
import type { AttachmentMetadata } from "./service-client.js";
export interface PendingAttachment {
    readonly id: string;
    readonly relativePath: string;
    readonly filename: string;
    readonly status: "valid" | "error";
    readonly errorMessage?: string;
    readonly metadata?: AttachmentMetadata;
}
export declare function createPendingAttachmentId(): string;
export declare function totalValidBytes(pending: readonly PendingAttachment[]): number;
//# sourceMappingURL=attachment-pending.d.ts.map