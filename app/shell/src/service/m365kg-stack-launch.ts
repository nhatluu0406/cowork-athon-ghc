/**
 * M365KG stack launch orchestration for the Electron main process (ADR 0010).
 *
 * Deliberately NOT wired into the main Cowork/OpenCode `ServiceController` — the M365 Knowledge
 * Graph is an additive, optional feature. A failure here must never block the primary desktop
 * chat experience. `start()` therefore never rejects: every failure is logged and treated as
 * "M365KG unavailable this run".
 *
 * `start()` degrades honestly when:
 * - Stack binaries are not yet extracted under `paths.stackRoot` (not provisioned) → skip
 * - Claude API key is absent → llm-svc starts but cloud LLM calls fail; local ONNX is used
 */

import { join } from "node:path";
import {
  M365KGStackInitializer,
  M365KGStackSupervisor,
  isAlreadyProvisioned,
  type StackSupervisorSecrets,
} from "@cowork-ghc/service/knowledge/stack";
import { loadOrCreateM365KGStackSecrets } from "./m365kg-stack-secrets.js";
import type { M365KGStackPaths } from "./m365kg-stack-paths.js";

/** The 5 components extracted under `<stackRoot>/<component>/` (ADR 0010). */
const STACK_COMPONENT_DIRS = ["postgresql", "neo4j", "jre", "llm-svc", "backend"] as const;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function defaultIsProvisioned(stackRoot: string): Promise<boolean> {
  for (const component of STACK_COMPONENT_DIRS) {
    if (!(await isAlreadyProvisioned(join(stackRoot, component)))) return false;
  }
  return true;
}

export interface M365KGStackLaunch {
  /** Idempotent: a second call while already started (or starting) is a no-op. Never rejects. */
  start(): Promise<void>;
  /** Idempotent: a call with nothing running is a no-op. */
  stop(): Promise<void>;
}

export interface M365KGStackLaunchOptions {
  readonly paths: M365KGStackPaths;
  readonly log?: (line: string) => void;
  /** Test seam — default checks every entry of STACK_COMPONENT_DIRS under `stackRoot`. */
  readonly isProvisioned?: (stackRoot: string) => Promise<boolean>;
  /** Test seam — default loads/generates machine secrets under `paths.runtimeRoot`. */
  readonly loadSecrets?: () => Promise<StackSupervisorSecrets>;
  /** Test seam — default a real `M365KGStackInitializer`. */
  readonly createInitializer?: () => M365KGStackInitializer;
  /** Test seam — default a real `M365KGStackSupervisor` bound to `paths`/`secrets`. */
  readonly createSupervisor?: (secrets: StackSupervisorSecrets) => M365KGStackSupervisor;
  /**
   * Read the Claude API key and embedding settings from vault/env at launch time.
   * Returns undefined if not configured — llm-svc degrades to local ONNX for embeddings.
   */
  readonly resolveClaude?: () => Promise<{
    apiKey: string;
    baseUrl?: string;
    embeddingMode?: "cloud" | "local";
    embeddingModelId?: string;
  } | undefined>;
}

export function createM365KGStackLaunch(options: M365KGStackLaunchOptions): M365KGStackLaunch {
  const { paths } = options;
  const log = options.log ?? ((): void => {});
  const isProvisioned = options.isProvisioned ?? defaultIsProvisioned;
  const loadSecrets =
    options.loadSecrets ??
    ((): Promise<StackSupervisorSecrets> =>
      loadOrCreateM365KGStackSecrets({ runtimeRoot: paths.runtimeRoot }).then((m) => ({
        pgPassword: m.pgPassword,
        jwtSecret: m.jwtSecret,
      })));
  const createInitializer =
    options.createInitializer ??
    ((): M365KGStackInitializer =>
      new M365KGStackInitializer({ log, migrationsDir: paths.migrationsDir }));
  const createSupervisor =
    options.createSupervisor ??
    ((secrets: StackSupervisorSecrets): M365KGStackSupervisor =>
      new M365KGStackSupervisor({ root: paths.runtimeRoot, paths: paths.stack, secrets, log }));

  let supervisor: M365KGStackSupervisor | null = null;
  let startPromise: Promise<void> | null = null;

  async function runStart(): Promise<void> {
    try {
      if (!(await isProvisioned(paths.stackRoot))) {
        log("m365kg_stack_skip_not_provisioned");
        return;
      }
      const machineSecrets = await loadSecrets();
      const claude = options.resolveClaude ? await options.resolveClaude() : undefined;
      const secrets: StackSupervisorSecrets = {
        ...machineSecrets,
        ...(claude !== undefined
          ? {
              claudeApiKey: claude.apiKey,
              claudeBaseUrl: claude.baseUrl,
              ...(claude.embeddingMode !== undefined ? { embeddingMode: claude.embeddingMode } : {}),
              ...(claude.embeddingModelId !== undefined ? { embeddingModelId: claude.embeddingModelId } : {}),
            }
          : {}),
      };
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
      if (startPromise !== null) await startPromise.catch((): void => undefined);
      const sup = supervisor;
      supervisor = null;
      if (sup === null) return;
      await sup.stop().catch((err: unknown) => log(`m365kg_stack_stop_error: ${messageOf(err)}`));
    },
  };
}
