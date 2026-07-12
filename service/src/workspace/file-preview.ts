/**
 * Safe workspace file preview (bounded, workspace-confined).
 */

import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { createWorkspaceGuard } from "./guard.js";
import { validateWorkspaceSelection, nodeFsProbe } from "./validate.js";

const DEFAULT_MAX_BYTES = 64 * 1024;

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

export interface FilePreviewResult {
  readonly relativePath: string;
  readonly kind: "text" | "binary" | "missing";
  readonly content?: string;
  readonly truncated: boolean;
  readonly sizeBytes: number;
}

export interface FilePreviewOptions {
  readonly maxBytes?: number;
}

function isProbablyBinary(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

export async function readWorkspaceFilePreview(
  workspaceRoot: string,
  relativePath: string,
  options: FilePreviewOptions = {},
): Promise<FilePreviewResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const validation = await validateWorkspaceSelection({ rootPath: workspaceRoot }, nodeFsProbe());
  if (!validation.ok) {
    throw new Error("Workspace không hợp lệ.");
  }
  const guard = createWorkspaceGuard(validation.grant);
  const ext = extname(relativePath);
  if (isProbablyBinary(ext)) {
    return { relativePath, kind: "binary", truncated: false, sizeBytes: 0 };
  }

  let realPath: string;
  try {
    realPath = await guard.assertRealPathInside(relativePath);
  } catch {
    throw new Error("Đường dẫn nằm ngoài workspace.");
  }

  let sizeBytes = 0;
  try {
    const info = await stat(realPath);
    if (!info.isFile()) {
      return { relativePath, kind: "missing", truncated: false, sizeBytes: 0 };
    }
    sizeBytes = info.size;
  } catch {
    return { relativePath, kind: "missing", truncated: false, sizeBytes: 0 };
  }

  const buf = await readFile(realPath);
  if (buf.includes(0)) {
    return { relativePath, kind: "binary", truncated: false, sizeBytes };
  }
  const truncated = buf.length > maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;
  return {
    relativePath,
    kind: "text",
    content: slice.toString("utf8"),
    truncated,
    sizeBytes,
  };
}

/** Simple line-based unified diff for small text previews. */
export function unifiedDiff(before: string, after: string, relativePath: string): string {
  if (before === after) return "(không có thay đổi)";
  const bLines = before.split(/\r?\n/u);
  const aLines = after.split(/\r?\n/u);
  const out: string[] = [`--- ${relativePath}`, `+++ ${relativePath}`];
  const max = Math.max(bLines.length, aLines.length);
  for (let i = 0; i < max; i += 1) {
    const b = bLines[i];
    const a = aLines[i];
    if (b === a) {
      if (b !== undefined) out.push(` ${b}`);
    } else {
      if (b !== undefined) out.push(`-${b}`);
      if (a !== undefined) out.push(`+${a}`);
    }
  }
  return out.join("\n");
}
