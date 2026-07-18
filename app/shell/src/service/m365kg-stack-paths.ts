/**
 * Run-mode-aware path resolution for the bundled M365KG stack (ADR 0010).
 *
 * PACKAGED MODE (isPackaged = true):
 *   - Binary root (`stackRoot`): `resourcesPath/m365kg-stack/` — READ-ONLY. Contains the
 *     bundled postgresql/, neo4j/, jre/, llm-svc/, backend/ trees shipped via `extraResources`.
 *   - Writable data root: `userData/m365kg-data/` — WRITABLE. Postgres cluster and Neo4j data
 *     dirs live here so they are never written into the read-only resources directory.
 *   - Migrations: `resourcesPath/m365kg-migrations/` — READ-ONLY.
 *
 * DEV MODE (isPackaged = false):
 *   - All paths are under `.runtime/m365kg-stack/` (writable; excluded from git).
 *
 * Pure + injectable (no `electron` import) so it is unit-testable; `main.ts` feeds it the real
 * `app.isPackaged` / `process.resourcesPath` / `app.getPath("userData")` values.
 */

import { join } from "node:path";
import type { StackPaths } from "@cowork-ghc/service/knowledge/stack";

export interface M365KGStackPathsInput {
  /** `true` in a packaged build, `false` when running from the repo (dev). */
  readonly isPackaged: boolean;
  /** Electron `process.resourcesPath` (the packaged `resources/` dir). */
  readonly resourcesPath: string;
  /** Electron `app.getPath("userData")` — a per-user writable dir. */
  readonly userData: string;
  /** Repo/app root used in dev to locate `app/backend/migrations` and a dev stack root. */
  readonly devAppRoot: string;
}

export interface M365KGStackPaths {
  /** Feeds `M365KGStackSupervisor`/`M365KGStackInitializer` (`stackRoot` + `pgDataDir`). */
  readonly stack: StackPaths;
  /**
   * Root checked by `isAlreadyProvisioned` — i.e. where the component subdirs must exist.
   * In packaged builds this is the read-only `resourcesPath/m365kg-stack/` (the vendors live
   * there); in dev it is `.runtime/m365kg-stack/` (manually extracted or provisioned).
   */
  readonly stackRoot: string;
  /** `*.sql` + `*.cypher` migration files applied once by the initializer. */
  readonly migrationsDir: string;
  /** Writable root for `.runtime/m365kg-init.done` + `.runtime/m365kg-secrets.json`. */
  readonly runtimeRoot: string;
}

/** Resolve every M365KG stack path for the current run mode. */
export function resolveM365KGStackPaths(input: M365KGStackPathsInput): M365KGStackPaths {
  if (input.isPackaged) {
    // Packaged: binaries are read-only in resourcesPath; all writes go to userData.
    const stackRoot = join(input.resourcesPath, "m365kg-stack");
    const dataRoot = join(input.userData, "m365kg-data");
    const stack: StackPaths = {
      stackRoot,
      pgDataDir: join(dataRoot, "pgdata"),
      neo4jDataDir: join(dataRoot, "neo4j"),
    };
    return {
      stack,
      stackRoot,
      migrationsDir: join(input.resourcesPath, "m365kg-migrations"),
      runtimeRoot: input.userData,
    };
  }

  // Dev: everything under .runtime/m365kg-stack/ (writable).
  const stackRoot = join(input.devAppRoot, ".runtime", "m365kg-stack");
  const stack: StackPaths = {
    stackRoot,
    pgDataDir: join(stackRoot, "pgdata"),
    // No neo4jDataDir in dev — Neo4j uses its installation-relative defaults.
  };
  return {
    stack,
    stackRoot,
    migrationsDir: join(input.devAppRoot, "app", "backend", "migrations"),
    runtimeRoot: input.devAppRoot,
  };
}
