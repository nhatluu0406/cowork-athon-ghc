/**
 * Central Cowork GHC writable-data path resolver (Wave 0A).
 *
 * Production packaged default:
 *   %LOCALAPPDATA%\Cowork GHC\data\cowork-ghc.db
 *
 * Development default:
 *   <repo>\.runtime\data\cowork-ghc.db
 *
 * Test / controlled override:
 *   COWORK_GHC_RUNTIME_ROOT=<abs> → <root>\data\cowork-ghc.db
 *
 * Migrations stay in application code. This resolver only places writable data/
 * and data/backups/. Pure + injectable (no Electron import) so unit tests cover it.
 */

import { mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const COWORK_GHC_RUNTIME_ROOT_ENV = "COWORK_GHC_RUNTIME_ROOT";

export interface ResolveCoworkDataPathsInput {
  /** Packaged Electron build vs repo development. */
  readonly isPackaged: boolean;
  /**
   * Repository / app root used in development. Must be absolute.
   * Ignored when {@link COWORK_GHC_RUNTIME_ROOT_ENV} is set.
   */
  readonly repoRoot: string;
  /**
   * Windows LOCALAPPDATA (or injected stand-in). Required when packaged and no
   * runtime-root override is set.
   */
  readonly localAppData?: string;
  /** Env map (default `process.env`). */
  readonly env?: Record<string, string | undefined>;
  /**
   * When true, create `data/` and `data/backups/` under the resolved root.
   * Default true for production call sites; tests may disable.
   */
  readonly ensureDirectories?: boolean;
}

export interface CoworkDataPaths {
  /** Writable root that owns `data/` (and optionally Electron profile siblings). */
  readonly dataRoot: string;
  /** Absolute path to `cowork-ghc.db`. */
  readonly databasePath: string;
  /** Absolute path to `data/backups/`. */
  readonly backupRoot: string;
}

export class CoworkDataPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoworkDataPathError";
  }
}

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t && t.length > 0 ? t : undefined;
}

function assertAbsolute(label: string, path: string): string {
  if (!isAbsolute(path)) {
    throw new CoworkDataPathError(`${label} must be an absolute path (got "${path}").`);
  }
  return resolve(path);
}

/**
 * Resolve the single Cowork GHC data layout. All database consumers must use this —
 * do not reconstruct the path in multiple modules.
 */
export function resolveCoworkDataPaths(input: ResolveCoworkDataPathsInput): CoworkDataPaths {
  const env = input.env ?? (process.env as Record<string, string | undefined>);
  const override = trimmed(env[COWORK_GHC_RUNTIME_ROOT_ENV]);

  let dataRoot: string;
  if (override !== undefined) {
    dataRoot = join(assertAbsolute("COWORK_GHC_RUNTIME_ROOT", override), "data");
  } else if (input.isPackaged) {
    const localAppData = trimmed(input.localAppData);
    if (localAppData === undefined) {
      throw new CoworkDataPathError(
        "LOCALAPPDATA is unavailable. Cowork GHC cannot place the packaged database. " +
          "Set LOCALAPPDATA or COWORK_GHC_RUNTIME_ROOT to an absolute writable path.",
      );
    }
    dataRoot = join(assertAbsolute("LOCALAPPDATA", localAppData), "Cowork GHC", "data");
  } else {
    const repoRoot = assertAbsolute("repoRoot", input.repoRoot);
    dataRoot = join(repoRoot, ".runtime", "data");
  }

  const backupRoot = join(dataRoot, "backups");
  const databasePath = join(dataRoot, "cowork-ghc.db");

  if (input.ensureDirectories !== false) {
    mkdirSync(backupRoot, { recursive: true });
  }

  return { dataRoot, databasePath, backupRoot };
}
