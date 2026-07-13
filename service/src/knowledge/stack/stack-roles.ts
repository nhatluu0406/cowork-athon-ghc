/**
 * Per-role launch configuration for the 4 bundled M365KG stack processes (ADR 0010). Each role
 * maps to one {@link GenericChildSupervisor}. Paths assume `provisioning.ts` already extracted
 * each component under `<stackRoot>/<component>/`.
 *
 * NOT YET RUN AGAINST REAL WINDOWS BINARIES — this module was authored and unit-testable-shaped
 * without Windows/Postgres/Neo4j access (see the session's final report). The exact `bin/`
 * subpaths and CLI flags below match each project's documented Windows zip layout, but have not
 * been exercised against a real extracted zip. Treat as a strong first draft, not verified.
 */

import { join } from "node:path";
import type { GenericStartSpec } from "../../runtime/generic-child-supervisor.js";
import { httpOkProbe, tcpConnectProbe, type ReadinessProbe } from "../../runtime/generic-readiness.js";

export const M365KG_STACK_PPID_ROLE = "m365kg-stack-supervisor" as const;

export interface StackPaths {
  /** Root dir everything is extracted under (e.g. `<userData>/m365kg-stack/`). */
  readonly stackRoot: string;
  /** Where Postgres keeps its cluster data (separate from the binaries themselves). */
  readonly pgDataDir: string;
}

export interface StackPorts {
  readonly postgres: number;
  readonly neo4jBolt: number;
  readonly llmSvc: number;
  readonly backend: number;
}

export interface RoleDefinition {
  readonly spec: Omit<GenericStartSpec, "readyTimeoutMs">;
  readonly readinessProbe: ReadinessProbe;
}

const HOST = "127.0.0.1";

export function postgresRole(paths: StackPaths, ports: StackPorts, password: string): RoleDefinition {
  const bin = join(paths.stackRoot, "postgresql", "bin", "postgres.exe");
  return {
    spec: {
      role: "m365kg-postgres",
      ppidRole: M365KG_STACK_PPID_ROLE,
      command: bin,
      args: ["-D", paths.pgDataDir, "-p", String(ports.postgres), "-c", "listen_addresses=localhost"],
      cwd: join(paths.stackRoot, "postgresql", "bin"),
      ensureDirs: [paths.pgDataDir],
      env: { PGPASSWORD: password },
      host: HOST,
      port: ports.postgres,
    },
    // TCP-connect only (no bundled pg_isready invocation yet) — see file header.
    readinessProbe: tcpConnectProbe(),
  };
}

export function neo4jRole(paths: StackPaths, ports: StackPorts): RoleDefinition {
  const bin = join(paths.stackRoot, "neo4j", "bin", "neo4j.bat");
  return {
    spec: {
      role: "m365kg-neo4j",
      ppidRole: M365KG_STACK_PPID_ROLE,
      command: bin,
      args: ["console"], // foreground mode — required so OUR spawn captures the real running pid
      cwd: join(paths.stackRoot, "neo4j", "bin"),
      env: {
        JAVA_HOME: join(paths.stackRoot, "jre"),
        NEO4J_server_bolt_listen__address: `${HOST}:${ports.neo4jBolt}`,
      },
      host: HOST,
      port: ports.neo4jBolt,
    },
    readinessProbe: tcpConnectProbe(),
  };
}

export function llmSvcRole(paths: StackPaths, ports: StackPorts): RoleDefinition {
  const bin = join(paths.stackRoot, "llm-svc", "llm-svc.exe");
  return {
    spec: {
      role: "m365kg-llmsvc",
      ppidRole: M365KG_STACK_PPID_ROLE,
      command: bin,
      args: [],
      cwd: join(paths.stackRoot, "llm-svc"),
      env: { LLMSVC_ADDR: `${HOST}:${ports.llmSvc}` },
      host: HOST,
      port: ports.llmSvc,
    },
    readinessProbe: tcpConnectProbe(),
  };
}

export function backendRole(paths: StackPaths, ports: StackPorts, secrets: { jwtSecret: string; pgPassword: string }): RoleDefinition {
  const bin = join(paths.stackRoot, "backend", "m365-knowledge-graph.exe");
  return {
    spec: {
      role: "m365kg-backend",
      ppidRole: M365KG_STACK_PPID_ROLE,
      command: bin,
      args: [],
      cwd: join(paths.stackRoot, "backend"),
      env: {
        HOST,
        PORT: String(ports.backend),
        DATABASE_URL: `postgres://m365kg:${secrets.pgPassword}@${HOST}:${ports.postgres}/m365kg?sslmode=disable`,
        NEO4J_URI: `bolt://${HOST}:${ports.neo4jBolt}`,
        NEO4J_USERNAME: "neo4j",
        LLMSVC_ADDR: `${HOST}:${ports.llmSvc}`,
        JWT_SECRET: secrets.jwtSecret,
        ALLOWED_ORIGINS: "", // no browser origin needs access; Cowork talks to it server-side only
      },
      host: HOST,
      port: ports.backend,
    },
    readinessProbe: httpOkProbe("/health"),
  };
}
