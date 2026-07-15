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
import { assessProviderReadiness } from "../diagnostics/provider-readiness.js";
import {
  createModelConfigService,
  createInMemoryModelAuditSink,
  createProviderPort,
  createProviderRouter,
  createSsrfPolicy,
  readE2eMockLlmBaseUrl,
} from "../provider/index.js";
import {
  createProviderConnectionTester,
  createProviderProfileRouter,
  createProviderProfileStore,
  createProfileRuntimeBridge,
  migrateLegacySettingsToProfiles,
} from "../provider-profiles/index.js";
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
import { createSessionService, createSessionRouter, SessionRequestError } from "../session/index.js";
import { createConversationStore, createConversationRouter } from "../conversation/index.js";
import { createSkillCatalog, createSkillRouter } from "../skills/index.js";
import { createFileReviewRouter } from "../file-review/index.js";
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
  notAttachedRuntimeReplyPort,
  notAttachedSendPrompt,
  notAttachedSessionStore,
} from "./tier2-seams.js";
import type { CoworkService, CoworkServiceDeps, CoworkServiceOptions } from "./types.js";
import { createHttpConnectorBundle } from "./http-connector-factory.js";
import { createWorkspaceLocalFileReader } from "./ms365-file-reader.js";
import {
  createDeviceCodeProvider,
  createHttpGraphClient,
  createListsService,
  createManualTokenProvider,
  createMs365Connector,
  createMs365Router,
  createMs365SessionScope,
  createOutlookService,
  createPlannerService,
  createSharePointService,
  createSiteScopeFilePersistence,
  createSiteScopeService,
  createSiteScopeStore,
  createTeamsService,
  createWriteModeFilePersistence,
  createWriteModeStore,
  isMs365Enabled,
  readMs365DeviceConfig,
} from "../ms365/index.js";

/**
 * Fixed OAuth scopes advertised on the MS365 view/connect surface. Least-privilege, matching the
 * tool surface: Files.ReadWrite.All for SharePoint file ops; Sites.ReadWrite.All for site/Lists
 * access (P3 Lists CRUD needs write — ReadWrite supersedes the earlier Sites.Read.All, so it
 * REPLACES it rather than sitting alongside); Mail.Read for the Outlook read-only tools (P1 — no
 * send/reply, so no Mail.ReadWrite/Mail.Send); Tasks.ReadWrite for Planner CRUD (P2 — plans read
 * via /me/planner/plans, so no Group.Read.All); Teams messaging (P4): Chat.ReadWrite (list/read/
 * send the user's own chats + members — NOT Chat.ReadWrite.All), Team.ReadBasic.All +
 * Channel.ReadBasic.All (list joined teams/channels), ChannelMessage.Read.All (read channel
 * messages), ChannelMessage.Send (post). Add a scope here only when a new tool surface needs it.
 */
const MS365_SCOPES: readonly string[] = [
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All",
  "Mail.Read",
  "Tasks.ReadWrite",
  "Chat.ReadWrite",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
  "ChannelMessage.Send",
];

const DEFAULT_SETTINGS_PATH = ".runtime/settings.json";
const DEFAULT_CONVERSATIONS_DIR = ".runtime/conversations";
const DEFAULT_SKILLS_DIR = ".runtime/skills";
const DEFAULT_SKILLS_STATE_PATH = ".runtime/skills-enabled.json";
const ms365SiteScopeFilePath = ".runtime/ms365-site-scope.json";
const ms365WriteModeFilePath = ".runtime/ms365-write-mode.json";
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
  let baseSettingsStore = await openSettingsStore({ fs: settingsFs });

  const migration = await migrateLegacySettingsToProfiles(
    baseSettingsStore.snapshot(),
    credentialStore,
  );
  if (migration.migrated || migration.credentialRemapped) {
    await baseSettingsStore.applyDocument(migration.settings);
  }

  const providerProfileStore = createProviderProfileStore({ store: baseSettingsStore, now });

  const dnsResolver = options.dnsResolver ?? defaultDnsResolver();
  const e2eMockLlmBaseUrl = readE2eMockLlmBaseUrl();
  const ssrf = createSsrfPolicy({
    resolver: dnsResolver,
    ...(e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl } : {}),
  });

  // --- Provider port: real HTTP probe connector for onboarding test-connection (CGHC-011). ---
  const httpBundle =
    options.connector === undefined
      ? createHttpConnectorBundle(credentialService, baseSettingsStore, dnsResolver)
      : undefined;
  const providerPort =
    options.connector !== undefined
      ? createProviderPort({ ssrf, connector: options.connector })
      : httpBundle!.providerPort;

  const modelConfig = createModelConfigService({
    port: providerPort,
    audit: createInMemoryModelAuditSink(),
  });
  if (httpBundle !== undefined) {
    httpBundle.bindActiveModelResolver(() => modelConfig.activeModelFor() ?? undefined);
  }
  await seedFromSettings(baseSettingsStore, providerPort, modelConfig);

  const profileRuntimeBridge = createProfileRuntimeBridge({
    profiles: providerProfileStore,
    port: providerPort,
    modelConfig,
  });
  try {
    await profileRuntimeBridge.syncActiveProfile();
  } catch {
    // BOOT resilience: the active profile's persisted base_url may no longer pass the SSRF
    // policy (e.g. the network's DNS now resolves the hostname to a private address after a
    // VPN/network change). Refusing to START would lock the user out of the Settings screen
    // needed to fix it. Skip the sync: the port holds no unvalidated endpoint, the provider
    // surfaces honestly as unverified/not-ready, and the profiles router still propagates the
    // same error to the user on an explicit runtime re-test/switch.
  }

  const profileConnectionTester = createProviderConnectionTester({
    credentials: credentialService,
    dnsResolver,
    now,
    ...(e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl } : {}),
  });

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

  const conversationStore = createConversationStore({
    rootDir: options.conversationsDir ?? DEFAULT_CONVERSATIONS_DIR,
    now,
  });
  await conversationStore.recoverStaleRunning();

  const skillCatalog = await createSkillCatalog({
    roots:
      options.skillRoots ??
      [{ path: DEFAULT_SKILLS_DIR, source: "user_local", createIfMissing: true }],
    stateFilePath: options.skillsStateFilePath ?? DEFAULT_SKILLS_STATE_PATH,
  });

  // --- MS365 (SharePoint over Microsoft Graph), Task 11: OFF by default. `isMs365Enabled`
  // reads the SAME `process.env` the rest of this module treats as the environment source
  // (no options field exists for it — Tier 1/Tier 2 env-driven switches all read `process.env`
  // directly, e.g. `readE2eMockLlmBaseUrl` above). With the var unset, `ms365Router` is
  // `undefined` and NOTHING below is constructed or mounted — the baseline is byte-for-byte
  // unaffected. The SAME `ssrf` policy instance built above (line ~105) is reused here; no
  // second SsrfPolicy is created.
  //
  // Device-code auth (Task 3): when `readMs365DeviceConfig` finds `CGHC_MS365_CLIENT_ID` set,
  // build a device-code provider (reusing the SAME `ssrf` policy instance above — no second
  // SsrfPolicy) and pass it into the connector's `device` dep so device-code login is
  // available. When the env vars are absent, no `device` dep is passed and the connector
  // reports `not_configured` for the device-code auth source, matching Task 1's contract.
  const ms365Router = isMs365Enabled(process.env)
    ? await (async () => {
        const ms365Manual = createManualTokenProvider();
        const ms365DeviceConfig = readMs365DeviceConfig(process.env);
        const ms365Device =
          ms365DeviceConfig !== null
            ? createDeviceCodeProvider({
                ssrf,
                config: { clientId: ms365DeviceConfig.clientId, tenant: ms365DeviceConfig.tenant, scopes: MS365_SCOPES },
              })
            : undefined;
        const ms365Connector = createMs365Connector({
          manual: ms365Manual,
          makeGraph: (getToken) => createHttpGraphClient({ ssrf, getToken }),
          ...(ms365Device !== undefined ? { device: ms365Device } : {}),
        });
        const siteScopeStore = await createSiteScopeStore({
          persistence: createSiteScopeFilePersistence(ms365SiteScopeFilePath),
        });
        const siteScope = createSiteScopeService({ connector: ms365Connector, store: siteScopeStore });
        const writeModeStore = await createWriteModeStore({
          persistence: createWriteModeFilePersistence(ms365WriteModeFilePath),
        });
        const sharepoint = createSharePointService({
          connector: ms365Connector,
          files: createWorkspaceLocalFileReader(() => settingsStore.activeWorkspace()?.rootPath),
          siteFilter: { isEnabled: (id) => siteScope.isEnabled(id) },
        });
        const outlook = createOutlookService({ connector: ms365Connector });
        const planner = createPlannerService({ connector: ms365Connector });
        const lists = createListsService({
          connector: ms365Connector,
          siteFilter: { isEnabled: (id) => siteScope.isEnabled(id) },
        });
        const teams = createTeamsService({ connector: ms365Connector });
        // Session gating (P5.5 Task 5, PO decision 2026-07-14): in-memory, NOT persisted —
        // sessions are ephemeral per app run. Only the Microsoft 365 tab registers a session
        // id here (via the route below); every other session is fail-closed in
        // `handleToolCall`.
        const sessionScope = createMs365SessionScope();
        return createMs365Router({
          connector: ms365Connector,
          scopes: MS365_SCOPES,
          siteScope,
          writeMode: writeModeStore,
          sessionScope,
          tools: {
            sharepoint,
            siteScope: { listJoinedSites: () => siteScope.listJoinedSites() },
            outlook,
            planner,
            lists,
            teams,
            connectionState: () => ms365Connector.connectionState(),
            gate: permissionGate,
            now,
            writeMode: () => writeModeStore.mode(),
            sessionAllowed: (sessionId) => sessionScope.isAllowed(sessionId),
          },
        });
      })()
    : undefined;

  const routers = [
    createWorkspaceRouter({
      recent: recentWorkspaces,
      fsProbe: options.workspaceFsProbe ?? nodeFsProbe(),
      existsProbe: options.workspaceExistsProbe ?? nodeExistenceProbe,
      activeWorkspaceRoot: () => {
        const ws = settingsStore.activeWorkspace();
        return ws?.rootPath;
      },
    }),
    createCredentialRouter(credentialService, {
      allowEnvImport: options.allowEnvCredentialImport === true,
    }),
    createSettingsRouter(settingsStore, modelPort, providerProfileStore),
    createProviderRouter(providerPort, modelConfig),
    createProviderProfileRouter({
      profiles: providerProfileStore,
      tester: profileConnectionTester,
      runtimeBridge: profileRuntimeBridge,
      bindCredentialRef: async (_profileId, ref) => {
        // Credential value is stored via /v1/credentials before binding.
        void ref;
      },
      removeCredential: async (_profileId, account) => {
        await credentialStore.delete(account);
      },
    }),
    createPermissionRouter(permissionGate),
    createEvStreamRouter(streamHub),
    createSessionStreamRouter(streamHub),
    // The session boundary: create/list/send-prompt/cancel. Tier 1 mounts it with the honest
    // not-attached SendPrompt so it compiles + errors truthfully without a child; live fills it.
    createSessionRouter(sessionService, options.sendPrompt ?? notAttachedSendPrompt(), {
      assertCreatePrerequisites: (input) => {
        const result = assessProviderReadiness(settingsStore, providerProfileStore, input.model);
        if (!result.ok) {
          throw new SessionRequestError(result.message);
        }
      },
    }),
    createConversationRouter(conversationStore),
    createSkillRouter(skillCatalog),
    createFileReviewRouter({
      activeWorkspaceRoot: () => {
        const ws = settingsStore.activeWorkspace();
        return ws?.rootPath;
      },
    }),
    ...(ms365Router !== undefined ? [ms365Router] : []),
  ];

  const deps: CoworkServiceDeps = {
    scrubber,
    credentialService,
    providerPort,
    modelConfig,
    settingsStore,
    providerProfileStore,
    profileRuntimeBridge,
    recentWorkspaces,
    permissionGate,
    permissionAudit,
    sessionService,
    streamHub,
    extensions,
    conversationStore,
    skillCatalog,
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
async function seedFromSettings(
  store: Awaited<ReturnType<typeof openSettingsStore>>,
  providerPort: ReturnType<typeof createProviderPort>,
  modelConfig: ReturnType<typeof createModelConfigService>,
): Promise<void> {
  const defaultModel = store.defaultModel();
  if (defaultModel !== undefined) {
    modelConfig.configureModel({ scope: "default", model: defaultModel });
  }
  for (const provider of store.listProviderSettings()) {
    if (provider.baseUrl !== undefined) {
      try {
        await providerPort.configureEndpoint(provider.providerId, { baseUrl: provider.baseUrl });
      } catch {
        // A persisted base_url that no longer passes the SSRF policy (e.g. the network's DNS now
        // resolves the hostname to a private address — split-horizon/VPN change) must NOT kill
        // the whole service at boot: that locks the user out of the very Settings screen needed
        // to fix it. Skip seeding this endpoint — the port never receives an unvalidated URL, so
        // the provider honestly surfaces as "not configured/unverified" until the user re-tests
        // or edits it in Settings. The persisted value itself is left untouched, and the
        // credential ref below still seeds so a later re-test in Settings works immediately.
      }
    }
    if (provider.credentialRef !== undefined) {
      providerPort.configureCredential(provider.providerId, provider.credentialRef);
    }
  }
}
