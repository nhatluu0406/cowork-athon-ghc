/**
 * M365KG stack launch orchestration for the Electron main process (ADR 0010) —
 * the shell-side counterpart to `M365KGStackInitializer`/`M365KGStackSupervisor`
 * (`@cowork-ghc/service/knowledge/stack`), which own the actual init/start/stop logic but know
 * nothing about Electron paths or this app's honest-degrade policy.
 *
 * Deliberately NOT wired into the main Cowork/OpenCode `ServiceController` — the M365 Knowledge
 * Graph is an additive, optional feature (see `docs/architecture/decisions/0010-m365kg-stack-
 * bundling.md`), so a failure here must never block the primary desktop chat experience from
 * starting. `start()` therefore never rejects: every failure is logged and treated as "M365KG
 * unavailable this run", same spirit as `service-controller.ts`'s "honest `not_connected`, never
 * a crash" invariant.
 *
 * On a packaged build, `start()` also handles EXTRACTION: it extracts the bundled vendor ZIPs
 * (`postgresql.zip`, `neo4j.zip`, `jre.zip`) from `paths.vendorRoot` and copies the pre-compiled
 * binaries (llm-svc.exe, m365-knowledge-graph.exe) from `paths.binaryRoots` into `paths.stackRoot`
 * on first launch — after which the `M365KGStackInitializer` runs its one-time DB init, and
 * `M365KGStackSupervisor` takes over for all subsequent starts. Dev mode (where vendorRoot/
 * binaryRoots are null) degrades honestly to "skip_not_provisioned" as before.
 */

import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  M365KGStackInitializer,
  M365KGStackSupervisor,
  isAlreadyProvisioned,
  type StackSupervisorSecrets,
} from "@cowork-ghc/service/knowledge/stack";
import type { M365KGStackPaths } from "./m365kg-stack-paths.js";
import { loadOrCreateM365KGStackSecrets } from "./m365kg-stack-secrets.js";

/** The 5 components `provisioning.ts` extracts under `<stackRoot>/<component>/` (ADR 0010). */
const STACK_COMPONENT_DIRS = ["postgresql", "neo4j", "jre", "llm-svc", "backend"] as const;

export interface M365KGStackLaunch {
  /** Idempotent: a second call while already started (or starting) is a no-op. Never rejects. */
  start(): Promise<void>;
  /** Idempotent: a call with nothing running is a no-op. */
  stop(): Promise<void>;
}

export interface M365KGStackLaunchOptions {
  readonly paths: M365KGStackPaths;
  readonly log?: (line: string) => void;
  /** Test seam — default checks every entry of {@link STACK_COMPONENT_DIRS} under `stackRoot`. */
  readonly isProvisioned?: (stackRoot: string) => Promise<boolean>;
  /** Test seam — default persists generated secrets under `paths.runtimeRoot`. */
  readonly loadSecrets?: () => Promise<StackSupervisorSecrets>;
  /** Test seam — default a real {@link M365KGStackInitializer}. */
  readonly createInitializer?: () => M365KGStackInitializer;
  /** Test seam — default a real {@link M365KGStackSupervisor} bound to `paths`/`secrets`. */
  readonly createSupervisor?: (secrets: StackSupervisorSecrets) => M365KGStackSupervisor;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function defaultIsProvisioned(stackRoot: string): Promise<boolean> {
  for (const component of STACK_COMPONENT_DIRS) {
    if (!(await isAlreadyProvisioned(join(stackRoot, component)))) return false;
  }
  return true;
}

/**
 * Extract a single ZIP using Windows' built-in `Expand-Archive` (PowerShell). The ZIP is
 * extracted into a temporary directory; if the ZIP has a single top-level subdirectory it is
 * moved to `destDir` directly (EDB/Neo4j/Temurin all ship this way). Never touches `destDir`
 * if already provisioned.
 */
async function extractZipToDir(zipPath: string, destDir: string, log: (s: string) => void): Promise<void> {
  if (await isAlreadyProvisioned(destDir)) return;
  const tmpDest = join(tmpdir(), `cghc-m365kg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  log(`m365kg_extract_zip: ${zipPath} → ${destDir}`);
  try {
    await mkdir(tmpDest, { recursive: true });
    // Escape single quotes for PowerShell
    const esc = (s: string) => s.replace(/'/g, "''");
    const script = `Expand-Archive -LiteralPath '${esc(zipPath)}' -DestinationPath '${esc(tmpDest)}' -Force`;
    await new Promise<void>((resolve, reject) => {
      execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 10 * 60_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    const entries = await readdir(tmpDest);
    await mkdir(destDir, { recursive: true });
    if (entries.length === 1 && entries[0] !== undefined) {
      // Single top-level dir — lift it up so destDir becomes the content root.
      const inner = join(tmpDest, entries[0]);
      const innerStat = await (await import("node:fs/promises")).stat(inner).catch(() => null);
      if (innerStat?.isDirectory()) {
        const innerEntries = await readdir(inner);
        for (const entry of innerEntries) {
          await rename(join(inner, entry), join(destDir, entry));
        }
        await rm(tmpDest, { recursive: true, force: true });
        return;
      }
    }
    // Fallback: move all top-level entries.
    for (const entry of entries) {
      await rename(join(tmpDest, entry), join(destDir, entry));
    }
  } finally {
    await rm(tmpDest, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * On a packaged build: extract the three bundled ZIPs and copy the two pre-compiled binaries
 * into `stackRoot` so `M365KGStackSupervisor` can launch them. Each step is idempotent
 * (skipped if the target directory is already non-empty). Never called in dev mode.
 */
async function extractBundledComponents(paths: M365KGStackPaths, log: (s: string) => void): Promise<void> {
  const { vendorRoot, binaryRoots, stackRoot } = paths;
  if (vendorRoot === null || binaryRoots === null) return;

  await mkdir(stackRoot, { recursive: true });

  // Extract vendor ZIPs (each has a single top-level dir inside that maps to the component name).
  const zipExtraction = [
    { zip: "postgresql.zip", dest: "postgresql" },
    { zip: "neo4j.zip", dest: "neo4j" },
    { zip: "jre.zip", dest: "jre" },
  ];
  for (const { zip, dest } of zipExtraction) {
    await extractZipToDir(join(vendorRoot, zip), join(stackRoot, dest), log);
  }

  // Copy pre-compiled binaries (llm-svc.exe, m365-knowledge-graph.exe) into their component dirs.
  const binaryCopies = [
    { src: join(binaryRoots.llmSvc, "llm-svc.exe"), destDir: join(stackRoot, "llm-svc") },
    { src: join(binaryRoots.backend, "m365-knowledge-graph.exe"), destDir: join(stackRoot, "backend") },
  ];
  for (const { src, destDir } of binaryCopies) {
    if (await isAlreadyProvisioned(destDir)) continue;
    await mkdir(destDir, { recursive: true });
    const destFile = join(destDir, src.split("\\").pop() ?? src.split("/").pop() ?? "binary.exe");
    log(`m365kg_copy_binary: ${src} → ${destFile}`);
    await copyFile(src, destFile);
  }
}

export function createM365KGStackLaunch(options: M365KGStackLaunchOptions): M365KGStackLaunch {
  const { paths } = options;
  const log = options.log ?? (() => {});
  const isProvisioned = options.isProvisioned ?? defaultIsProvisioned;
  const loadSecrets = options.loadSecrets ?? (() => loadOrCreateM365KGStackSecrets({ runtimeRoot: paths.runtimeRoot }));
  const createInitializer = options.createInitializer ?? (() => new M365KGStackInitializer({ log, migrationsDir: paths.migrationsDir }));
  const createSupervisor =
    options.createSupervisor ?? ((secrets: StackSupervisorSecrets) => new M365KGStackSupervisor({ root: paths.runtimeRoot, paths: paths.stack, secrets, log }));

  let supervisor: M365KGStackSupervisor | null = null;
  let startPromise: Promise<void> | null = null;

  async function runStart(): Promise<void> {
    try {
      // On a packaged build, extract bundled vendor ZIPs + binaries into stackRoot first.
      // This is idempotent (skips already-extracted components) and is a no-op in dev mode.
      if (paths.vendorRoot !== null) {
        log("m365kg_stack_extracting_bundled");
        await extractBundledComponents(paths, log);
        log("m365kg_stack_extraction_done");
      }
      if (!(await isProvisioned(paths.stackRoot))) {
        log("m365kg_stack_skip_not_provisioned");
        return;
      }
      const secrets = await loadSecrets();
      const initializer = createInitializer();
      if (!(await initializer.isInitialized(paths.runtimeRoot))) {
        log("m365kg_stack_first_launch_initializing");
        await initializer.initialize(paths.stack, secrets, paths.runtimeRoot);
        log("m365kg_stack_initialized");
      }
      const sup = createSupervisor(secrets);
      await sup.start();
      supervisor = sup;
      log("m365kg_stack_started");
    } catch (err) {
      // Honest degrade: M365KG is additive — never let its failure surface as a shell crash.
      log(`m365kg_stack_start_failed: ${messageOf(err)}`);
    }
  }

  return {
    async start(): Promise<void> {
      if (supervisor !== null) return;
      if (startPromise !== null) return startPromise;
      const run = runStart();
      startPromise = run;
      try {
        await run;
      } finally {
        startPromise = null;
      }
    },
    async stop(): Promise<void> {
      if (startPromise !== null) await startPromise.catch(() => undefined);
      const sup = supervisor;
      supervisor = null;
      if (sup === null) return;
      await sup.stop().catch((err) => log(`m365kg_stack_stop_error: ${messageOf(err)}`));
    },
  };
}
