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

export function createPendingAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * True when `relativePath` is already among the pending attachments (valid or errored). Used to
 * dedupe the `@`-mention attach path so mentioning the same file twice does not re-read it.
 */
export function isPendingRelativePath(
  pending: readonly PendingAttachment[],
  relativePath: string,
): boolean {
  return pending.some((item) => item.relativePath === relativePath);
}

export function totalValidBytes(pending: readonly PendingAttachment[]): number {
  let sum = 0;
  for (const item of pending) {
    if (item.status === "valid" && item.metadata !== undefined) {
      sum += Math.min(item.metadata.sizeBytes, item.metadata.maxBytesApplied);
    }
  }
  return sum;
}
