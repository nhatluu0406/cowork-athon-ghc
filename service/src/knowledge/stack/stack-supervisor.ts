/**
 * M365KGStackSupervisor — the ONE owner of the 4 bundled M365KG child processes (ADR 0010),
 * sitting alongside (not inside) the existing OpenCode supervision tree (ADR 0004). Composes 4
 * {@link GenericChildSupervisor} instances and sequences them by real dependency order: Postgres,
 * Neo4j, and `llm-svc` have no dependency on each other and start concurrently; the backend
 * depends on all three and starts only once they're ready. Stop order is the exact reverse.
 *
 * NOT YET RUN AGAINST REAL WINDOWS BINARIES — see `stack-roles.ts`'s header. This class's
 * sequencing/composition logic IS unit-tested (against fakes); the real Postgres/Neo4j/backend/
 * llm-svc launch specs it feeds to each supervisor are not yet execution-verified.
 */

import net from "node:net";
import type { RuntimeProcessIdentity } from "@cowork-ghc/runtime";
import { GenericChildSupervisor, type GenericChildSupervisorOptions } from "../../runtime/generic-child-supervisor.js";
import { GenericChildAlreadyStartedError } from "../../runtime/generic-supervisor-errors.js";
import { backendRole, llmSvcRole, neo4jRole, postgresRole, type StackPaths, type StackPorts } from "./stack-roles.js";

const STACK_ROLE = "m365kg-stack" as const;

export interface StackSupervisorSecrets {
  readonly pgPassword: string;
  readonly jwtSecret: string;
}

export interface StackSupervisorOptions {
  readonly root: string;
  readonly paths: StackPaths;
  readonly secrets: StackSupervisorSecrets;
  /** Overrides port auto-selection — tests only; production lets each port be picked free. */
  readonly ports?: StackPorts;
  readonly log?: (line: string) => void;
  /** Per-role supervisor overrides (spawner/probes) — tests only. */
  readonly supervisorOptionsOverride?: Partial<GenericChildSupervisorOptions>;
  /** Overrides every role's ready-wait bound — tests only; production keeps each role's default. */
  readonly readyTimeoutMs?: number;
}

export interface StackIdentities {
  readonly postgres: RuntimeProcessIdentity;
  readonly neo4j: RuntimeProcessIdentity;
  readonly llmSvc: RuntimeProcessIdentity;
  readonly backend: RuntimeProcessIdentity;
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function resolvePorts(override: StackPorts | undefined): Promise<StackPorts> {
  if (override) return override;
  return {
    postgres: await pickFreePort(),
    neo4jBolt: await pickFreePort(),
    llmSvc: await pickFreePort(),
    backend: await pickFreePort(),
  };
}

export class M365KGStackSupervisor {
  private readonly opts: StackSupervisorOptions;
  private readonly log: (line: string) => void;
  private postgres: GenericChildSupervisor | null = null;
  private neo4j: GenericChildSupervisor | null = null;
  private llmSvc: GenericChildSupervisor | null = null;
  private backend: GenericChildSupervisor | null = null;
  private started = false;

  constructor(options: StackSupervisorOptions) {
    this.opts = options;
    this.log = options.log ?? (() => {});
  }

  isAlive(): boolean {
    return (
      (this.postgres?.isAlive() ?? false) &&
      (this.neo4j?.isAlive() ?? false) &&
      (this.llmSvc?.isAlive() ?? false) &&
      (this.backend?.isAlive() ?? false)
    );
  }

  private newSupervisor(readinessProbe: GenericChildSupervisorOptions["readinessProbe"]): GenericChildSupervisor {
    return new GenericChildSupervisor({
      root: this.opts.root,
      readinessProbe,
      log: this.log,
      ...this.opts.supervisorOptionsOverride,
    });
  }

  async start(): Promise<StackIdentities> {
    if (this.started) throw new GenericChildAlreadyStartedError(STACK_ROLE);
    this.started = true;
    const ports = await resolvePorts(this.opts.ports);
    const { paths, secrets } = this.opts;

    this.log(`m365kg_stack_start ports=${JSON.stringify(ports)}`);

    const pg = postgresRole(paths, ports, secrets.pgPassword);
    const neo = neo4jRole(paths, ports);
    const llm = llmSvcRole(paths, ports);

    this.postgres = this.newSupervisor(pg.readinessProbe);
    this.neo4j = this.newSupervisor(neo.readinessProbe);
    this.llmSvc = this.newSupervisor(llm.readinessProbe);

    const readyTimeoutOverride = this.opts.readyTimeoutMs !== undefined ? { readyTimeoutMs: this.opts.readyTimeoutMs } : {};
    try {
      // Postgres, Neo4j, llm-svc are mutually independent — start concurrently.
      const [postgresIdentity, neo4jIdentity, llmSvcIdentity] = await Promise.all([
        this.postgres.start({ ...pg.spec, ...readyTimeoutOverride }),
        this.neo4j.start({ ...neo.spec, ...readyTimeoutOverride }),
        this.llmSvc.start({ ...llm.spec, ...readyTimeoutOverride }),
      ]);

      // The backend depends on all three being reachable — start only after they're ready.
      const be = backendRole(paths, ports, secrets);
      this.backend = this.newSupervisor(be.readinessProbe);
      const backendIdentity = await this.backend.start({ ...be.spec, ...readyTimeoutOverride });

      this.log("m365kg_stack_ready");
      return { postgres: postgresIdentity, neo4j: neo4jIdentity, llmSvc: llmSvcIdentity, backend: backendIdentity };
    } catch (err) {
      // Partial failure — never leave orphaned siblings running (one-owner invariant, ADR 0004).
      await this.stop();
      throw err;
    }
  }

  /** Reverse dependency order: backend first (it depends on the other three), then the leaves. */
  async stop(): Promise<void> {
    await this.backend?.stop();
    await Promise.all([this.postgres?.stop(), this.neo4j?.stop(), this.llmSvc?.stop()]);
    this.postgres = null;
    this.neo4j = null;
    this.llmSvc = null;
    this.backend = null;
    this.started = false;
    this.log("m365kg_stack_stopped");
  }
}
