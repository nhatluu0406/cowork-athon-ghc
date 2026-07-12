/**
 * Workspace text-file attachment read (Phase 1).
 *
 * Confined to the active workspace grant; rejects traversal, symlink escape, binary, and
 * unsupported extensions. Returns a snapshot at read time — never copies into app data.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, relative } from "node:path";
import { createWorkspaceGuard } from "./guard.js";
import { WorkspaceBoundaryError } from "./errors.js";
import { validateWorkspaceSelection, nodeFsProbe } from "./validate.js";
import {
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_TOTAL_BYTES,
  ATTACHMENT_TEXT_EXTENSIONS,
} from "./attachment-limits.js";

export type AttachmentRejectReason =
  | "outside_workspace"
  | "symlink_escape"
  | "not_found"
  | "not_a_file"
  | "unsupported_type"
  | "binary_content"
  | "file_too_large"
  | "total_budget_exceeded"
  | "invalid_path";

export interface AttachmentMetadata {
  readonly relativePath: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly contentHash: string;
  readonly truncated: boolean;
  readonly maxBytesApplied: number;
}

export interface AttachmentReadSuccess {
  readonly ok: true;
  readonly metadata: AttachmentMetadata;
  readonly content: string;
}

export interface AttachmentReadFailure {
  readonly ok: false;
  readonly reason: AttachmentRejectReason;
  readonly message: string;
}

export type AttachmentReadResult = AttachmentReadSuccess | AttachmentReadFailure;

export interface ReadWorkspaceAttachmentInput {
  readonly workspaceRoot: string;
  readonly absolutePath: string;
  readonly priorBytesUsed?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}

function isSupportedTextExtension(ext: string): boolean {
  const lower = ext.toLowerCase();
  if (ATTACHMENT_TEXT_EXTENSIONS.has(lower)) return true;
  // Extensionless text files (e.g. Makefile) — allow if no extension.
  return lower.length === 0;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function failure(
  reason: AttachmentRejectReason,
  message: string,
): AttachmentReadFailure {
  return { ok: false, reason, message };
}

/**
 * Read a workspace text file for attachment context. Path must be absolute and inside workspace.
 */
export async function readWorkspaceAttachment(
  input: ReadWorkspaceAttachmentInput,
): Promise<AttachmentReadResult> {
  const maxFileBytes = input.maxFileBytes ?? ATTACHMENT_MAX_FILE_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? ATTACHMENT_MAX_TOTAL_BYTES;
  const priorBytesUsed = input.priorBytesUsed ?? 0;

  const validation = await validateWorkspaceSelection(
    { rootPath: input.workspaceRoot },
    nodeFsProbe(),
  );
  if (!validation.ok) {
    return failure("invalid_path", "Workspace không hợp lệ.");
  }

  const guard = createWorkspaceGuard(validation.grant);
  const root = validation.grant.rootPath;

  let relativePath: string;
  try {
    const normalized = input.absolutePath.replace(/\//g, "\\");
    const rootNorm = root.replace(/\//g, "\\");
    if (!normalized.toLowerCase().startsWith(rootNorm.toLowerCase())) {
      return failure("outside_workspace", "Tệp nằm ngoài workspace đang hoạt động.");
    }
    relativePath = relative(rootNorm, normalized).replace(/\\/g, "/");
    if (relativePath.startsWith("..") || relativePath.length === 0) {
      return failure("outside_workspace", "Tệp nằm ngoài workspace đang hoạt động.");
    }
  } catch {
    return failure("invalid_path", "Đường dẫn không hợp lệ.");
  }

  const ext = extname(relativePath);
  if (!isSupportedTextExtension(ext)) {
    return failure(
      "unsupported_type",
      `Loại tệp không được hỗ trợ trong Phase 1 (${ext || "(không có phần mở rộng)"}).`,
    );
  }

  let realPath: string;
  try {
    realPath = await guard.assertRealPathInside(relativePath);
  } catch (err) {
    if (err instanceof WorkspaceBoundaryError) {
      const reason =
        err.reason === "symlink_escape" ? "symlink_escape" : "outside_workspace";
      return failure(
        reason,
        reason === "symlink_escape"
          ? "Liên kết tượng trưng trỏ ra ngoài workspace."
          : "Tệp nằm ngoài workspace đang hoạt động.",
      );
    }
    return failure("outside_workspace", "Tệp nằm ngoài workspace đang hoạt động.");
  }

  let fileStat;
  try {
    fileStat = await stat(realPath);
  } catch {
    return failure("not_found", "Không tìm thấy tệp.");
  }
  if (!fileStat.isFile()) {
    return failure("not_a_file", "Chỉ hỗ trợ tệp văn bản, không hỗ trợ thư mục.");
  }

  if (fileStat.size > maxFileBytes) {
    return failure(
      "file_too_large",
      `Tệp vượt giới hạn ${maxFileBytes} byte (${fileStat.size} byte).`,
    );
  }

  const buf = await readFile(realPath);
  if (buf.includes(0)) {
    return failure("binary_content", "Tệp nhị phân không được hỗ trợ trong Phase 1.");
  }

  const truncated = buf.length > maxFileBytes;
  const slice = truncated ? buf.subarray(0, maxFileBytes) : buf;
  const contentBytes = slice.length;

  if (priorBytesUsed + contentBytes > maxTotalBytes) {
    return failure(
      "total_budget_exceeded",
      `Tổng ngữ cảnh đính kèm vượt giới hạn ${maxTotalBytes} byte.`,
    );
  }

  const metadata: AttachmentMetadata = {
    relativePath,
    filename: basename(relativePath),
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    contentHash: sha256Hex(buf),
    truncated,
    maxBytesApplied: maxFileBytes,
  };

  return {
    ok: true,
    metadata,
    content: slice.toString("utf8"),
  };
}
