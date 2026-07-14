/**
 * M365KG stack launch orchestration for the Electron main process (ADR 0010 remaining work) —
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
 * `start()` also degrades honestly when the stack binaries are not yet extracted under
 * `paths.stackRoot` (`provisioning.ts`'s download+extract flow is a separate, not-yet-wired
 * piece — out of scope for this task, see the ADR 0010 remaining-work spec's non-scope section)
 * rather than attempting to run `initdb`/`neo4j-admin` against binaries that do not exist.
 */

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
