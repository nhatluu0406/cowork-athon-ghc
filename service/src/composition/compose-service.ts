/**
 * Composition root (Tier 1) for the Cowork GHC local application service.
 *
 * Assembles the REAL in-process domain modules into ONE fully-wired loopback service:
 * constructs the singletons, wires the cross-cutting seams (the single {@link SecretScrubber}
 * → composed EV redactor; the ONE credential store; SSRF-guarded base_url persistence; the
 * permission gate ↔ files proxy ↔ runtime-reply; the stream hub ↔ session service), mounts
 * every HTTP router, and exposes a start seam that delegates to {@link startService}.
 *
 * The four LIVE-runtime boundaries stay as Tier 2 injection seams with honest not-attached
 * defaults (see `tier2-seams.ts`); the live supervisor (CGHC-028) injects real ones.
 */

import { sanitizeErrorMessage } from "../execution/index.js";
import { startService, type RunningService } from "../start.js";
import {
  createCredentialService,
  createCredentialRouter,
  createSecretScrubber,
} from "../credential/index.js";
import { createKeyringStore } from "../credential/index.js";
import {
  createNodeSettingsFs,
  createSettingsRouter,
  openSettingsStore,
  type SettingsModelPort,
} from "../diagnostics/index.js";
import {
  createModelConfigService,
  createInMemoryModelAuditSink,
  createProviderPort,
  createProviderRouter,
  createSsrfPolicy,
} from "../provider/index.js";
import {
  createRecentWorkspaces,
  createWorkspaceRouter,
  nodeExistenceProbe,
  nodeFsProbe,
} from "../workspace/index.js";
import {
  createInMemoryAuditSink,
  createNodeScheduler,
  createPermissionGate,
  createPermissionRouter,
  createSessionDenialSink,
} from "../permission/index.js";
import { ToolPermissionProxy } from "../files/index.js";
import { createExtensionRegistry } from "../extensions/index.js";
import { createSessionService, createSessionRouter } from "../session/index.js";
import { createSessionStreamHub } from "../server/session-stream-hub.js";
import { createEvStreamRouter } from "../server/ev-stream-router.js";
import { createSessionStreamRouter } from "../server/session-stream-route.js";
import {
  defaultDnsResolver,
  wrapSettingsStoreWithPortSync,
  wrapSettingsStoreWithSsrf,
} from "./wiring.js";
import {
  downRuntimeHealth,
  notAttachedConnector,
  notAttachedRuntimeReplyPort,
  notAttachedSendPrompt,
  notAttachedSessionStore,
} from "./tier2-seams.js";
import type { CoworkService, CoworkServiceDeps, CoworkServiceOptions } from "./types.js";

const DEFAULT_SETTINGS_PATH = ".runtime/settings.json";
const DEFAULT_PERMISSION_TIMEOUT_MS = 120_000;

/**
 * Construct + wire the whole service WITHOUT opening the socket. Async because the settings
 * store loads persisted state and the keyring store binds the native module at boot.
 */
export async function createCoworkService(
  options: CoworkServiceOptions = {},
): Promise<CoworkService> {
  const now = options.now ?? (() => new Date().toISOString());

  // --- Cross-cutting: the ONE value-based scrubber + the composed EV redactor. ---
  // Composition = value-based scrub (real seeded key values) THEN shape sanitize. The scrubber
  // learns a credential VALUE when it is stored (router POST) or resolved at launch, so
  // value-based redaction is ACTIVE for every credential that passes through the credential layer.
  const scrubber = createSecretScrubber();
  const redactError = (message: string): string => sanitizeErrorMessage(scrubber.scrub(message));

  // --- The ONE credential store + credential service (shares the single scrubber). ---
  const credentialStore = options.credentialStore ?? (await createKeyringStore());
  const credentialService = createCredentialService({ store: credentialStore, scrubber });

  // --- Settings store (persistent SD1 source of truth), loaded through the fs seam. ---
  const settingsFs = options.settingsFs ?? createNodeSettingsFs(options.settingsFilePath ?? DEFAULT_SETTINGS_PATH);
  const baseSettingsStore = await openSettingsStore({ fs: settingsFs });

  // --- Provider port (SSRF policy) + model config (seeded from settings.defaultModel). ---
  const ssrf = createSsrfPolicy({ resolver: options.dnsResolver ?? defaultDnsResolver() });
  const providerPort = createProviderPort({
    ssrf,
    connector: options.connector ?? notAttachedConnector(),
  });
  const modelConfig = createModelConfigService({
    port: providerPort,
    audit: createInMemoryModelAuditSink(),
  });
  seedFromSettings(baseSettingsStore, providerPort, modelConfig);

  // The router must see a store that does BOTH: (1) SSRF-guards a base_url before persistence,
  // and (2) mirrors default-model / credential-ref writes into the in-memory runtime resolver so
  // the persistent store and `activeModelFor()` / Tier 2 launch never drift (FIX-1). Port-sync
  // wraps the SSRF-wrapped store, so a single composed store enforces both invariants.
  const settingsStore = wrapSettingsStoreWithPortSync(
    wrapSettingsStoreWithSsrf(baseSettingsStore, providerPort),
    providerPort,
    modelConfig,
  );

  // --- Session service (Tier 2 store/health seams) + live stream hub bound to it. ---
  const sessionService = createSessionService({
    store: options.sessionStore ?? notAttachedSessionStore(),
    health: options.runtimeHealth ?? downRuntimeHealth(),
    canceller: providerPort,
    now,
    redactError,
  });
  const streamHub = createSessionStreamHub({
    apply: (sessionId, event) => sessionService.apply(sessionId, event),
    view: (sessionId) => sessionService.view(sessionId),
    redactError,
  });

  // --- Permission gate ↔ session-denial sink ↔ runtime-reply (Tier 2). ---
  const permissionAudit = createInMemoryAuditSink();
  const runtimeReply = options.runtimeReply ?? notAttachedRuntimeReplyPort();
  const permissionGate = createPermissionGate({
    reply: runtimeReply,
    audit: permissionAudit,
    session: createSessionDenialSink({
      has: (id) => sessionService.view(id) !== undefined,
      view: (id) => sessionService.view(id),
      apply: (id, event) => sessionService.apply(id, event),
    }),
    scheduler: createNodeScheduler(),
    timeoutMs: options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS,
    now,
  });

  // --- Runtime-extension layer (CGHC-026): honest not-attached skill/MCP seams, the composed
  // redactor for RE5 diagnostics, and the SAME SSRF policy the provider port uses for URL MCP
  // endpoints. No router is mounted (Tier 2 / CGHC-028 attaches live execution + a UI).
  const extensions = createExtensionRegistry({ now, redact: redactError, ssrf });

  const modelPort: SettingsModelPort = {
    clearSessionModel: (sessionId) => modelConfig.clearSessionModel(sessionId),
    defaultModelRef: () => modelConfig.activeModelFor(),
  };

  const recentWorkspaces = createRecentWorkspaces();
  const routers = [
    createWorkspaceRouter({
      recent: recentWorkspaces,
      fsProbe: options.workspaceFsProbe ?? nodeFsProbe(),
      existsProbe: options.workspaceExistsProbe ?? nodeExistenceProbe,
    }),
    createCredentialRouter(credentialService),
    createSettingsRouter(settingsStore, modelPort),
    createProviderRouter(providerPort),
    createPermissionRouter(permissionGate),
    createEvStreamRouter(streamHub),
    createSessionStreamRouter(streamHub),
    // The session boundary: create/list/send-prompt/cancel. Tier 1 mounts it with the honest
    // not-attached SendPrompt so it compiles + errors truthfully without a child; live fills it.
    createSessionRouter(sessionService, options.sendPrompt ?? notAttachedSendPrompt()),
  ];

  const deps: CoworkServiceDeps = {
    scrubber,
    credentialService,
    providerPort,
    modelConfig,
    settingsStore,
    recentWorkspaces,
    permissionGate,
    permissionAudit,
    sessionService,
    streamHub,
    extensions,
    redactError,
    buildToolPermissionProxy: (guard) =>
      new ToolPermissionProxy({ guard, gate: permissionGate, reply: runtimeReply, now }),
  };

  return {
    routers,
    deps,
    // The service auto-mounts the (token-guarded) health router itself; we never re-mount it.
    start: (): Promise<RunningService> => startService({ ...options, routers }),
  };
}

/** Convenience: build the whole service and open the loopback socket in one call. */
export async function startCoworkService(
  options: CoworkServiceOptions = {},
): Promise<{ readonly running: RunningService; readonly deps: CoworkServiceDeps }> {
  const composed = await createCoworkService(options);
  const running = await composed.start();
  return { running, deps: composed.deps };
}

/** Seed the runtime resolver from the persistent settings (one source of truth at boot). */
function seedFromSettings(
  store: Awaited<ReturnType<typeof openSettingsStore>>,
  providerPort: ReturnType<typeof createProviderPort>,
  modelConfig: ReturnType<typeof createModelConfigService>,
): void {
  const defaultModel = store.defaultModel();
  if (defaultModel !== undefined) {
    modelConfig.configureModel({ scope: "default", model: defaultModel });
  }
  for (const provider of store.listProviderSettings()) {
    if (provider.credentialRef !== undefined) {
      providerPort.configureCredential(provider.providerId, provider.credentialRef);
    }
  }
}
