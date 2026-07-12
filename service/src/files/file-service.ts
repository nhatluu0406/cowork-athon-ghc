/**
 * `FileService` — the guarded file-mutation surface at the execution boundary (CGHC-018,
 * F1/F2/F3/F6).
 *
 * This is the ONLY component that touches the filesystem for the app. The UI never writes disk
 * directly — it calls this service, which layers two independent defenses on EVERY operation:
 *  1. Confinement (F1/F4): every path — read or write, source and destination — is routed
 *     through {@link WorkspaceGuard.assertRealPathInside}, which does lexical safety THEN a
 *     symlink-aware realpath re-check. A `..`/absolute/UNC/symlink target throws
 *     {@link WorkspaceBoundaryError} before any disk touch.
 *  2. Permission gating (F1/F3): a create/edit/delete/move runs its disk mutation ONLY inside
 *     {@link PermissionGate.proceed}, so the byte-level change happens strictly behind a
 *     recorded Allow. An unapproved or denied request returns `not_allowed` and mutates NOTHING
 *     on disk (P3). Reads are confined but not gated.
 *
 * Errors are mapped to explicit {@link FileOperationError}/{@link WorkspaceBoundaryError} types;
 * a raw disk stack trace never reaches the caller.
 */

import path from "node:path";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { WorkspaceGuard } from "../workspace/index.js";
import type { PermissionGate } from "../permission/index.js";
import { FileOperationError, mapDiskError } from "./errors.js";

/** The minimal filesystem surface the service needs. Injectable so unit tests can substitute it. */
export interface FsPort {
  readFile(realPath: string): Promise<string>;
  writeFile(realPath: string, content: string): Promise<void>;
  unlink(realPath: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  ensureDir(realDir: string): Promise<void>;
  exists(realPath: string): Promise<boolean>;
}

/** Default {@link FsPort} over `node:fs/promises` (UTF-8 text). */
export function nodeFsPort(): FsPort {
  return {
    readFile: (p) => readFile(p, "utf8"),
    writeFile: (p, content) => writeFile(p, content, "utf8"),
    unlink: (p) => unlink(p),
    rename: (from, to) => rename(from, to),
    ensureDir: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    exists: async (p) => {
      try {
        await stat(p);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Outcome of a gated mutation. `not_allowed` means the gate blocked it — nothing changed on disk. */
export type FileMutationResult =
  | { readonly performed: true; readonly realPath: string }
  | { readonly performed: false; readonly reason: "not_allowed" };

export interface FileServiceOptions {
  readonly guard: WorkspaceGuard;
  readonly gate: PermissionGate;
  /** Injectable filesystem; defaults to {@link nodeFsPort}. */
  readonly fs?: FsPort;
}

export class FileService {
  private readonly guard: WorkspaceGuard;
  private readonly gate: PermissionGate;
  private readonly fs: FsPort;

  constructor(options: FileServiceOptions) {
    this.guard = options.guard;
    this.gate = options.gate;
    this.fs = options.fs ?? nodeFsPort();
  }

  /** Read a confined file (F1). Guarded, not permission-gated. Maps disk errors to explicit types. */
  async read(relPath: string): Promise<string> {
    const realPath = await this.guard.assertRealPathInside(relPath);
    try {
      return await this.fs.readFile(realPath);
    } catch (err) {
      throw mapDiskError(err);
    }
  }

  /** Create/overwrite a confined file behind a recorded Allow (F1/F3/F6). */
  create(requestId: string, relPath: string, content: string): Promise<FileMutationResult> {
    return this.guardedWrite(requestId, relPath, content, false);
  }

  /** Edit an EXISTING confined file behind a recorded Allow (F1/F3/F6). */
  edit(requestId: string, relPath: string, content: string): Promise<FileMutationResult> {
    return this.guardedWrite(requestId, relPath, content, true);
  }

  /** Delete a confined file behind a recorded, ELEVATED Allow (F3/F6). Denied ⇒ removes nothing. */
  async delete(requestId: string, relPath: string): Promise<FileMutationResult> {
    const realPath = await this.guard.assertRealPathInside(relPath);
    return this.runGated(requestId, realPath, async () => {
      try {
        await this.fs.unlink(realPath);
      } catch (err) {
        throw mapDiskError(err);
      }
    });
  }

  /** Move/rename a confined file behind a recorded, ELEVATED Allow (F2/F6). Both ends confined. */
  async move(requestId: string, srcRel: string, destRel: string): Promise<FileMutationResult> {
    const srcReal = await this.guard.assertRealPathInside(srcRel);
    const destReal = await this.guard.assertRealPathInside(destRel);
    if (!(await this.fs.exists(srcReal))) {
      throw new FileOperationError("not_found", "The source file does not exist.");
    }
    if (await this.fs.exists(destReal)) {
      throw new FileOperationError("already_exists", "The destination already exists.");
    }
    return this.runGated(requestId, destReal, async () => {
      try {
        await this.fs.ensureDir(path.dirname(destReal));
        await this.fs.rename(srcReal, destReal);
      } catch (err) {
        throw mapDiskError(err);
      }
    });
  }

  private async guardedWrite(
    requestId: string,
    relPath: string,
    content: string,
    mustExist: boolean,
  ): Promise<FileMutationResult> {
    const realPath = await this.guard.assertRealPathInside(relPath);
    if (mustExist && !(await this.fs.exists(realPath))) {
      throw new FileOperationError("not_found", "The target file does not exist.");
    }
    return this.runGated(requestId, realPath, async () => {
      try {
        await this.fs.ensureDir(path.dirname(realPath));
        await this.fs.writeFile(realPath, content);
      } catch (err) {
        throw mapDiskError(err);
      }
    });
  }

  /**
   * Run `perform` strictly behind a recorded Allow (P3). {@link PermissionGate.proceed} invokes
   * the callback ONLY when an Allow exists; otherwise the callback never runs and disk is
   * untouched. The async disk work is awaited AFTER the gate has authorized it.
   */
  private async runGated(
    requestId: string,
    realPath: string,
    perform: () => Promise<void>,
  ): Promise<FileMutationResult> {
    const gated = this.gate.proceed(requestId, perform);
    if (!gated.performed) return { performed: false, reason: "not_allowed" };
    await gated.result;
    return { performed: true, realPath };
  }
}
