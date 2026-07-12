/**
 * OpenCode launch/config glue (ADR 0001 §1/§4, design §6/§8).
 *
 * Responsibilities (and ONLY these):
 *  - Build the `opencode serve` spawn command/args with an argument array (never a
 *    shell string) so workspace paths with spaces/Unicode are safe.
 *  - Enforce per-run DATA ISOLATION via child env `XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR`.
 *    OpenCode has NO `--data-dir` flag (confirmed: the reference's `--data-dir` belongs to
 *    `openwork-orchestrator daemon run`, `runtime.mjs:1326`, not to `opencode`; OpenCode data
 *    location is env-driven — `opencode-db.ts:50-57` reads `XDG_DATA_HOME`).
 *  - Inject resolved provider keys as env vars into the child spawn ONLY. This module
 *    NEVER writes `auth.json`/`env.json` and never persists a key to disk (SEC-1).
 *
 * Credential RESOLUTION (Windows Credential Manager) is ADR 0006 / service-owned; this
 * module receives already-resolved `{ envVar, value }` injections at the boundary.
 */

import type { ProviderEnvSpec } from "./provider-env.js";
import { isValidEnvName } from "./env-name.js";
import { redactEnvMapValues } from "./redact.js";

/** A resolved provider credential ready to inject as a child env var. */
export interface ProviderKeyInjection {
  readonly envVar: string;
  readonly value: string;
}

export interface BuildLaunchSpecOptions {
  /** Absolute path to the pinned OpenCode binary. */
  readonly binPath: string;
  /** Workspace root the runtime runs in (cwd). */
  readonly cwd: string;
  /** Loopback host to bind. MUST be a loopback address (default 127.0.0.1). */
  readonly host?: string;
  /** Port to bind. Must be an allocated free port. */
  readonly port: number;
  /** Per-run data dir → `XDG_DATA_HOME` (OpenCode stores its SQLite under it). */
  readonly dataHome: string;
  /** Per-run config dir → `OPENCODE_CONFIG_DIR`. */
  readonly configDir: string;
  /** Resolved provider key injections (env-var name + plaintext value). */
  readonly providerKeys?: readonly ProviderKeyInjection[];
  /**
   * Base env layered under the isolation/injection env. Defaults to the FULL
   * `process.env` for convenience, but the Local Service SHOULD pass a curated
   * allowlist (e.g. PATH, SystemRoot, TEMP, ProgramData) instead of inheriting the
   * whole parent environment, to keep the child's env surface minimal.
   */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
}

/**
 * A fully-resolved, spawn-ready launch specification.
 *
 * SECURITY: `env` and `secretValues` carry PLAINTEXT provider keys. They must NEVER
 * be logged, serialized to diagnostics, or sent to the frontend. Only
 * {@link redactedEnvSnapshot} produces a log-safe view.
 */
export interface RuntimeLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly host: string;
  readonly port: number;
  readonly dataHome: string;
  readonly configDir: string;
  /** PLAINTEXT child env (isolation + injected provider keys). Never log this. */
  readonly env: Record<string, string>;
  /** PLAINTEXT secret values injected (for value-based redaction). Never log this. */
  readonly secretValues: readonly string[];
}

const DEFAULT_HOST = "127.0.0.1";
/** Hosts accepted for the runtime bind — loopback only (loopback-only invariant). */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Error raised when a non-loopback host is requested for the runtime bind. */
export class NonLoopbackHostError extends Error {
  readonly host: string;
  constructor(host: string) {
    super(`Runtime host must be loopback (127.0.0.1, ::1, localhost); got ${JSON.stringify(host)}`);
    this.name = "NonLoopbackHostError";
    this.host = host;
  }
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid runtime port: ${String(port)}`);
  }
}

function resolveLoopbackHost(host: string | undefined): string {
  const resolved = host?.trim() || DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.has(resolved)) throw new NonLoopbackHostError(resolved);
  return resolved;
}

function buildEnv(
  options: BuildLaunchSpecOptions,
  injections: readonly ProviderKeyInjection[],
): Record<string, string> {
  const base = options.baseEnv ?? process.env;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") env[key] = value;
  }
  // Per-run data isolation (OpenCode has no --data-dir flag).
  env["XDG_DATA_HOME"] = options.dataHome;
  env["OPENCODE_CONFIG_DIR"] = options.configDir;
  // Provider key injection (env only; never written to disk).
  for (const injection of injections) {
    env[injection.envVar] = injection.value;
  }
  return env;
}

/**
 * Build a deterministic, spawn-ready {@link RuntimeLaunchSpec}. Pure: it performs no
 * I/O and does not spawn — the caller (supervisor) creates the directories and spawns.
 */
export function buildLaunchSpec(options: BuildLaunchSpecOptions): RuntimeLaunchSpec {
  assertPort(options.port);
  if (!options.binPath.trim()) throw new Error("binPath must be a non-empty string");
  if (!options.dataHome.trim()) throw new Error("dataHome must be a non-empty string");
  if (!options.configDir.trim()) throw new Error("configDir must be a non-empty string");

  const injections = options.providerKeys ?? [];
  for (const injection of injections) {
    if (!isValidEnvName(injection.envVar)) {
      throw new Error(`Invalid provider env var name: ${JSON.stringify(injection.envVar)}`);
    }
  }

  const host = resolveLoopbackHost(options.host);
  const args = ["serve", "--hostname", host, "--port", String(options.port)] as const;
  const secretValues = injections.map((injection) => injection.value).filter((v) => v.length > 0);

  return {
    command: options.binPath,
    args,
    cwd: options.cwd,
    host,
    port: options.port,
    dataHome: options.dataHome,
    configDir: options.configDir,
    env: buildEnv(options, injections),
    secretValues,
  };
}

/** Convenience: build a `{ envVar, value }` injection from a provider env spec. */
export function injectionFor(spec: ProviderEnvSpec, value: string): ProviderKeyInjection {
  return { envVar: spec.primaryEnvVar, value };
}

/**
 * Produce a redacted copy of a spec's env (secret VALUES replaced) that is safe to log.
 * The runtime never logs the raw env.
 */
export function redactedEnvSnapshot(spec: RuntimeLaunchSpec): Record<string, string> {
  return redactEnvMapValues(spec.env, spec.secretValues);
}
