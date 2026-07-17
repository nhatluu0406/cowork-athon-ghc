/**
 * Public option/spec types for the OpenCode supervisor (CGHC-028 Wave A1), split from
 * `supervisor.ts` to keep that file focused on the lifecycle state machine.
 */

import type { ProviderKeyInjection } from "@cowork-ghc/runtime";
import type { CredentialInjectionRequest } from "../credential/inject.js";
import type { ChildSpawner } from "./child-spawner.js";
import type { HealthProbe, PortChecker, ProcessTimesProbe } from "./probes.js";
import type { OpencodeProviderConfig } from "./opencode-config.js";

/** Resolve credential handles to child-env injections (env only; the sole point a key leaves the store). */
export type ResolveInjections = (
  requests: readonly CredentialInjectionRequest[],
) => Promise<readonly ProviderKeyInjection[]>;

/** Everything the supervisor needs to launch one child. */
export interface SupervisorStartSpec {
  readonly binPath: string;
  readonly cwd: string;
  readonly host?: string;
  readonly port: number;
  readonly dataHome: string;
  readonly configDir: string;
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  /**
   * Extra plaintext secret VALUES already baked into `baseEnv` (e.g. a scoped MS365 tool token)
   * that must ALSO be masked in the log-safe spawn snapshot — one source of truth with
   * `redactedEnvSnapshot`'s value-equality redaction (see `@cowork-ghc/runtime`).
   */
  readonly extraSecretValues?: readonly string[];
  readonly healthTimeoutMs?: number;
  /** Credential handles resolved to child-env injections at launch (never persisted). */
  readonly injectionRequests: readonly CredentialInjectionRequest[];
  /** Non-secret `opencode.json` provider config; required for a custom OpenAI-compatible endpoint. */
  readonly providerConfig?: OpencodeProviderConfig;
  /** Absolute Skill-root directories to pass to OpenCode's native Skills launch (1.18 array form). */
  readonly skillsPaths?: readonly string[];
  /** Enabled Skill ids; when present, replaces the blanket `skill: allow` policy with an allowlist. */
  readonly skillAllow?: readonly string[];
}

export interface OpencodeSupervisorOptions {
  /** Project root under which `.runtime/pids/agent-runtime.json` is written. */
  readonly root: string;
  readonly resolveInjections: ResolveInjections;
  readonly spawner?: ChildSpawner;
  readonly healthProbe?: HealthProbe;
  readonly processTimesProbe?: ProcessTimesProbe;
  readonly portChecker?: PortChecker;
  /** Secret-free audit sink (lines are already redacted). */
  readonly log?: (line: string) => void;
  readonly pollIntervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}
