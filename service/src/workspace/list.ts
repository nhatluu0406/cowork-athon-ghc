/**
 * Read-only workspace listing for the Minimal Workspace Navigator.
 *
 * This is intentionally shallow and workspace-confined. It lists only direct children of a
 * requested folder and never reads file contents.
 */

import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createWorkspaceGuard } from "./guard.js";
import { isInsideRoot } from "./path-safety.js";
import { validateWorkspaceSelection, nodeFsProbe } from "./validate.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export type WorkspaceEntryKind = "file" | "folder";

export interface WorkspaceListEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: WorkspaceEntryKind;
  readonly extension?: string;
  readonly sizeBytes?: number;
  readonly modifiedTime?: string;
}

export interface WorkspaceListResult {
  readonly rootName: string;
  readonly parentPath: string;
  readonly entries: readonly WorkspaceListEntry[];
  readonly truncated: boolean;
  readonly limit: number;
}

export interface WorkspaceListOptions {
  readonly relativePath?: string;
  readonly limit?: number;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function toWorkspaceRelative(parent: string, name: string): string {
  return parent.length === 0 ? name : `${parent.replace(/\\/g, "/")}/${name}`;
}

function compareEntries(a: WorkspaceListEntry, b: WorkspaceListEntry): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, "vi", { sensitivity: "base", numeric: true });
}

export async function listWorkspaceChildren(
  workspaceRoot: string,
  options: WorkspaceListOptions = {},
): Promise<WorkspaceListResult> {
  const validation = await validateWorkspaceSelection({ rootPath: workspaceRoot }, nodeFsProbe());
  if (!validation.ok) {
    throw new Error("Workspace không hợp lệ.");
  }

  const limit = clampLimit(options.limit);
  const parentPath = options.relativePath?.trim().replace(/\\/g, "/") ?? "";
  const guard = createWorkspaceGuard(validation.grant);
  const parentRealPath = await guard.assertRealPathInside(parentPath);
  const parentInfo = await stat(parentRealPath);
  if (!parentInfo.isDirectory()) {
    throw new Error("Đường dẫn không phải thư mục.");
  }

  const realRoot = await realpath(validation.grant.rootPath);
  const dirents = await readdir(parentRealPath, { withFileTypes: true });
  const entries: WorkspaceListEntry[] = [];

  for (const dirent of dirents) {
    if (entries.length >= limit + 1) break;
    const childRealPath = path.join(parentRealPath, dirent.name);
    let childInfo;
    try {
      childInfo = await lstat(childRealPath);
      if (childInfo.isSymbolicLink()) {
        const target = await realpath(childRealPath).catch(() => undefined);
        if (target === undefined || !isInsideRoot(realRoot, target)) continue;
        childInfo = await stat(childRealPath);
      }
    } catch {
      continue;
    }

    if (!childInfo.isDirectory() && !childInfo.isFile()) continue;

    const kind: WorkspaceEntryKind = childInfo.isDirectory() ? "folder" : "file";
    const relativePath = toWorkspaceRelative(parentPath, dirent.name);
    entries.push({
      name: dirent.name,
      relativePath,
      kind,
      ...(kind === "file" ? { extension: path.extname(dirent.name).toLowerCase(), sizeBytes: childInfo.size } : {}),
      modifiedTime: childInfo.mtime.toISOString(),
    });
  }

  const sorted = entries.sort(compareEntries);
  const truncated = sorted.length > limit;
  return {
    rootName: path.basename(validation.grant.rootPath),
    parentPath,
    entries: truncated ? sorted.slice(0, limit) : sorted,
    truncated,
    limit,
  };
}
