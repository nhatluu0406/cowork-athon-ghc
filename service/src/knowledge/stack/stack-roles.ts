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
  /**
   * Read-only binary root — contains `postgresql/`, `neo4j/`, `jre/`, `llm-svc/`, `backend/`
   * subdirs. In a packaged build this is inside `resourcesPath` (the read-only resources dir).
   */
  readonly stackRoot: string;
  /** Writable Postgres cluster data dir (outside `stackRoot` in packaged builds). */
  readonly pgDataDir: string;
  /**
   * Writable Neo4j data root. When set, Neo4j's data/logs/run/import dirs are redirected here
   * so the read-only `stackRoot` inside `resourcesPath` is never written to. If absent, Neo4j
   * uses its installation-relative defaults (only safe when `stackRoot` is writable, e.g. dev).
   */
  readonly neo4jDataDir?: string;
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
  const neo4jDataDir = paths.neo4jDataDir;

  // When a writable data dir is provided (packaged builds, where the binary root is read-only),
  // redirect every Neo4j write target so it never tries to write into resourcesPath.
  const dataEnv: Record<string, string> =
    neo4jDataDir !== undefined
      ? {
          NEO4J_server_directories_data: join(neo4jDataDir, "data"),
          NEO4J_server_directories_logs: join(neo4jDataDir, "logs"),
          NEO4J_server_directories_run: join(neo4jDataDir, "run"),
          NEO4J_server_directories_import: join(neo4jDataDir, "import"),
        }
      : {};

  return {
    spec: {
      role: "m365kg-neo4j",
      ppidRole: M365KG_STACK_PPID_ROLE,
      command: bin,
      args: ["console"], // foreground mode — required so OUR spawn captures the real running pid
      cwd: join(paths.stackRoot, "neo4j", "bin"),
      ensureDirs: neo4jDataDir !== undefined
        ? [join(neo4jDataDir, "data"), join(neo4jDataDir, "logs"), join(neo4jDataDir, "run"), join(neo4jDataDir, "import")]
        : [],
      env: {
        JAVA_HOME: join(paths.stackRoot, "jre"),
        NEO4J_AUTH: "none", // no auth for embedded local-only instance
        NEO4J_server_bolt_listen__address: `${HOST}:${ports.neo4jBolt}`,
        ...dataEnv,
      },
      host: HOST,
      port: ports.neo4jBolt,
    },
    readinessProbe: tcpConnectProbe(),
  };
}

export function llmSvcRole(
  paths: StackPaths,
  ports: StackPorts,
  secrets: Pick<
    { claudeApiKey?: string; claudeBaseUrl?: string; embeddingMode?: "cloud" | "local"; embeddingModelId?: string },
    "claudeApiKey" | "claudeBaseUrl" | "embeddingMode" | "embeddingModelId"
  > = {},
): RoleDefinition {
  const bin = join(paths.stackRoot, "llm-svc", "llm-svc.exe");
  const embeddingMode = secrets.embeddingMode ?? "cloud";
  // NLP_MODE: 2 = prefer local ONNX embed, fall back to cloud. 1 = cloud only.
  const nlpMode = embeddingMode === "local" ? "2" : "1";
  // LLM_EMBED_MODEL: the model ID to use for embedding (cloud model name or local ONNX model name).
  const embedModelId = secrets.embeddingModelId ?? (embeddingMode === "local" ? "bge-m3-int8" : "text-embedding-3-small");
  return {
    spec: {
      role: "m365kg-llmsvc",
      ppidRole: M365KG_STACK_PPID_ROLE,
      command: bin,
      args: [],
      cwd: join(paths.stackRoot, "llm-svc"),
      env: {
        LLMSVC_ADDR: `${HOST}:${ports.llmSvc}`,
        LLM_PROVIDER: "anthropic",
        LLM_API_BASE_URL: secrets.claudeBaseUrl ?? "https://api.anthropic.com",
        LLM_API_KEY: secrets.claudeApiKey ?? "",
        LLM_MODEL: "claude-haiku-4-5-20251001",
        LLM_EMBED_MODEL: embedModelId,
        ANTHROPIC_API_KEY: secrets.claudeApiKey ?? "",
        NLP_MODE: nlpMode,
        // Load the BGE-M3 int8 ONNX model shipped alongside the binary; graceful fallback
        // to default_models() if the file is absent (e.g. fetch:model was not run).
        MODELS_YAML_PATH: join(paths.stackRoot, "llm-svc", "models.yaml"),
      },
      host: HOST,
      port: ports.llmSvc,
    },
    readinessProbe: tcpConnectProbe(),
  };
}

export function backendRole(
  paths: StackPaths,
  ports: StackPorts,
  secrets: { jwtSecret: string; pgPassword: string; embeddingModelId?: string },
): RoleDefinition {
  const bin = join(paths.stackRoot, "backend", "m365-knowledge-graph.exe");
  const embedModelId = secrets.embeddingModelId ?? "text-embedding-3-small";
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
        LLM_MODEL: "claude-haiku-4-5-20251001",
        LLM_EMBED_MODEL: embedModelId,
        ALLOWED_ORIGINS: "", // no browser origin needs access; Cowork talks to it server-side only
      },
      host: HOST,
      port: ports.backend,
    },
    readinessProbe: httpOkProbe("/health"),
  };
}
