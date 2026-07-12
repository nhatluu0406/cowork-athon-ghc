/**
 * Production {@link LiveLaunchSource}: assemble a live-launch config from explicit launch env
 * (CGHC-028 Wave B2b).
 *
 * When the operator/app has selected a workspace + provider, those choices arrive as launch
 * environment variables (the desktop settings flow persists them; a bounded live test sets them
 * directly). This source reads them and, when a COMPLETE + coherent selection is present, builds
 * the {@link LiveLaunchConfig} `buildLiveCoworkOptions` needs — including opening the ONE OS-backed
 * credential store and wiring the SAME store into both the credential service and
 * `service.credentialStore` (the "one credential store" invariant).
 *
 * When `COWORK_WORKSPACE_ROOT` is UNSET, the app is simply not configured yet: the source returns
 * `null` and the resolver falls back to the honest not-connected handshake. When a workspace IS set
 * but the provider selection is incomplete/incoherent, it throws a typed, secret-free
 * {@link EnvLaunchConfigError} (surfaced as an honest failure, never a fake ready).
 *
 * SECURITY: no secret VALUE is read here — only a non-secret credential account handle
 * (`COWORK_CREDENTIAL_ACCOUNT`). The key value leaves the store only at the supervisor's launch
 * boundary. `makeCredentialStore` is injectable so tests never touch the real keyring.
 */

import { credential } from "@cowork-ghc/service";
import type { BuiltInProviderSelection, LiveProviderSelection } from "@cowork-ghc/service";

import type { LiveLaunchConfig, LiveLaunchSource } from "./live-launch-resolver.js";

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
  /**
   * Explicit absolute path to the pinned OpenCode binary. In a packaged app the binary is NOT under
   * `node_modules` (it ships via `extraResources`), so the shell resolves it and passes it here;
   * env `COWORK_OPENCODE_BIN` overrides it. Honored by `buildLiveCoworkOptions`/`resolveBinPath`.
   */
  readonly binPath?: string;
  /**
   * Explicit writable root for per-launch `.runtime/` state. In a packaged app the install dir is
   * read-only, so the shell passes Electron's `userData` dir; env `COWORK_RUNTIME_ROOT` overrides it.
   */
  readonly runtimeRoot?: string;
  /** Browser origins the live loopback service must allow (the renderer's `app://cowork`). */
  readonly allowedOrigins?: readonly string[];
  /** Absolute settings file the live service reads/writes (shared with the onboarding service). */
  readonly settingsFilePath?: string;
  /** Open the ONE credential store (default: the OS keyring adapter). Injectable for tests. */
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
    if (!providerId) throw new EnvLaunchConfigError("COWORK_PROVIDER_ID is required for a built-in provider.");
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
 * Build the env-driven launch source. Returns `null` when `COWORK_WORKSPACE_ROOT` is unset (app
 * not configured → honest not-connected). Otherwise assembles the full launch config, opening the
 * ONE credential store and sharing it with the service composition.
 */
export function createEnvLaunchSource(options: EnvLaunchSourceOptions = {}): LiveLaunchSource {
  const env = options.env ?? (process.env as Env);
  const makeStore =
    options.makeCredentialStore ?? ((): Promise<credential.CredentialStore> => credential.createKeyringStore());

  return async (): Promise<LiveLaunchConfig | null> => {
    const workspaceRoot = trimmed(env["COWORK_WORKSPACE_ROOT"]);
    if (!workspaceRoot) return null; // not configured yet → honest not-connected

    const provider = parseProvider(env);
    const store = await makeStore();
    const credentialService = credential.createCredentialService({ store });
    // Env overrides an explicit shell-provided value, which overrides the dev default.
    const runtimeRoot = trimmed(env["COWORK_RUNTIME_ROOT"]) ?? trimmed(options.runtimeRoot);
    const appRoot = trimmed(env["COWORK_APP_ROOT"]) ?? options.appRoot;
    const binPath = trimmed(env["COWORK_OPENCODE_BIN"]) ?? trimmed(options.binPath);

    const settingsFilePath = trimmed(env["COWORK_SETTINGS_FILE"]) ?? trimmed(options.settingsFilePath);

    return {
      workspaceRoot,
      credentialService,
      provider,
      // The credential service + the composed service MUST read the SAME store (one store). The live
      // service also needs the renderer origin allowed and (optionally) the shared settings file.
      service: {
        credentialStore: store,
        ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
        ...(settingsFilePath !== undefined ? { settingsFilePath } : {}),
      },
      ...(binPath !== undefined ? { binPath } : {}),
      ...(appRoot !== undefined ? { appRoot } : {}),
      ...(runtimeRoot !== undefined ? { runtimeRoot } : {}),
    };
  };
}
