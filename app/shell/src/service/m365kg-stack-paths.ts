/**
 * Run-mode-aware path resolution for the bundled M365KG stack (ADR 0010 remaining work), mirroring
 * `packaged-paths.ts`'s OpenCode resolver exactly: PACKAGED installs are read-only, so every
 * writable path (the Postgres cluster, the `.runtime/` init marker) goes under `userData`; the
 * migrations shipped with THIS app (not downloaded) go under the read-only `resourcesPath`
 * (declared as `extraResources` in `electron-builder.yml`).
 *
 * Pure + injectable (no `electron` import) so it is unit-testable; `main.ts` feeds it the real
 * `app.isPackaged` / `process.resourcesPath` / `app.getPath("userData")` values, same as
 * `packaged-paths.ts`.
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
  /** Where the Postgres/Neo4j/JRE/llm-svc/backend binaries would be extracted to. */
  readonly stackRoot: string;
  /** `*.sql` (skip `*.down.sql`) + `*.cypher` migration files applied once by the initializer. */
  readonly migrationsDir: string;
  /** Writable root for `.runtime/m365kg-init.done` + `.runtime/m365kg-secrets.json`. */
  readonly runtimeRoot: string;
}

/** Resolve every M365KG stack path for the current run mode. */
export function resolveM365KGStackPaths(input: M365KGStackPathsInput): M365KGStackPaths {
  const runtimeRoot = input.isPackaged ? input.userData : input.devAppRoot;
  const stackRoot = input.isPackaged ? join(input.userData, "m365kg-stack") : join(input.devAppRoot, ".runtime", "m365kg-stack");
  const migrationsDir = input.isPackaged
    ? join(input.resourcesPath, "m365kg-migrations")
    : join(input.devAppRoot, "app", "backend", "migrations");

  return {
    stack: { stackRoot, pgDataDir: join(stackRoot, "pgdata") },
    stackRoot,
    migrationsDir,
    runtimeRoot,
  };
}
