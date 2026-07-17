/**
 * Bounded workspace file snapshot capture for review (hash, size, mtime).
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { isSecretLikeAttachmentPath } from "../workspace/attachment-secret-policy.js";
import { createWorkspaceGuard } from "../workspace/guard.js";
import { validateWorkspaceSelection, nodeFsProbe } from "../workspace/validate.js";
import {
  FILE_REVIEW_MAX_PREVIEW_BYTES,
  FILE_REVIEW_MAX_SNAPSHOT_BYTES,
} from "./limits.js";
import type { FileSnapshotCapture } from "./types.js";

const BINARY_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".zip",
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".wasm",
  ".bin",
]);

export interface CaptureSnapshotOptions {
  readonly maxBytes?: number;
  readonly redactSecrets?: boolean;
}

function isProbablyBinary(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function captureWorkspaceFileSnapshot(
  workspaceRoot: string,
  relativePath: string,
  options: CaptureSnapshotOptions = {},
): Promise<FileSnapshotCapture> {
  const maxBytes = options.maxBytes ?? FILE_REVIEW_MAX_SNAPSHOT_BYTES;
  const redact = options.redactSecrets !== false && isSecretLikeAttachmentPath(relativePath);

  const validation = await validateWorkspaceSelection({ rootPath: workspaceRoot }, nodeFsProbe());
  if (!validation.ok) {
    throw new Error("Workspace không hợp lệ.");
  }
  const guard = createWorkspaceGuard(validation.grant);

  let realPath: string;
  try {
    realPath = await guard.assertRealPathInside(relativePath);
  } catch {
    if (redact) {
      return {
        relativePath,
        exists: false,
        kind: "missing",
        sizeBytes: 0,
        truncated: false,
        contentRedacted: true,
      };
    }
    return {
      relativePath,
      exists: false,
      kind: "missing",
      sizeBytes: 0,
      truncated: false,
      contentRedacted: false,
    };
  }

  let info;
  try {
    info = await stat(realPath);
  } catch {
    if (redact) {
      return {
        relativePath,
        exists: false,
        kind: "missing",
        sizeBytes: 0,
        truncated: false,
        contentRedacted: true,
      };
    }
    return {
      relativePath,
      exists: false,
      kind: "missing",
      sizeBytes: 0,
      truncated: false,
      contentRedacted: false,
    };
  }
  if (!info.isFile()) {
    return {
      relativePath,
      exists: false,
      kind: "missing",
      sizeBytes: 0,
      truncated: false,
      contentRedacted: redact,
    };
  }

  if (redact) {
    return {
      relativePath,
      exists: true,
      kind: "text",
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      truncated: false,
      contentRedacted: true,
    };
  }

  const ext = extname(relativePath);
  if (isProbablyBinary(ext)) {
    return {
      relativePath,
      exists: true,
      kind: "binary",
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      truncated: false,
      contentRedacted: false,
    };
  }

  const buf = await readFile(realPath);
  if (buf.includes(0)) {
    return {
      relativePath,
      exists: true,
      kind: "binary",
      hash: hashContent(buf.subarray(0, Math.min(buf.length, maxBytes))),
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      truncated: false,
      contentRedacted: false,
    };
  }

  const truncated = buf.length > maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;
  const content = slice.toString("utf8");
  return {
    relativePath,
    exists: true,
    kind: "text",
    content,
    hash: hashContent(buf),
    sizeBytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    truncated,
    contentRedacted: false,
  };
}

/** Preview bytes cap alias for review panel single-side display. */
export const REVIEW_PREVIEW_MAX_BYTES = FILE_REVIEW_MAX_PREVIEW_BYTES;
