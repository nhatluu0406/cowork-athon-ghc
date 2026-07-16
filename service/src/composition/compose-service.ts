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
import { createKeyringStore, createMemoryStore } from "../credential/index.js";
import {
  createNodeSettingsFs,
  createSettingsRouter,
  openSettingsStore,
  type SettingsFs,
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
import { createMcpRouter, createProcessMcpAdapter, loadMcpServersFromStore } from "../mcp/index.js";
import { createSessionService, createSessionRouter, SessionRequestError } from "../session/index.js";
import {
  createConversationStore,
  createConversationRouter,
  createSqliteConversationStore,
  migrateJsonConversationsToSqlite,
} from "../conversation/index.js";
import type { ConversationStore } from "../conversation/store.js";
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
  createHttpGraphClient,
  createManualTokenProvider,
  createMs365Connector,
  createMs365Router,
  createSharePointService,
  isMs365Enabled,
} from "../ms365/index.js";
import {
  closeSqliteDatabase,
  collectCredentialAccounts,
  createAppMetaRepository,
  createAuthRouter,
  createLocalAuthService,
  createLocalUserRepository,
  createProviderProfileRepository,
  createProviderVerificationRepository,
  createSecretsRepository,
  createSettingsRepository,
  createSqliteMcpStore,
  createSqliteSettingsFs,
  createVaultCredentialStore,
  createVaultKeyRepository,
  migrateJsonSettingsToSqlite,
  migrateKeyringSecretsToVault,
  openSqliteDatabase,
  runMigrations,
  type LocalAuthService,
  type McpStore,
  type SqliteDatabase,
  type VaultCredentialStore,
} from "../db/index.js";
import type { CredentialStore } from "../credential/index.js";

/**
 * Fixed OAuth scopes advertised on the MS365 view/connect surface (Task 8/11). Read-only Files
 * + Sites scopes, matching the SharePoint operations the tool surface exposes (search, list,
 * summary, upload). No extra scope is requested.
 */
const MS365_SCOPES: readonly string[] = ["Files.ReadWrite.All", "Sites.Read.All"];

const DEFAULT_SETTINGS_PATH = ".runtime/settings.json";
const DEFAULT_CONVERSATIONS_DIR = ".runtime/conversations";
const DEFAULT_SKILLS_DIR = ".runtime/skills";
const DEFAULT_SKILLS_STATE_PATH = ".runtime/skills-enabled.json";
const DEFAULT_PERMISSION_TIMEOUT_MS = 120_000;

/**
 * Construct + wire the whole service WITHOUT opening the socket. Async because the settings
 * store loads persisted state and (when configured) the SQLite vault / migration seams bind.
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

  // --- Local SQLite vault (ADR 0007) when dbPath / sqliteDatabase is provided. ---
  let sqliteDatabase: SqliteDatabase | undefined = options.sqliteDatabase;
  let ownsSqlite = false;
  let localAuth: LocalAuthService | undefined;
  let vaultStore: VaultCredentialStore | undefined;
  let settingsFs: SettingsFs;

  if (sqliteDatabase !== undefined || options.dbPath !== undefined) {
    if (sqliteDatabase === undefined) {
      sqliteDatabase = openSqliteDatabase({ filePath: options.dbPath! });
      ownsSqlite = true;
    }
    runMigrations(sqliteDatabase, undefined, now);

    const settingsRepo = createSettingsRepository(sqliteDatabase);
    const profilesRepo = createProviderProfileRepository(sqliteDatabase);
    const verificationsRepo = createProviderVerificationRepository(sqliteDatabase);
    const appMeta = createAppMetaRepository(sqliteDatabase);
    const secretsRepo = createSecretsRepository(sqliteDatabase);
    const usersRepo = createLocalUserRepository(sqliteDatabase);
    const vaultKeysRepo = createVaultKeyRepository(sqliteDatabase);

    if (options.settingsFilePath !== undefined) {
      migrateJsonSettingsToSqlite({
        settingsFilePath: options.settingsFilePath,
        settings: settingsRepo,
        appMeta,
        now,
      });
    }

    localAuth = createLocalAuthService({ users: usersRepo, vaultKeys: vaultKeysRepo, now });
    vaultStore = createVaultCredentialStore({ auth: localAuth, secrets: secretsRepo, now });

    if (options.autoUnlock !== undefined) {
      try {
        await localAuth.unlock(options.autoUnlock.username, options.autoUnlock.password);
      } catch {
        // Leave locked; renderer lock gate will prompt again.
      }
    }

    settingsFs =
      options.settingsFs ??
      createSqliteSettingsFs({
        settings: settingsRepo,
        profiles: profilesRepo,
        verifications: verificationsRepo,
        now,
      });
  } else {
    settingsFs =
      options.settingsFs ?? createNodeSettingsFs(options.settingsFilePath ?? DEFAULT_SETTINGS_PATH);
  }

  // --- The ONE credential store + credential service (shares the single scrubber). ---
  const credentialStore: CredentialStore =
    options.credentialStore ?? vaultStore ?? createMemoryStore();
  const credentialService = createCredentialService({ store: credentialStore, scrubber });

  // --- Settings store (persistent SD1 source of truth), loaded through the fs seam. ---
  let baseSettingsStore = await openSettingsStore({ fs: settingsFs });

  const migration = await migrateLegacySettingsToProfiles(
    baseSettingsStore.snapshot(),
    credentialStore,
  );
  if (migration.migrated || migration.credentialRemapped) {
    await baseSettingsStore.applyDocument(migration.settings);
  }

  const providerProfileStore = createProviderProfileStore({ store: baseSettingsStore, now });

  const runPostUnlockMigration = async (): Promise<void> => {
    if (localAuth === undefined || vaultStore === undefined || sqliteDatabase === undefined) return;
    const appMeta = createAppMetaRepository(sqliteDatabase);
    let legacy: CredentialStore | undefined = options.legacyCredentialStore;
    if (legacy === undefined) {
      try {
        legacy = await createKeyringStore();
      } catch {
        legacy = undefined;
      }
    }
    if (legacy === undefined) return;
    const accounts = collectCredentialAccounts(baseSettingsStore.snapshot());
    await migrateKeyringSecretsToVault({
      auth: localAuth,
      vault: vaultStore,
      legacy,
      appMeta,
      accounts,
    });
  };

  if (localAuth !== undefined && localAuth.masterKey() !== null) {
    await runPostUnlockMigration().catch(() => undefined);
  }

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
  await profileRuntimeBridge.syncActiveProfile();

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

  // --- Runtime-extension layer (CGHC-026): the MCP lifecycle (RE2) gets the Phase 1
  // reachability-probe adapter — never a full MCP protocol client yet (see
  // `createProcessMcpAdapter`); skill EXECUTION stays honest not-attached (that seam is the
  // deprecated Tier 1 exploratory registry — product Skills are `skillCatalog` below). The
  // composed redactor covers RE5 diagnostics; the SAME SSRF policy the provider port uses guards
  // a URL MCP endpoint.
  const extensions = createExtensionRegistry({
    now,
    redact: redactError,
    ssrf,
    mcpAdapter: createProcessMcpAdapter({ ssrf }),
  });

  // --- MCP Phase 1 persistence (Wave 2B): when SQLite is open, persisted servers (non-secret
  // config only; a header secret lives in the ONE credential store, referenced by
  // `mcp_secret_refs`) are replayed into the registry on boot, and the router is mounted below.
  let mcpStore: McpStore | undefined;
  if (sqliteDatabase !== undefined) {
    mcpStore = createSqliteMcpStore(sqliteDatabase);
    await loadMcpServersFromStore(extensions.mcp, mcpStore);
  }

  const modelPort: SettingsModelPort = {
    clearSessionModel: (sessionId) => modelConfig.clearSessionModel(sessionId),
    defaultModelRef: () => modelConfig.activeModelFor(),
  };

  const recentWorkspaces = createRecentWorkspaces();

  const conversationsDir = options.conversationsDir ?? DEFAULT_CONVERSATIONS_DIR;
  let conversationStore: ConversationStore;
  if (sqliteDatabase !== undefined) {
    const appMeta = createAppMetaRepository(sqliteDatabase);
    migrateJsonConversationsToSqlite({
      conversationsDir,
      db: sqliteDatabase,
      appMeta,
    });
    conversationStore = createSqliteConversationStore({
      db: sqliteDatabase,
      appMeta,
      now,
    });
  } else {
    conversationStore = createConversationStore({
      rootDir: conversationsDir,
      now,
    });
  }
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
  const ms365Router = isMs365Enabled(process.env)
    ? (() => {
        const ms365Manual = createManualTokenProvider({ credentials: credentialService });
        const ms365Connector = createMs365Connector({
          manual: ms365Manual,
          makeGraph: (getToken) => createHttpGraphClient({ ssrf, getToken }),
        });
        const sharepoint = createSharePointService({
          connector: ms365Connector,
          files: createWorkspaceLocalFileReader(() => settingsStore.activeWorkspace()?.rootPath),
        });
        return createMs365Router({
          connector: ms365Connector,
          scopes: MS365_SCOPES,
          tools: {
            sharepoint,
            connectionState: () => ms365Connector.connectionState(),
            gate: permissionGate,
            now,
          },
        });
      })()
    : undefined;

  const routers = [
    ...(localAuth !== undefined
      ? [
          createAuthRouter({
            auth: localAuth,
            onUnlocked: runPostUnlockMigration,
            ...(options.rememberUnlock !== undefined
              ? { rememberUnlock: options.rememberUnlock }
              : {}),
          }),
        ]
      : []),
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
    ...(mcpStore !== undefined
      ? [createMcpRouter({ registry: extensions.mcp, store: mcpStore, credentials: credentialStore, now })]
      : []),
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
    ...(mcpStore !== undefined ? { mcpStore } : {}),
    conversationStore,
    skillCatalog,
    redactError,
    ...(localAuth !== undefined ? { localAuth } : {}),
    ...(sqliteDatabase !== undefined ? { sqliteDatabase } : {}),
    buildToolPermissionProxy: (guard) =>
      new ToolPermissionProxy({ guard, gate: permissionGate, reply: runtimeReply, now }),
  };

  return {
    routers,
    deps,
    // The service auto-mounts the (token-guarded) health router itself; we never re-mount it.
    start: async (): Promise<RunningService> => {
      const running = await startService({ ...options, routers });
      if (!ownsSqlite || sqliteDatabase === undefined) return running;
      const db = sqliteDatabase;
      const originalStop = running.service.stop.bind(running.service);
      Object.defineProperty(running.service, "stop", {
        configurable: true,
        value: async () => {
          await originalStop();
          try {
            closeSqliteDatabase(db);
          } catch {
            // Already closed.
          }
        },
      });
      return running;
    },
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
      await providerPort.configureEndpoint(provider.providerId, { baseUrl: provider.baseUrl });
    }
    if (provider.credentialRef !== undefined) {
      providerPort.configureCredential(provider.providerId, provider.credentialRef);
    }
  }
}
