/**
 * Typed errors for the guarded file-mutation surface (CGHC-018, F1/F3/F6).
 *
 * Every failure the {@link import("./file-service.js").FileService} surfaces carries a stable,
 * non-secret {@link FileErrorReason} code so the UI can offer a recovery action and the local
 * audit trail can classify it. Messages are deliberately generic: they NEVER embed a raw disk
 * path, a stack trace, or a secret. A workspace-boundary escape keeps its own
 * {@link import("../workspace/index.js").WorkspaceBoundaryError} type; this maps only the
 * disk/IO and permission-gating outcomes.
 */

/** Stable, non-secret classification of a file-operation failure. */
export type FileErrorReason =
  | "not_allowed" // no recorded Allow at the gate — the mutation was blocked (P3).
  | "not_found" // the target does not exist (edit/delete/move-source).
  | "already_exists" // the destination already exists (move refuses to clobber).
  | "io_error"; // an underlying filesystem error (mapped, never a raw stack).

/** Thrown by the file service for a disk/gating failure. Carries no path or secret material. */
export class FileOperationError extends Error {
  readonly code = "file_operation_failed" as const;
  readonly reason: FileErrorReason;
  constructor(reason: FileErrorReason, message: string) {
    super(message);
    this.name = "FileOperationError";
    this.reason = reason;
  }
}

interface NodeErrno {
  readonly code?: string;
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as NodeErrno).code : undefined;
}

/**
 * Map an unknown thrown disk error into a {@link FileOperationError} with a generic message.
 * The raw error (which may embed an absolute path in its message/stack) is NEVER surfaced to
 * the caller — only the stable reason + a fixed sentence.
 */
export function mapDiskError(err: unknown): FileOperationError {
  switch (errnoCode(err)) {
    case "ENOENT":
      return new FileOperationError("not_found", "The target file does not exist.");
    case "EEXIST":
      return new FileOperationError("already_exists", "The destination already exists.");
    default:
      return new FileOperationError("io_error", "The file operation could not be completed.");
  }
}
