/**
 * Shell-friendly builder for {@link LiveCoworkServiceOptions} (CGHC-028 Wave B2a).
 *
 * `buildLiveCoworkOptions` closes the Wave B1 gap: the Electron shell (and Wave C) only knows
 * simple inputs (a workspace path, a pinned binary path, a provider selection, and the ONE
 * credential service). This assembles a complete, spawn-ready live-service option set from those:
 * it constructs an {@link OpencodeSupervisor} with the production default seams, derives a coherent
 * {@link SupervisorStartSpec} (per-launch data/config dirs, env-var injection requests, pinned
 * binary), stamps the `workspaceId`, and wires the FIX-6 `seedScrubber` hook to
 * `deps.credentialService.resolveInjection(...)` so the shared value-scrubber is seeded from the
 * ONE credential store at launch — never by reading the OS keyring directly.
 *
 * SECURITY: inputs are validated (absolute workspace path, coherent provider, SSRF-checked custom
 * base URL reusing the outbound provider policy). No secret value is ever accepted here — a
 * credential crosses only as a non-secret {@link CredentialRef} handle; error messages carry no key.
 */

import { randomBytes } from "node:crypto";
import net from "node:net";
import { isAbsolute, join } from "node:path";
import type { CredentialRef } from "@cowork-ghc/contracts";
import {
  builtInProviderEnv,
  customOpenAiCompatibleEnv,
  type BuiltInProviderId,
  type ProviderEnvSpec,
} from "@cowork-ghc/runtime";
import type { CredentialService, CredentialInjectionRequest } from "../credential/index.js";
import { resolveInjections } from "../credential/index.js";
import { MS365_TOOL_CALL_PATH } from "../ms365/index.js";
import { DOCX_TOOL_CALL_PATH } from "../documents/docx-tool-router.js";
import { generateClientToken } from "../server/token.js";
import {
  createSsrfPolicy,
  type DnsResolver,
  readE2eMockLlmBaseUrl,
  readDevLoopbackHttpEscape,
} from "../provider/index.js";
import {
  OpencodeSupervisor,
  type ChildSpawner,
  type HealthProbe,
  type OpencodeProviderConfig,
  LIVE_SESSION_PERMISSION_POLICY,
  type PortChecker,
  type ProcessTimesProbe,
  type ResolveInjections,
  type SupervisorStartSpec,
} from "../runtime/index.js";
import type { CoworkServiceDeps, CoworkServiceOptions } from "./types.js";
import type { LiveCoworkServiceOptions } from "./compose-live.js";
import { defaultDnsResolver } from "./wiring.js";

/** A built-in provider (models.dev-known env var; no base URL). */
export interface BuiltInProviderSelection {
  readonly kind: "built-in";
  readonly providerId: BuiltInProviderId;
  /** Handle to the stored key in the ONE credential store (never the value). */
  readonly credentialRef: CredentialRef;
}

/** A user-defined OpenAI-compatible endpoint (user base URL + env var + model). */
export interface CustomProviderSelection {
  readonly kind: "custom";
  /** OpenCode provider id to register (default: `custom-openai-compat`). */
  readonly providerId?: string;
  /** OpenAI-compatible base URL — MUST be https + public (SSRF-validated). */
  readonly baseUrl: string;
  /** Model id(s) to expose in `opencode.json`. */
  readonly model: string;
  /** The env var Cowork GHC injects the resolved key into. */
  readonly envVar: string;
  readonly credentialRef: CredentialRef;
}

export type LiveProviderSelection = BuiltInProviderSelection | CustomProviderSelection;

/** Minimal, shell-friendly inputs for {@link buildLiveCoworkOptions}. */
export interface BuildLiveCoworkInput {
  /** Absolute workspace root — becomes both the `workspaceId` and the child `cwd`. */
  readonly workspaceRoot: string;
  /**
   * Optional credential service for supervisor injection. When omitted,
   * `startLiveCoworkService` attaches `deps.credentialService` (vault) before
   * `supervisor.start` so injection and Tier 1 share one store.
   */
  readonly credentialService?: CredentialService;
  readonly provider: LiveProviderSelection;
  /** Absolute path to the pinned OpenCode binary. Default: resolved under {@link appRoot}. */
  readonly binPath?: string;
  /** App install root used to default {@link binPath} to `node_modules/opencode-ai/bin/opencode.exe`. */
  readonly appRoot?: string;
  /** Root under which per-launch data/config + `.runtime/` state live. Default: {@link workspaceRoot}. */
  readonly runtimeRoot?: string;
  /** Stable per-launch id (data/config dir segment). Default: a random `live-...` id. */
  readonly launchId?: string;
  /** Loopback port the child binds. Default: an ephemeral free loopback port. */
  readonly port?: number;
  /** Loopback host. Default: the runtime's `127.0.0.1`. */
  readonly host?: string;
  /** Curated base env for the child (default: the runtime's full-`process.env` fallback). */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  /** Tier 1 bind options + seams passed straight through (settingsFs, credentialStore, …). */
  readonly service?: CoworkServiceOptions;
  readonly now?: () => string;
  /** DNS resolver for the custom-base-URL SSRF check. Default: `node:dns`. */
  readonly dnsResolver?: DnsResolver;
  /** Free-port allocator seam (tests inject a deterministic one). */
  readonly allocatePort?: () => Promise<number>;
  // --- Supervisor seams (production defaults; tests inject fakes to avoid a real spawn). ---
  readonly spawner?: ChildSpawner;
  readonly healthProbe?: HealthProbe;
  readonly processTimesProbe?: ProcessTimesProbe;
  readonly portChecker?: PortChecker;
  readonly log?: (line: string) => void;
}

/** A typed, secret-free failure building the live options. */
export class LiveLaunchConfigError extends Error {
  readonly code = "live_launch_config_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "LiveLaunchConfigError";
  }
}

const CUSTOM_PROVIDER_ID_DEFAULT = "custom-openai-compat";

/**
 * Assemble a complete {@link LiveCoworkServiceOptions} from minimal shell inputs. Async because it
 * SSRF-validates a custom base URL and may allocate a free port. Ready to hand to
 * {@link import("./compose-live.js").startLiveCoworkService}.
 */
export async function buildLiveCoworkOptions(
  input: BuildLiveCoworkInput,
): Promise<LiveCoworkServiceOptions> {
  const workspaceRoot = input.workspaceRoot?.trim();
  if (!workspaceRoot) throw new LiveLaunchConfigError("workspaceRoot is required.");
  if (!isAbsolute(workspaceRoot)) {
    throw new LiveLaunchConfigError("workspaceRoot must be an absolute path.");
  }

  const { spec, providerConfig } = await resolveProvider(input.provider, input.dnsResolver);

  const binPath = resolveBinPath(input);
  const runtimeRoot = input.runtimeRoot?.trim() || workspaceRoot;
  const launchId = input.launchId?.trim() || `live-${randomBytes(6).toString("hex")}`;
  const launchDir = join(runtimeRoot, ".runtime", "opencode", launchId);
  const port = input.port ?? (await (input.allocatePort ?? allocateLoopbackPort)());

  const injectionRequests: readonly CredentialInjectionRequest[] = [
    { ref: input.provider.credentialRef, spec },
  ];

  // The supervisor resolves the handle to a child-env injection at launch (env only). Prefer the
  // composed vault-backed credential service (attached in startLiveCoworkService) so injection
  // and Tier 1 share ONE store. A caller-supplied service remains supported for tests.
  let attachedResolve: ResolveInjections | null =
    input.credentialService !== undefined
      ? (requests) => resolveInjections(input.credentialService!, requests)
      : null;
  const resolveForSupervisor: ResolveInjections = (requests) => {
    if (attachedResolve === null) {
      throw new LiveLaunchConfigError(
        "Credential injection is not attached. startLiveCoworkService must bind deps.credentialService before supervisor.start.",
      );
    }
    return attachedResolve(requests);
  };

  const supervisor = new OpencodeSupervisor({
    root: runtimeRoot,
    resolveInjections: resolveForSupervisor,
    ...(input.spawner !== undefined ? { spawner: input.spawner } : {}),
    ...(input.healthProbe !== undefined ? { healthProbe: input.healthProbe } : {}),
    ...(input.processTimesProbe !== undefined ? { processTimesProbe: input.processTimesProbe } : {}),
    ...(input.portChecker !== undefined ? { portChecker: input.portChecker } : {}),
    ...(input.log !== undefined ? { log: input.log } : {}),
  });

  // MS365 tool bridge: advertise the loopback endpoint + a DISTINCT scoped token to the child.
  // Unconditional — the MS365 router mounts unconditionally on main (no CGHC_MS365_ENABLED gate).
  // The SERVICE (boundary) bind host/port/clientToken are a SEPARATE listener from the child's
  // OpenCode `port` above (two independent sockets) — they are resolved HERE and threaded back
  // into the returned `service` options below, so the endpoint advertised to the child is the
  // endpoint the service actually opens. A caller-supplied `input.service.host/port/clientToken`
  // is always reused as-is, never overridden. When the caller has not chosen a service port,
  // default to an ephemeral OS-assigned loopback port (0) — NEVER the child's OpenCode `port`,
  // which is a distinct process/socket and would collide with it.
  const serviceHost = input.service?.host ?? input.host ?? "127.0.0.1";
  const servicePort = input.service?.port ?? (await (input.allocatePort ?? allocateLoopbackPort)());
  const serviceClientToken = input.service?.clientToken ?? generateClientToken();
  // Task 2 (P5.5): the child gets a token scoped to ONLY MS365_TOOL_CALL_PATH — never the full
  // client token that guards every route — so a leaked/compromised child cannot call anything
  // else on the boundary. Minted with the SAME generator as clientToken (never persisted).
  const ms365ToolToken = generateClientToken();
  const ms365Endpoint = `http://${formatHostForUrl(serviceHost)}:${servicePort}${MS365_TOOL_CALL_PATH}`;
  // Docx tool bridge: a DISTINCT scoped token + endpoint, mirroring the MS365 bridge exactly. The
  // child gets a token scoped to ONLY DOCX_TOOL_CALL_PATH (registered in pathScopedTokens below) —
  // never the full client token — so a leaked/compromised child cannot call anything else on the
  // boundary. Minted with the SAME generator as clientToken (never persisted).
  const docxToolToken = generateClientToken();
  const docxEndpoint = `http://${formatHostForUrl(serviceHost)}:${servicePort}${DOCX_TOOL_CALL_PATH}`;
  const baseEnv = {
    ...(input.baseEnv ?? {}),
    CGHC_MS365_TOOL_ENDPOINT: ms365Endpoint,
    CGHC_MS365_TOKEN: ms365ToolToken,
    CGHC_DOCX_TOOL_ENDPOINT: docxEndpoint,
    CGHC_DOCX_TOKEN: docxToolToken,
  };

  const startSpec: SupervisorStartSpec = {
    binPath,
    cwd: workspaceRoot,
    port,
    dataHome: join(launchDir, "data"),
    configDir: join(launchDir, "config"),
    injectionRequests,
    ...(input.host !== undefined ? { host: input.host } : {}),
    baseEnv,
    ...(providerConfig !== undefined ? { providerConfig } : {}),
    // The scoped MS365 tool token is baked into baseEnv above as CGHC_MS365_TOKEN — it must ALSO
    // be masked in the log-safe spawn snapshot, same as any provider key. One source of truth:
    // `secretValues`/`redactedEnvSnapshot` in `@cowork-ghc/runtime` (never a second ad-hoc list).
    extraSecretValues: [ms365ToolToken, docxToolToken],
  };

  // FIX-6: seed the SHARED value-scrubber via deps.credentialService (which registers the resolved
  // value with deps.scrubber) — NOT by reading the keyring here. deps.credentialService reads the
  // ONE store (service.credentialStore), so redaction covers the real key before the socket opens.
  const seedScrubber = async (
    _scrubber: unknown,
    deps: CoworkServiceDeps,
  ): Promise<void> => {
    await deps.credentialService.resolveInjection(input.provider.credentialRef, spec);
  };

  // The returned `service` options pin the SAME host/port/clientToken that were advertised to the
  // child above (so the service binds where the child was told to look), AND register
  // `ms365ToolToken` as valid ONLY for MS365_TOOL_CALL_PATH — the token actually handed to the
  // child (CGHC_MS365_TOKEN above) grants it nothing else on the boundary.
  const service = {
    ...(input.service ?? {}),
    host: serviceHost,
    port: servicePort,
    clientToken: serviceClientToken,
    pathScopedTokens: [
      ...(input.service?.pathScopedTokens ?? []),
      { token: ms365ToolToken, paths: [MS365_TOOL_CALL_PATH] },
      { token: docxToolToken, paths: [DOCX_TOOL_CALL_PATH] },
    ],
  };

  return {
    supervisor,
    startSpec,
    workspaceId: workspaceRoot,
    seedScrubber,
    attachCredentialService: (service: CredentialService) => {
      attachedResolve = (requests) => resolveInjections(service, requests);
    },
    service,
    ...(input.now !== undefined ? { now: input.now } : {}),
  };
}

/** Resolve the provider selection to an env spec + (custom) a validated `opencode.json` config. */
async function resolveProvider(
  provider: LiveProviderSelection,
  dnsResolver: DnsResolver | undefined,
): Promise<{ spec: ProviderEnvSpec; providerConfig?: OpencodeProviderConfig }> {
  if (provider.kind === "built-in") {
    return { spec: builtInProviderEnv(provider.providerId) };
  }
  const baseUrl = provider.baseUrl?.trim();
  const envVar = provider.envVar?.trim();
  const model = provider.model?.trim();
  if (!baseUrl) throw new LiveLaunchConfigError("Custom provider requires a baseUrl.");
  if (!envVar) throw new LiveLaunchConfigError("Custom provider requires an envVar.");
  if (!model) throw new LiveLaunchConfigError("Custom provider requires a model.");

  // SSRF-validate the base URL at the execution boundary (reuse the outbound provider policy). A
  // private/loopback/http target is refused with a typed SsrfBlockedError before any spawn.
  // `readDevLoopbackHttpEscape` is resolved once here (this function's own composition root,
  // called by the shell BEFORE `startLiveCoworkService`/`createCoworkService` runs) from process
  // env only — never from a request/caller-supplied field. Unset ⇒ byte-for-byte unchanged.
  const e2eMockLlmBaseUrl = readE2eMockLlmBaseUrl();
  const devLoopbackHttpEscape = readDevLoopbackHttpEscape();
  const policy = createSsrfPolicy({
    resolver: dnsResolver ?? defaultDnsResolver(),
    ...(e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl } : {}),
    ...(devLoopbackHttpEscape ? { loopbackEscape: true } : {}),
  });
  await policy.assertAllowed(baseUrl);

  let spec: ProviderEnvSpec;
  try {
    spec = customOpenAiCompatibleEnv({ providerId: provider.providerId ?? CUSTOM_PROVIDER_ID_DEFAULT, envVar });
  } catch (err) {
    throw new LiveLaunchConfigError(err instanceof Error ? err.message : "Invalid custom provider.");
  }
  const providerConfig: OpencodeProviderConfig = {
    providerId: provider.providerId ?? CUSTOM_PROVIDER_ID_DEFAULT,
    envVar,
    models: [model],
    baseUrl,
    permission: { ...LIVE_SESSION_PERMISSION_POLICY },
  };
  return { spec, providerConfig };
}

/** Default the pinned OpenCode binary path under the app install root. */
function resolveBinPath(input: BuildLiveCoworkInput): string {
  // Honor an explicit binPath, then a `COWORK_OPENCODE_BIN` env override (packaged apps ship the binary outside `node_modules`, under `resourcesPath`).
  const explicit = input.binPath?.trim() || process.env["COWORK_OPENCODE_BIN"]?.trim();
  if (explicit) return explicit;
  const appRoot = input.appRoot?.trim();
  if (!appRoot) {
    throw new LiveLaunchConfigError("binPath or appRoot is required to locate the OpenCode binary.");
  }
  return join(appRoot, "node_modules", "opencode-ai", "bin", "opencode.exe");
}

/**
 * Format a loopback host for embedding in a URL authority. An IPv6 literal (contains ":")
 * must be wrapped in brackets — `http://::1:PORT` is malformed; `http://[::1]:PORT` is correct.
 * IPv4 / hostnames pass through unchanged; an already-bracketed host is returned as-is.
 */
export function formatHostForUrl(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) return host;
  return host.includes(":") ? `[${host}]` : host;
}

/** Production free-port allocator: bind loopback port 0, read the assigned port, release it. */
function allocateLoopbackPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("port allocation failed"))));
    });
  });
}
