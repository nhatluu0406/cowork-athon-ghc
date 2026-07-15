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
 *
 * MS365 CHILD-ENV ADVERTISEMENT (Task 11 follow-up): when `CGHC_MS365_ENABLED` is on
 * ({@link isMs365Enabled}), the OpenCode child is told the loopback MS365 tool endpoint via the
 * EXISTING `SupervisorStartSpec.baseEnv` seam (`supervisor.ts` merges it into the child spawn env).
 * `CGHC_MS365_TOOL_ENDPOINT` carries only a non-secret loopback URL (host:port + path); the child
 * authenticates to this same service with the SAME per-launch client token every other call already
 * uses (reused from `input.service.clientToken`/`assertConfiguredToken`/`generateClientToken` — no
 * new secret is minted for this purpose). Because the parent service's own bind port/token are
 * normally decided later (inside `startLiveCoworkService`/`createCoworkService`, AFTER this function
 * returns), this function pre-decides them here (reusing any caller-supplied `input.service.host` /
 * `port` / `clientToken`, else generating them) and threads the SAME values back into the returned
 * `service` options so the service actually binds where the child was told to look. OFF (flag unset):
 * no `CGHC_MS365_*` var is added and `service.host`/`port`/`clientToken` are left exactly as the
 * caller passed them (`undefined` stays `undefined`) — baseline byte-for-byte unchanged.
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
import {
  createSsrfPolicy,
  isPrivateProviderAllowed,
  type DnsResolver,
  readE2eMockLlmBaseUrl,
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
import { isMs365Enabled, MS365_TOOL_CALL_PATH } from "../ms365/index.js";
import { assertConfiguredToken, generateClientToken } from "../server/token.js";
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
  /** The ONE credential service (its store MUST match `service.credentialStore`). */
  readonly credentialService: CredentialService;
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

  // The supervisor resolves the handle to a child-env injection at launch (env only). It reads the
  // input credential service, which MUST wrap the SAME store as service.credentialStore (one store).
  const resolveForSupervisor: ResolveInjections = (requests) =>
    resolveInjections(input.credentialService, requests);

  const supervisor = new OpencodeSupervisor({
    root: runtimeRoot,
    resolveInjections: resolveForSupervisor,
    ...(input.spawner !== undefined ? { spawner: input.spawner } : {}),
    ...(input.healthProbe !== undefined ? { healthProbe: input.healthProbe } : {}),
    ...(input.processTimesProbe !== undefined ? { processTimesProbe: input.processTimesProbe } : {}),
    ...(input.portChecker !== undefined ? { portChecker: input.portChecker } : {}),
    ...(input.log !== undefined ? { log: input.log } : {}),
  });

  // MS365 child-env advertisement (flag-gated, Task 11 follow-up): resolve the same
  // host/port/clientToken the SERVICE (not the child) will bind to, so the endpoint the child is
  // told about is the endpoint the service actually opens. When the caller already supplied any of
  // these via `input.service`, reuse them as-is (never silently override a caller's choice).
  const ms365Enabled = isMs365Enabled(process.env);
  const servicePlan = ms365Enabled ? await resolveServiceBindPlan(input) : undefined;
  // Task 2 (P5.5): the child gets a token scoped to ONLY /v1/ms365/tool-call — never the full
  // client token that guards every route — so a leaked/compromised child cannot call anything
  // else on the boundary. Minted with the SAME generator as clientToken (never persisted).
  const ms365ToolToken = ms365Enabled ? generateClientToken() : undefined;
  const baseEnv = ms365Enabled
    ? {
        ...(input.baseEnv ?? {}),
        CGHC_MS365_ENABLED: "1",
        CGHC_MS365_TOOL_ENDPOINT: ms365ToolEndpointUrl(servicePlan!),
        CGHC_MS365_TOKEN: ms365ToolToken!,
      }
    : input.baseEnv;

  const startSpec: SupervisorStartSpec = {
    binPath,
    cwd: workspaceRoot,
    port,
    dataHome: join(launchDir, "data"),
    configDir: join(launchDir, "config"),
    injectionRequests,
    ...(input.host !== undefined ? { host: input.host } : {}),
    ...(baseEnv !== undefined ? { baseEnv } : {}),
    ...(providerConfig !== undefined ? { providerConfig } : {}),
    // Task 2 (P5.5) fix: the scoped MS365 tool token is baked into baseEnv above as
    // CGHC_MS365_TOKEN — it must ALSO be masked in the log-safe spawn snapshot, same as any
    // provider key. One source of truth: `secretValues`/`redactedEnvSnapshot` in
    // `@cowork-ghc/runtime` (never a second ad-hoc redaction list).
    ...(ms365ToolToken !== undefined ? { extraSecretValues: [ms365ToolToken] } : {}),
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

  // When MS365 is enabled, the returned `service` options pin the SAME host/port/clientToken that
  // were advertised to the child above (so the service binds where the child was told to look),
  // AND register `ms365ToolToken` as valid ONLY for MS365_TOOL_CALL_PATH — the token actually
  // handed to the child (CGHC_MS365_TOKEN above) grants it nothing else on the boundary; otherwise
  // `input.service` is passed through untouched (baseline unaffected when the flag is off).
  const service = servicePlan
    ? {
        ...(input.service ?? {}),
        ...servicePlan,
        pathScopedTokens: [
          ...(input.service?.pathScopedTokens ?? []),
          { token: ms365ToolToken!, paths: [MS365_TOOL_CALL_PATH] },
        ],
      }
    : input.service;

  return {
    supervisor,
    startSpec,
    workspaceId: workspaceRoot,
    seedScrubber,
    ...(service !== undefined ? { service } : {}),
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
  // loopback/http target is refused with a typed SsrfBlockedError before any spawn; a private
  // (RFC-1918) target is refused too UNLESS the user explicitly opted in via
  // CGHC_SSRF_ALLOW_PRIVATE_PROVIDER (provider endpoints only — see `isPrivateProviderAllowed`).
  const e2eMockLlmBaseUrl = readE2eMockLlmBaseUrl();
  const policy = createSsrfPolicy({
    resolver: dnsResolver ?? defaultDnsResolver(),
    allowPrivateNetwork: isPrivateProviderAllowed(process.env),
    ...(e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl } : {}),
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

/** The service host/port/clientToken the MS365 endpoint is advertised against. */
interface ServiceBindPlan {
  readonly host: string;
  readonly port: number;
  readonly clientToken: string;
}

/**
 * Resolve the exact host/port/clientToken the SERVICE (not the OpenCode child) will bind to,
 * reusing any value the caller already fixed via `input.service` and generating the rest. This
 * lets the MS365 advertisement below name the real endpoint even though the service itself binds
 * later (inside `startLiveCoworkService`) — as long as the SAME plan is threaded into the returned
 * `service` options (done by the caller of this function), the service ends up bound exactly there.
 */
async function resolveServiceBindPlan(input: BuildLiveCoworkInput): Promise<ServiceBindPlan> {
  const host = input.service?.host?.trim() || "127.0.0.1";
  const port = input.service?.port ?? (await (input.allocatePort ?? allocateLoopbackPort)());
  const clientToken =
    input.service?.clientToken !== undefined
      ? assertConfiguredToken(input.service.clientToken)
      : generateClientToken();
  return { host, port, clientToken };
}

/** The loopback MS365 tool-call endpoint URL the child is told about (non-secret). */
function ms365ToolEndpointUrl(plan: ServiceBindPlan): string {
  const authority = plan.host.includes(":") ? `[${plan.host}]` : plan.host;
  return `http://${authority}:${plan.port}${MS365_TOOL_CALL_PATH}`;
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
