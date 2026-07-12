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

export function totalValidBytes(pending: readonly PendingAttachment[]): number {
  let sum = 0;
  for (const item of pending) {
    if (item.status === "valid" && item.metadata !== undefined) {
      sum += Math.min(item.metadata.sizeBytes, item.metadata.maxBytesApplied);
    }
  }
  return sum;
}
