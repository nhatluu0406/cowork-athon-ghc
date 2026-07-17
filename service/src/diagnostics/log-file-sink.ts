/**
 * Bounded, rotating file sink for the {@link RedactingLogger} (Wave 6 — local structured logging).
 *
 * Records arrive ALREADY SCRUBBED (the logger runs every message/field through the SecretScrubber
 * before any sink — see redacting-logger.ts). This sink only persists them; it never un-redacts.
 *
 * Format: one JSON object per line (JSON-lines). Writing `JSON.stringify(record)` is inherently
 * log-injection-safe — any newline/control character inside a message is escaped by JSON encoding,
 * so a crafted log message can never forge a second record line.
 *
 * Bounding: the active file is capped at `maxBytes`. On overflow it rotates
 * `cowork-ghc.log` → `.1` → `.2` … keeping at most `maxFiles` files total (retention); the oldest
 * is deleted. This caps total on-disk log size at roughly `maxBytes * maxFiles`.
 *
 * All fs access is injectable so tests can drive rotation deterministically against a temp dir.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { LogRecord, LogSink } from "./redacting-logger.js";

/** Minimal fs seam so tests can inject an in-memory / temp implementation. */
export interface LogFileSystem {
  appendFileSync(path: string, data: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string): void;
  statSize(path: string): number;
}

const nodeFs: LogFileSystem = {
  appendFileSync: (path, data) => appendFileSync(path, data, "utf8"),
  existsSync: (path) => existsSync(path),
  mkdirSync: (path) => mkdirSync(path, { recursive: true }),
  renameSync: (from, to) => renameSync(from, to),
  rmSync: (path) => rmSync(path, { force: true }),
  statSize: (path) => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  },
};

export interface FileSinkOptions {
  /** Directory that owns the log files (created if missing). */
  readonly dir: string;
  /** Active log file name. Default `cowork-ghc.log`. */
  readonly fileName?: string;
  /** Rotate once the active file would exceed this size (bytes). Default 1 MiB. */
  readonly maxBytes?: number;
  /** Total files kept including the active one (retention). Default 5. Minimum 1. */
  readonly maxFiles?: number;
  /** Injectable fs (tests). Defaults to node fs. */
  readonly fs?: LogFileSystem;
}

export interface FileSink {
  /** The {@link LogSink} to hand to the logger. */
  readonly sink: LogSink;
  /** Absolute path to the active log file. */
  readonly filePath: string;
  /** Current active-file size in bytes (as tracked by this sink). */
  size(): number;
  /** Delete the active log file and all rotated archives (user "Clear logs"). */
  clear(): void;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

/**
 * Create a rotating, size-bounded JSON-lines file sink. Never throws from `sink` — a filesystem
 * error is swallowed so logging can never crash the loopback service (the whole point of logging is
 * to observe failures, not create new ones).
 */
export function createFileSink(options: FileSinkOptions): FileSink {
  const fs = options.fs ?? nodeFs;
  const dir = options.dir;
  const fileName = options.fileName ?? "cowork-ghc.log";
  const maxBytes = options.maxBytes && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles && options.maxFiles >= 1 ? Math.floor(options.maxFiles) : DEFAULT_MAX_FILES;
  const filePath = join(dir, fileName);

  let dirReady = false;
  const ensureDir = (): void => {
    if (dirReady) return;
    fs.mkdirSync(dir);
    dirReady = true;
  };

  // Seed the running size from any existing file so restarts don't blow past maxBytes.
  let currentSize = fs.statSize(filePath);

  const archivePath = (n: number): string => join(dir, `${fileName}.${n}`);

  const rotate = (): void => {
    // Drop the oldest, shift the rest up, then move the active file to `.1`.
    const oldest = archivePath(maxFiles - 1);
    if (fs.existsSync(oldest)) fs.rmSync(oldest);
    for (let i = maxFiles - 2; i >= 1; i -= 1) {
      const from = archivePath(i);
      if (fs.existsSync(from)) fs.renameSync(from, archivePath(i + 1));
    }
    if (fs.existsSync(filePath)) fs.renameSync(filePath, archivePath(1));
    currentSize = 0;
  };

  const sink: LogSink = (record: LogRecord) => {
    try {
      ensureDir();
      const line = `${JSON.stringify(record)}\n`;
      const bytes = Buffer.byteLength(line, "utf8");
      // Rotate before writing when the active file already has content and would overflow. A single
      // record larger than maxBytes still gets its own file (we never split a record across files).
      if (currentSize > 0 && currentSize + bytes > maxBytes) {
        if (maxFiles > 1) rotate();
        else {
          // Retention of 1: truncate by removing the active file before the next write.
          if (fs.existsSync(filePath)) fs.rmSync(filePath);
          currentSize = 0;
        }
      }
      fs.appendFileSync(filePath, line);
      currentSize += bytes;
    } catch {
      // Logging must never throw into the service. A failed write is dropped silently.
    }
  };

  const clear = (): void => {
    try {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
      for (let i = 1; i <= maxFiles; i += 1) {
        const archive = archivePath(i);
        if (fs.existsSync(archive)) fs.rmSync(archive);
      }
      currentSize = 0;
    } catch {
      // best-effort
    }
  };

  return { sink, filePath, size: () => currentSize, clear };
}
