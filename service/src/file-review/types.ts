/**
 * File review taxonomy and persisted review artifacts.
 */

import type { FileMutationOp } from "@cowork-ghc/contracts";

export type FileEventSource = "user_attachment" | "runtime_tool" | "system";

export type FileEventKind =
  | "attachment_context"
  | "runtime_file_read"
  | "file_created"
  | "file_modified"
  | "file_deleted"
  | "permission_requested"
  | "permission_approved"
  | "permission_denied";

export type FileReviewPermissionDecision =
  | "allowed_once"
  | "allowed_always"
  | "denied"
  | "timeout";

/** Bounded snapshot captured at a point in time (mutation or read). */
export interface FileSnapshotCapture {
  readonly relativePath: string;
  readonly exists: boolean;
  readonly kind: "text" | "binary" | "missing";
  readonly content?: string;
  readonly hash?: string;
  readonly sizeBytes: number;
  readonly modifiedAt?: string;
  readonly truncated: boolean;
  readonly contentRedacted: boolean;
}

/** Persisted review artifact for one file event (no unbounded raw content). */
export interface FileReviewArtifact {
  readonly id: string;
  readonly eventKind: FileEventKind;
  readonly relativePath: string;
  readonly at: string;
  readonly seq: number;
  readonly source: FileEventSource;
  readonly operation?: FileMutationOp;
  readonly callId?: string;
  readonly runtimeTurnId?: string;
  readonly permissionDecision?: FileReviewPermissionDecision;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly beforePreview?: string;
  readonly afterPreview?: string;
  readonly unifiedDiff?: string;
  readonly truncated: boolean;
  readonly diffTruncated: boolean;
  readonly previewTruncated: boolean;
  readonly isBinary: boolean;
  readonly contentRedacted: boolean;
  readonly currentFileHashMismatch?: boolean;
}
