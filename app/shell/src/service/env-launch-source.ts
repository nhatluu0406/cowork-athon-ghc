/**
 * Production {@link LiveLaunchSource}: assemble a live-launch config from explicit launch env
 * (CGHC-028 Wave B2b).
 *
 * When `COWORK_WORKSPACE_ROOT` is unset, returns `null`. Secret values are never read here —
 * only non-secret credential account handles. Production uses the SQLite vault via `dbPath`.
 */

import { credential } from "@cowork-ghc/service";
import type { BuiltInProviderSelection, LiveProviderSelection } from "@cowork-ghc/service";

import type { LiveLaunchConfig, LiveLaunchSource } from "./live-launch-resolver.js";
import { peekRememberedUnlock, rememberUnlock } from "./session-unlock.js";

/** Typed, secret-free failure assembling the launch config from env. */
export class EnvLaunchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvLaunchConfigError";
  }
}

type Env = Record<string, string | undefined>;

export interface EnvLaunchSourceOptions {
  /** Env to read (default `process.env`). */
  readonly env?: Env;
  /** App install root used to default the pinned OpenCode binary path (dev only). */
  readonly appRoot?: string;
  readonly binPath?: string;
  readonly runtimeRoot?: string;
  /** Absolute conversation store — must match settings-only tier. */
  readonly conversationsDir?: string;
  readonly allowedOrigins?: readonly string[];
  readonly settingsFilePath?: string;
  /** Absolute path to the local SQLite database (ADR 0007). */
  readonly dbPath?: string;
  readonly skillsStateFilePath?: string;
  readonly skillRoots?: readonly {
    readonly path: string;
    readonly source: "built_in" | "user_local";
    readonly createIfMissing?: boolean;
  }[];
  /** Test-only: inject a credential store instead of the vault-owned default. */
  readonly makeCredentialStore?: () => Promise<credential.CredentialStore>;
}

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/** Parse a coherent provider selection from env, or throw a typed error when incomplete. */
function parseProvider(env: Env): LiveProviderSelection {
  const account = trimmed(env["COWORK_CREDENTIAL_ACCOUNT"]);
  if (!account) throw new EnvLaunchConfigError("COWORK_CREDENTIAL_ACCOUNT is required for a live launch.");
  const ref = credential.credentialRef(account);
  const kind = trimmed(env["COWORK_PROVIDER_KIND"]) ?? "built-in";

  if (kind === "built-in") {
    const providerId = trimmed(env["COWORK_PROVIDER_ID"]);
    if (!providerId) throw new EnvLaunchConfigError("COWORK_PROVIDER_ID is required for built-in providers.");
    return {
      kind: "built-in",
      providerId: providerId as BuiltInProviderSelection["providerId"],
      credentialRef: ref,
    };
  }
  if (kind === "custom") {
    const baseUrl = trimmed(env["COWORK_PROVIDER_BASE_URL"]);
    const model = trimmed(env["COWORK_PROVIDER_MODEL"]);
    const envVar = trimmed(env["COWORK_PROVIDER_ENV_VAR"]);
    if (!baseUrl || !model || !envVar) {
      throw new EnvLaunchConfigError(
        "A custom provider requires COWORK_PROVIDER_BASE_URL, COWORK_PROVIDER_MODEL, and COWORK_PROVIDER_ENV_VAR.",
      );
    }
    return {
      kind: "custom",
      baseUrl,
      model,
      envVar,
      credentialRef: ref,
      ...(trimmed(env["COWORK_PROVIDER_ID"]) !== undefined
        ? { providerId: trimmed(env["COWORK_PROVIDER_ID"]) as string }
        : {}),
    };
  }
  throw new EnvLaunchConfigError(`Unknown COWORK_PROVIDER_KIND: ${kind} (expected "built-in" or "custom").`);
}

/**
 * Build the env-driven launch source. Returns `null` when `COWORK_WORKSPACE_ROOT` is unset.
 */
export function createEnvLaunchSource(options: EnvLaunchSourceOptions = {}): LiveLaunchSource {
  const env = options.env ?? (process.env as Env);

  return async (): Promise<LiveLaunchConfig | null> => {
    const workspaceRoot = trimmed(env["COWORK_WORKSPACE_ROOT"]);
    if (!workspaceRoot) return null;

    const provider = parseProvider(env);
    const runtimeRoot = trimmed(env["COWORK_RUNTIME_ROOT"]) ?? trimmed(options.runtimeRoot);
    const appRoot = trimmed(env["COWORK_APP_ROOT"]) ?? options.appRoot;
    const binPath = trimmed(env["COWORK_OPENCODE_BIN"]) ?? trimmed(options.binPath);
    const settingsFilePath = trimmed(env["COWORK_SETTINGS_FILE"]) ?? trimmed(options.settingsFilePath);
    const dbPath = trimmed(env["COWORK_DB_PATH"]) ?? trimmed(options.dbPath);
    const autoUnlock = peekRememberedUnlock();

    const injectedStore = options.makeCredentialStore
      ? await options.makeCredentialStore()
      : undefined;

    return {
      workspaceRoot,
      ...(injectedStore !== undefined
        ? { credentialService: credential.createCredentialService({ store: injectedStore }) }
        : {}),
      provider,
      service: {
        ...(dbPath !== undefined ? { dbPath } : {}),
        ...(injectedStore !== undefined ? { credentialStore: injectedStore } : {}),
        ...(autoUnlock !== null ? { autoUnlock } : {}),
        rememberUnlock,
        ...(options.conversationsDir !== undefined
          ? { conversationsDir: options.conversationsDir }
          : {}),
        ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
        ...(settingsFilePath !== undefined ? { settingsFilePath } : {}),
        ...(options.skillsStateFilePath !== undefined
          ? { skillsStateFilePath: options.skillsStateFilePath }
          : {}),
        ...(options.skillRoots !== undefined ? { skillRoots: options.skillRoots } : {}),
      },
      ...(binPath !== undefined ? { binPath } : {}),
      ...(appRoot !== undefined ? { appRoot } : {}),
      ...(runtimeRoot !== undefined ? { runtimeRoot } : {}),
    };
  };
}
