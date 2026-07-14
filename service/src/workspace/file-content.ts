/**
 * Rich workspace file read/write for Workspace Companion Phase 1.
 * All paths are workspace-relative and confined via WorkspaceGuard.
 */

import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { createWorkspaceGuard } from "./guard.js";
import { validateWorkspaceSelection, nodeFsProbe } from "./validate.js";

const TEXT_EDIT_MAX_BYTES = 512 * 1024;
const BINARY_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export type WorkspaceFileContentKind =
  | "text"
  | "image"
  | "pdf"
  | "docx"
  | "spreadsheet"
  | "missing"
  | "unsupported";

export interface SpreadsheetSheetView {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

export interface WorkspaceFileContentResult {
  readonly relativePath: string;
  readonly kind: WorkspaceFileContentKind;
  readonly editable: boolean;
  readonly mimeType?: string;
  readonly content?: string;
  readonly html?: string;
  readonly dataBase64?: string;
  readonly sheets?: readonly SpreadsheetSheetView[];
  readonly truncated: boolean;
  readonly sizeBytes: number;
}

export interface WorkspaceFileWriteInput {
  readonly kind: "text" | "spreadsheet";
  readonly content?: string;
  readonly sheets?: readonly SpreadsheetSheetView[];
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md"]);
const SPREADSHEET_EXTENSIONS = new Set([".xlsx"]);

function mimeForImage(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

function normalizeExt(relativePath: string): string {
  return extname(relativePath).toLowerCase();
}

async function atomicWriteFile(path: string, data: string | Buffer): Promise<void> {
  const temp = join(
    dirname(path),
    `.cowork-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function resolveFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<{ guard: ReturnType<typeof createWorkspaceGuard>; realPath: string; ext: string }> {
  const validation = await validateWorkspaceSelection({ rootPath: workspaceRoot }, nodeFsProbe());
  if (!validation.ok) throw new Error("Workspace không hợp lệ.");
  const guard = createWorkspaceGuard(validation.grant);
  const ext = normalizeExt(relativePath);
  let realPath: string;
  try {
    realPath = await guard.assertRealPathInside(relativePath);
  } catch {
    throw new Error("Đường dẫn nằm ngoài workspace.");
  }
  return { guard, realPath, ext };
}

export async function readWorkspaceFileContent(
  workspaceRoot: string,
  relativePath: string,
): Promise<WorkspaceFileContentResult> {
  const { realPath, ext } = await resolveFile(workspaceRoot, relativePath);

  let sizeBytes = 0;
  try {
    const info = await stat(realPath);
    if (!info.isFile()) {
      return { relativePath, kind: "missing", editable: false, truncated: false, sizeBytes: 0 };
    }
    sizeBytes = info.size;
  } catch {
    return { relativePath, kind: "missing", editable: false, truncated: false, sizeBytes: 0 };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    const buf = await readFile(realPath);
    const truncated = buf.length > TEXT_EDIT_MAX_BYTES;
    const slice = truncated ? buf.subarray(0, TEXT_EDIT_MAX_BYTES) : buf;
    if (slice.includes(0)) {
      return { relativePath, kind: "unsupported", editable: false, truncated: false, sizeBytes };
    }
    return {
      relativePath,
      kind: "text",
      editable: !truncated,
      content: slice.toString("utf8"),
      truncated,
      sizeBytes,
    };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    if (sizeBytes > BINARY_PREVIEW_MAX_BYTES) {
      return { relativePath, kind: "unsupported", editable: false, truncated: true, sizeBytes };
    }
    const buf = await readFile(realPath);
    return {
      relativePath,
      kind: "image",
      editable: false,
      mimeType: mimeForImage(ext),
      dataBase64: buf.toString("base64"),
      truncated: false,
      sizeBytes,
    };
  }

  if (ext === ".pdf") {
    if (sizeBytes > BINARY_PREVIEW_MAX_BYTES) {
      return { relativePath, kind: "unsupported", editable: false, truncated: true, sizeBytes };
    }
    const buf = await readFile(realPath);
    return {
      relativePath,
      kind: "pdf",
      editable: false,
      mimeType: "application/pdf",
      dataBase64: buf.toString("base64"),
      truncated: false,
      sizeBytes,
    };
  }

  if (ext === ".docx") {
    if (sizeBytes > BINARY_PREVIEW_MAX_BYTES) {
      return { relativePath, kind: "unsupported", editable: false, truncated: true, sizeBytes };
    }
    const buf = await readFile(realPath);
    const result = await mammoth.extractRawText({ buffer: buf });
    return {
      relativePath,
      kind: "docx",
      editable: false,
      content: result.value,
      truncated: false,
      sizeBytes,
    };
  }

  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    if (sizeBytes > BINARY_PREVIEW_MAX_BYTES) {
      return { relativePath, kind: "unsupported", editable: false, truncated: true, sizeBytes };
    }
    const buf = await readFile(realPath);
    const workbook = XLSX.read(buf, { type: "buffer" });
    const sheets: SpreadsheetSheetView[] = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      if (sheet === undefined) return { name, rows: [] as string[][] };
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" }) as string[][];
      return { name, rows };
    });
    return {
      relativePath,
      kind: "spreadsheet",
      editable: false,
      sheets,
      truncated: false,
      sizeBytes,
    };
  }

  return { relativePath, kind: "unsupported", editable: false, truncated: false, sizeBytes };
}

export async function writeWorkspaceFileContent(
  workspaceRoot: string,
  relativePath: string,
  input: WorkspaceFileWriteInput,
): Promise<{ readonly relativePath: string; readonly sizeBytes: number }> {
  const { realPath, ext } = await resolveFile(workspaceRoot, relativePath);

  if (input.kind === "text") {
    if (!TEXT_EXTENSIONS.has(ext)) throw new Error("Loại tệp này không hỗ trợ chỉnh sửa văn bản.");
    const content = input.content ?? "";
    if (Buffer.byteLength(content, "utf8") > TEXT_EDIT_MAX_BYTES) {
      throw new Error("Nội dung vượt giới hạn 512 KiB.");
    }
    await atomicWriteFile(realPath, content);
    const info = await stat(realPath);
    return { relativePath, sizeBytes: info.size };
  }

  if (input.kind === "spreadsheet") {
    throw new Error(
      "Chỉnh sửa XLSX tạm thời bị vô hiệu hóa để tránh mất công thức, định dạng hoặc sheet khác.",
    );
  }

  throw new Error("Loại ghi không được hỗ trợ.");
}
