/**
 * Build persisted file review artifacts from before/after snapshots.
 */

import type { FileMutationOp } from "@cowork-ghc/contracts";
import { buildUnifiedDiff } from "./diff.js";
import { FILE_REVIEW_MAX_PREVIEW_BYTES } from "./limits.js";
import type {
  FileEventKind,
  FileEventSource,
  FileReviewArtifact,
  FileReviewPermissionDecision,
  FileSnapshotCapture,
} from "./types.js";

export interface BuildReviewInput {
  readonly id: string;
  readonly relativePath: string;
  readonly at: string;
  readonly seq: number;
  readonly source: FileEventSource;
  readonly operation?: FileMutationOp;
  readonly callId?: string;
  readonly runtimeTurnId?: string;
  readonly permissionDecision?: FileReviewPermissionDecision;
  readonly before?: FileSnapshotCapture;
  readonly after?: FileSnapshotCapture;
  readonly currentFileHash?: string;
}

function eventKindForOperation(op: FileMutationOp | undefined): FileEventKind {
  switch (op) {
    case "create":
      return "file_created";
    case "edit":
      return "file_modified";
    case "delete":
      return "file_deleted";
    case "move":
      return "file_modified";
    default:
      return "file_modified";
  }
}

function trimPreview(content: string | undefined, maxBytes: number): { text?: string; truncated: boolean } {
  if (content === undefined) return { truncated: false };
  const buf = Buffer.from(content, "utf8");
  if (buf.length <= maxBytes) return { text: content, truncated: false };
  return { text: buf.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

export function buildFileReviewArtifact(input: BuildReviewInput): FileReviewArtifact {
  const before = input.before;
  const after = input.after;
  const beforeExists = before?.exists === true;
  const afterExists = after?.exists === true;
  const isBinary = before?.kind === "binary" || after?.kind === "binary";
  const contentRedacted =
    before?.contentRedacted === true || after?.contentRedacted === true;

  const eventKind =
    input.operation !== undefined ? eventKindForOperation(input.operation) : "runtime_file_read";

  let unifiedDiff: string | undefined;
  let diffTruncated = false;
  let previewTruncated = false;

  if (contentRedacted) {
    unifiedDiff = undefined;
  } else if (isBinary) {
    unifiedDiff = undefined;
  } else if (input.operation === "create" && after?.content !== undefined) {
    const preview = trimPreview(after.content, FILE_REVIEW_MAX_PREVIEW_BYTES);
    previewTruncated = preview.truncated;
    unifiedDiff = buildUnifiedDiff("", after.content, input.relativePath).text;
    diffTruncated = buildUnifiedDiff("", after.content, input.relativePath).truncated;
  } else if (input.operation === "delete" && before?.content !== undefined) {
    const preview = trimPreview(before.content, FILE_REVIEW_MAX_PREVIEW_BYTES);
    previewTruncated = preview.truncated;
    unifiedDiff = buildUnifiedDiff(before.content, "", input.relativePath).text;
    diffTruncated = buildUnifiedDiff(before.content, "", input.relativePath).truncated;
  } else if (before?.content !== undefined && after?.content !== undefined) {
    const diff = buildUnifiedDiff(before.content, after.content, input.relativePath);
    unifiedDiff = diff.text;
    diffTruncated = diff.truncated;
    previewTruncated = before.truncated || after.truncated;
  }

  const beforePreview =
    contentRedacted || isBinary
      ? undefined
      : trimPreview(before?.content, FILE_REVIEW_MAX_PREVIEW_BYTES).text;
  const afterPreview =
    contentRedacted || isBinary
      ? undefined
      : trimPreview(after?.content, FILE_REVIEW_MAX_PREVIEW_BYTES).text;

  if (beforePreview !== undefined && before?.truncated === true) previewTruncated = true;
  if (afterPreview !== undefined && after?.truncated === true) previewTruncated = true;

  const afterHash = after?.hash;
  const currentFileHashMismatch =
    input.currentFileHash !== undefined &&
    afterHash !== undefined &&
    input.currentFileHash !== afterHash;

  return {
    id: input.id,
    eventKind,
    relativePath: input.relativePath,
    at: input.at,
    seq: input.seq,
    source: input.source,
    ...(input.operation !== undefined ? { operation: input.operation } : {}),
    ...(input.callId !== undefined ? { callId: input.callId } : {}),
    ...(input.runtimeTurnId !== undefined ? { runtimeTurnId: input.runtimeTurnId } : {}),
    ...(input.permissionDecision !== undefined
      ? { permissionDecision: input.permissionDecision }
      : {}),
    beforeExists,
    afterExists,
    ...(before?.hash !== undefined ? { beforeHash: before.hash } : {}),
    ...(afterHash !== undefined ? { afterHash } : {}),
    ...(beforePreview !== undefined ? { beforePreview } : {}),
    ...(afterPreview !== undefined ? { afterPreview } : {}),
    ...(unifiedDiff !== undefined ? { unifiedDiff } : {}),
    truncated: before?.truncated === true || after?.truncated === true,
    diffTruncated,
    previewTruncated,
    isBinary,
    contentRedacted,
    ...(currentFileHashMismatch ? { currentFileHashMismatch: true } : {}),
  };
}

/** Map a file mutation op to review event kind label (Vietnamese, past tense). */
export function fileEventLabel(kind: FileEventKind): string {
  switch (kind) {
    case "attachment_context":
      return "Đã đưa tệp vào ngữ cảnh";
    case "runtime_file_read":
      return "Đã đọc tệp";
    case "file_created":
      return "Đã tạo tệp";
    case "file_modified":
      return "Đã sửa tệp";
    case "file_deleted":
      return "Đã xóa tệp";
    case "permission_requested":
      return "Đã yêu cầu quyền";
    case "permission_approved":
      return "Đã cho phép";
    case "permission_denied":
      return "Đã từ chối";
  }
}
