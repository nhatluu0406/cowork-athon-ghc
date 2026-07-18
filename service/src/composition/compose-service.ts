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

import { dirname, join } from "node:path";
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
  createRedactingLogger,
  createFileSink,
  createTelemetryStore,
  recordEventTelemetry,
  createDiagnosticsRouter,
  openSettingsStore,
  type RedactingLogger,
  type TelemetryStore,
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
  readDevLoopbackHttpEscape,
  DEV_LOOPBACK_HTTP_WARNING,
  SsrfBlockedError,
} from "../provider/index.js";
import {
  createProviderConnectionTester,
  createProfileModelDiscovery,
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
  createBranchPermissionBindings,
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
import { createAgentCatalog, createAgentRouter } from "../agents/index.js";
import {
  createTaskStore,
  createTaskRouter,
  createFileEvidenceVerificationHook,
  createWorkflowBuilder,
  createWorkflowRouter,
} from "../tasks/index.js";
import { LIVE_SESSION_PERMISSION_POLICY } from "../runtime/index.js";
import { createFileReviewRouter } from "../file-review/index.js";
import {
  createKnowledgeLocalRepository,
  createKnowledgeLocalRouter,
  createKnowledgeLocalService,
} from "../knowledge-local/index.js";
import {
  createPreviewGate,
  createPreviewService,
  createRuntimePreviewRouter,
  type PreviewService,
} from "../runtime-preview/index.js";
import { createAppService, createRuntimeAppRouter, type AppService } from "../runtime-app/index.js";
import type { TelemetryCounter } from "../diagnostics/telemetry-store.js";
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
  notAttachedBranchRunner,
  notAttachedRuntimeReplyPort,
  notAttachedSendPrompt,
  notAttachedSessionStore,
  notAttachedWorkflowDraftGenerator,
} from "./tier2-seams.js";
import { createDispatchRunRegistry, createDispatchRouter } from "../dispatchers/index.js";
import type { CoworkService, CoworkServiceDeps, CoworkServiceOptions } from "./types.js";
import { createHttpConnectorBundle } from "./http-connector-factory.js";
import { createWorkspaceLocalFileReader } from "./ms365-file-reader.js";
import {
  createHttpGraphClient,
  createManualTokenProvider,
  createMs365Connector,
  createMs365Router,
  createSharePointService,
  createSiteScopeStore,
  createSiteScopeFilePersistence,
  createSiteScopeService,
  createWriteModeStore,
  createWriteModeFilePersistence,
  createOutlookService,
  createPlannerService,
  createListsService,
  createTeamsService,
  createCalendarService,
  createOneDriveService,
  createCommonService,
  createPowerAutomateService,
  createPowerAutomateStore,
  createMs365SessionScope,
  createDeviceCodeProvider,
  readMs365DeviceConfig,
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
import {
  createGatewayService,
  createGatewayRouter,
  createNodeGatewayStoreFs,
  openGatewayStore,
  createGatewayProxyServer,
  type ProxyRequestOutcome,
} from "../gateway/index.js";

/**
 * Fixed OAuth scopes advertised on the MS365 view/connect surface (Task 8/11), matching the
 * Graph operations the tool surface exposes. `Files.ReadWrite.All` covers SharePoint + OneDrive
 * files (search/list/summary/upload, incl. `/me/drive` reads); `Sites.Read.All` the site reads;
 * `Calendars.ReadWrite` the calendar list/search/create; `User.Read.All` the `resolve_user`
 * `/users` lookup; `User.Read` the `get_me` `/me` identity; `MailboxSettings.Read` the best-effort
 * `/me/mailboxSettings` time-zone read. Power Automate trigger is a plain webhook (no Graph
 * scope). No extra scope is requested.
 */
const MS365_SCOPES: readonly string[] = [
  "Files.ReadWrite.All",
  "Sites.Read.All",
  "Calendars.ReadWrite",
  "User.Read.All",
  "User.Read",
  "MailboxSettings.Read",
];

const DEFAULT_SETTINGS_PATH = ".runtime/settings.json";
const DEFAULT_CONVERSATIONS_DIR = ".runtime/conversations";
const DEFAULT_SKILLS_DIR = ".runtime/skills";
const DEFAULT_SKILLS_STATE_PATH = ".runtime/skills-enabled.json";
const DEFAULT_AGENTS_PATH = ".runtime/agents.json";
const DEFAULT_TASKS_PATH = ".runtime/tasks.json";
const DEFAULT_MS365_SITE_SCOPE_PATH = ".runtime/ms365-site-scope.json";
const DEFAULT_MS365_WRITE_MODE_PATH = ".runtime/ms365-write-mode.json";
const DEFAULT_PERMISSION_TIMEOUT_MS = 120_000;

/**
 * Construct + wire the whole service WITHOUT opening the socket. Async because the settings
 * store loads persisted state and (when configured) the SQLite vault / migration seams bind.
 */
export async function createCoworkService(
  options: CoworkServiceOptions = {},
): Promise<CoworkService> {
  const now = options.now ?? (() => new Date().toISOString());
  // Redacted, non-secret boot diagnostics (LOW-1 from the 2026-07-16 SSRF-brick review):
  // a skipped persisted endpoint must leave a trace, never a silent swallow.
  const bootDiagnostic =
    options.onBootDiagnostic ?? ((line: string) => console.warn(`[cowork-service] ${line}`));

  // --- Cross-cutting: the ONE value-based scrubber + the composed EV redactor. ---
  // Composition = value-based scrub (real seeded key values) THEN shape sanitize. The scrubber
  // learns a credential VALUE when it is stored (router POST) or resolved at launch, so
  // value-based redaction is ACTIVE for every credential that passes through the credential layer.
  const scrubber = createSecretScrubber();

  // --- Local structured logging (Wave 6). A bounded, rotating, JSON-lines file sink under
  // `data/logs` (derived from dbPath so the service never imports the shell path resolver — the
  // import-direction rule). The logger scrubs every message/field through the SAME scrubber before
  // the sink, so no secret can reach disk. Verbose (debug) is applied from settings once loaded and
  // updated live when the toggle changes; error/warn/info always emit. Console-only when there is no
  // dbPath (unit tests) or when a file sink cannot be created.
  const logDir =
    options.logDir ??
    (options.dbPath !== undefined ? join(dirname(options.dbPath), "logs") : undefined);
  const fileSink = logDir !== undefined ? createFileSink({ dir: logDir }) : undefined;
  const logger: RedactingLogger = createRedactingLogger({
    scrubber,
    ...(fileSink !== undefined ? { sink: fileSink.sink } : {}),
  });
  // Local aggregate telemetry (Wave 6). Assigned once the SQLite database + persisted setting are
  // available (below); referenced early here so the error counter can ride the redaction seam.
  let telemetry: TelemetryStore | undefined;

  // Route the boundary error-redaction seam through the logger so redacted errors are persisted
  // locally (still returned to callers for renderer display, unchanged), and count an aggregate
  // error (no content — just a tally, and only when telemetry is enabled).
  const redactError = (message: string): string => {
    const scrubbed = sanitizeErrorMessage(scrubber.scrub(message));
    logger.error(scrubbed);
    telemetry?.increment("errors");
    return scrubbed;
  };

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

  // --- Gateway service: manages named API-key accounts across providers. ---
  // `gateway.json` lives next to `settings.json` — NOT a hardcoded relative ".runtime", which
  // would resolve against whatever `process.cwd()` happens to be for a given composition
  // (Tier 1 settings-only vs Tier 2 live can differ), silently splitting reads/writes across
  // two different files. Settings' path is already resolved to an absolute, packaged-safe
  // location by the shell (see main.ts) — anchor to the SAME directory for consistency.
  const gatewayDataDir = dirname(options.settingsFilePath ?? DEFAULT_SETTINGS_PATH);
  const gatewayStoreFs = createNodeGatewayStoreFs(gatewayDataDir);
  const gatewayStore = await openGatewayStore(gatewayStoreFs);
  // Set once the proxy below has actually bound (or failed to). Read by `gatewayService` via
  // closure — declared before assignment is safe since `isProxyAvailable` is only ever CALLED
  // from a later user action (setEnabled), never during this synchronous setup.
  let gatewayProxyAvailable = false;
  const gatewayService = createGatewayService({
    store: gatewayStore,
    storeCredential: (account, key) =>
      credentialService.store({ providerId: "gateway", account, secret: key }),
    removeCredential: (ref) => credentialService.remove(ref).then(() => undefined),
    hasCredential: (ref) => credentialService.has(ref),
    generateId: () => crypto.randomUUID(),
    now,
    // `providerProfileStore` is declared further below in this same function — safe via
    // closure since none of these are CALLED until well after that line has run.
    getProfileBaseUrl: (profileId) => providerProfileStore.get(profileId)?.baseUrl,
    setProfileBaseUrl: async (profileId, baseUrl) => {
      await providerProfileStore.update(profileId, { baseUrl });
    },
    getActiveProfileId: () => providerProfileStore.activeProfileId(),
    isProxyAvailable: () => gatewayProxyAvailable,
  });

  // --- Gateway proxy: the REAL interception point (service/src/gateway/proxy-server.ts).
  // OpenCode's opencode.json baseURL points here for any profile the Gateway checklist has
  // routed — this process, not a bolted-on session-boundary check, is what "Gateway" means.
  // Bound to a fixed loopback port regardless of enabled state; it simply never receives
  // traffic for a profile that hasn't been routed to it (see gateway-service.ts's baseUrl swap).
  const gatewayProxy = createGatewayProxyServer({
    resolveUpstream: () => gatewayService.resolveProxyUpstream(),
    ...(options.gatewayProxyPort !== undefined ? { port: options.gatewayProxyPort } : {}),
    onRequestComplete: (outcome: ProxyRequestOutcome) => {
      // The proxy still FORWARDS this request when the master switch is OFF (a stale,
      // already-proxy-pointed OpenCode child keeps working without a restart — see
      // `resolveProxyUpstream`), but OFF means Gateway is not managing/observing traffic
      // anymore, only transparently passing it through. Logging it would contradict that: no
      // bookkeeping while OFF, matching the master toggle's own contract.
      if (!gatewayService.isEnabled()) return;
      const activeProfile = providerProfileStore.activeProfile();
      const profileId = activeProfile?.id;
      const accountId =
        profileId !== undefined ? gatewayService.getStatus().activeByProvider[profileId] : undefined;
      void gatewayService
        .recordRequest({
          gatewayEnabled: gatewayService.isEnabled(),
          outcome: outcome.httpStatus < 400 ? "allowed" : "blocked",
          httpStatus: outcome.httpStatus,
          ttfbMs: outcome.ttfbMs,
          totalMs: outcome.totalMs,
          ...(profileId !== undefined ? { profileId } : {}),
          ...(activeProfile !== undefined ? { profileLabel: activeProfile.displayName } : {}),
          ...(activeProfile !== undefined ? { providerType: activeProfile.providerType } : {}),
          ...(accountId !== undefined ? { accountId } : {}),
          ...(outcome.modelId !== undefined ? { modelId: outcome.modelId } : {}),
          ...(outcome.promptPreview !== undefined ? { promptPreview: outcome.promptPreview } : {}),
          ...(outcome.errorMessage !== undefined ? { reason: outcome.errorMessage } : {}),
        })
        .catch(() => undefined);
    },
  });
  // Start the proxy NOW (before `seedFromSettings`/`syncActiveProfile` below re-apply a persisted,
  // possibly gateway-swapped baseUrl through the SSRF-gated provider port) rather than deferring to
  // the returned `start()`. A bind failure degrades honestly (Gateway proxy stays unavailable;
  // `gatewayService`/the UI can surface it) instead of aborting the whole composition — this is an
  // optional subsystem, not a hard boot dependency.
  try {
    await gatewayProxy.start();
    gatewayProxyAvailable = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bootDiagnostic(`gateway_proxy_start_failed: ${message}`);
  }

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
  // Developer-only loopback-http override (never gated by the release hard-assert — see
  // ../provider/dev-loopback-http.js). Resolved ONCE here (process env, the composition root)
  // and threaded to every `createSsrfPolicy` construction site below; never re-read from env in
  // a scattered spot, and NEVER sourced from a request body (router.ts keeps ignoring such a
  // field). Unset ⇒ `false` ⇒ every site below is byte-for-byte identical to before this change.
  const devLoopbackHttpEscape = readDevLoopbackHttpEscape();
  if (devLoopbackHttpEscape) {
    // The banner IS the required WARN + local boot-diagnostic/audit event (bootDiagnostic is the
    // existing redacted, non-secret audit sink for this composition root) — no parallel log path.
    bootDiagnostic(DEV_LOOPBACK_HTTP_WARNING);
  }
  const ssrf = createSsrfPolicy({
    resolver: dnsResolver,
    ...(e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl } : {}),
    ...(devLoopbackHttpEscape ? { loopbackEscape: true } : {}),
  });

  // --- Provider port: real HTTP probe connector for onboarding test-connection (CGHC-011). ---
  const httpBundle =
    options.connector === undefined
      ? createHttpConnectorBundle(credentialService, baseSettingsStore, dnsResolver, devLoopbackHttpEscape)
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
  await seedFromSettings(baseSettingsStore, providerPort, modelConfig, bootDiagnostic);

  const profileRuntimeBridge = createProfileRuntimeBridge({
    profiles: providerProfileStore,
    port: providerPort,
    modelConfig,
  });
  // Boot must survive a persisted active profile the SSRF policy refuses (same degradation
  // contract as seedFromSettings below): the endpoint stays unconfigured; the user repairs it
  // in settings. Runtime profile switches still surface the typed refusal via the router.
  try {
    await profileRuntimeBridge.syncActiveProfile();
  } catch (err) {
    if (!(err instanceof SsrfBlockedError)) throw err;
    bootDiagnostic(`boot_active_profile_endpoint_skipped (${err.reason})`);
  }

  const profileConnectionTester = createProviderConnectionTester({
    credentials: credentialService,
    dnsResolver,
    now,
    ...(e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl } : {}),
    ...(devLoopbackHttpEscape ? { loopbackEscape: true } : {}),
  });

  const profileModelDiscovery = createProfileModelDiscovery({
    credentials: credentialService,
    dnsResolver,
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

  // Detailed (verbose/debug) logging is a user setting. Apply it now and keep it live: intercept
  // `updateGeneral` so toggling "Ghi log chi tiết" in Settings takes effect immediately without a
  // relaunch. (Telemetry enable is wired into this same seam in the telemetry slice.)
  logger.setVerbose(settingsStore.general().verboseLogging === true);

  // Local aggregate telemetry: only when a SQLite database is open (the counters table lives there,
  // migration id 3). Collection is gated by the persisted `telemetryEnabled` setting; disabled →
  // increment is a no-op. Count one app launch on boot (when enabled).
  if (sqliteDatabase !== undefined) {
    telemetry = createTelemetryStore({
      db: sqliteDatabase,
      enabled: settingsStore.general().telemetryEnabled === true,
      now,
    });
    telemetry.increment("app_launches");
  }

  const baseUpdateGeneral = settingsStore.updateGeneral.bind(settingsStore);
  settingsStore.updateGeneral = async (patch) => {
    const next = await baseUpdateGeneral(patch);
    // Toggles take effect immediately (no relaunch): verbose logging + telemetry collection.
    logger.setVerbose(next.verboseLogging === true);
    telemetry?.setEnabled(next.telemetryEnabled === true);
    return next;
  };

  // --- Session service (Tier 2 store/health seams) + live stream hub bound to it. ---
  // Resolve the runtime-health seam once so the built-in /v1/health route can honestly report
  // `runtimeReady` (Tier 1 → downRuntimeHealth → false; live → supervisor.isAlive()).
  const runtimeHealthSeam = options.runtimeHealth ?? downRuntimeHealth();
  const sessionService = createSessionService({
    store: options.sessionStore ?? notAttachedSessionStore(),
    health: runtimeHealthSeam,
    canceller: providerPort,
    now,
    redactError,
  });
  const streamHub = createSessionStreamHub({
    apply: (sessionId, event) => {
      // Aggregate-only telemetry from the ALREADY-NORMALIZED EV stream (never raw frames): terminal
      // state → turn completed/failed, file_mutation → created/modified/deleted. Structural facts
      // only; no path/content is inspected. No-op unless telemetry is enabled.
      if (telemetry !== undefined) recordEventTelemetry(telemetry, event);
      return sessionService.apply(sessionId, event);
    },
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
  // Aggregate telemetry: count each FRESH permission decision once (the user's allow/deny). Uses the
  // decision the caller supplied; no request path/tool detail is recorded.
  const basePermissionResolve = permissionGate.resolve.bind(permissionGate);
  permissionGate.resolve = async (input) => {
    const outcome = await basePermissionResolve(input);
    if (telemetry !== undefined && outcome.status === "resolved") {
      telemetry.increment(input.decision === "allow" ? "permission_approved" : "permission_denied");
    }
    return outcome;
  };

  // --- Runtime preview (Code surface): bounded process runner for static / dev-server web
  // preview. It gets its OWN permission gate (no-op reply/session sinks — a user-initiated
  // launch has no OpenCode runtime to reply to — but the SHARED audit sink, so every launch
  // Allow/Deny is recorded). Enforcement is identical: the command runs only inside the gate's
  // `proceed`. Single owner of the one preview process; torn down on workspace change + shutdown.
  const previewGate = createPreviewGate({
    audit: permissionAudit,
    scheduler: createNodeScheduler(),
    now,
  });
  const previewService: PreviewService = createPreviewService({
    getActiveRoot: () => settingsStore.activeWorkspace()?.rootPath,
    gate: previewGate,
    scrubber,
    ...(telemetry !== undefined
      ? { telemetry: (counter: string) => telemetry.increment(counter as TelemetryCounter) }
      : {}),
    log: (line: string) => logger.debug(line),
  });

  // --- Runtime desktop-app launch (Code surface Slice 2): reuses the SAME bounded process-runner
  // primitives and a preview-style permission gate (own gate instance, shared audit). Launches
  // the app as its own separate process/window (never embedded). Single owner; torn down on
  // workspace change + shutdown alongside the preview.
  const appGate = createPreviewGate({
    audit: permissionAudit,
    scheduler: createNodeScheduler(),
    now,
  });
  const appService: AppService = createAppService({
    getActiveRoot: () => settingsStore.activeWorkspace()?.rootPath,
    gate: appGate,
    scrubber,
    ...(telemetry !== undefined
      ? { telemetry: (counter: string) => telemetry.increment(counter as TelemetryCounter) }
      : {}),
    log: (line: string) => logger.debug(line),
  });

  // D1 fix: the ONE session→preset registry a dispatch branch binds before its first prompt
  // (live-branch-runner, via `deps.branchPermissionBindings` below) and `buildToolPermissionProxy`
  // reads from at the SAME execution boundary every other tool-permission event flows through —
  // never a second permission authority, only a narrowing input to `permissionGate` above.
  const branchPermissionBindings = createBranchPermissionBindings();

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

  // --- Agent catalog + Task store (agent-harness-plan.md Task 5.1 / 4.1). Built-ins are always
  // present; user definitions persist as one JSON doc each. Agent presets can only NARROW the live
  // session policy (validated in the catalog); tasks validate agent/branch references against the
  // CURRENT agent catalog. Both use the single-file settings-fs seam (injectable for tests).
  const agentCatalog = await createAgentCatalog({
    fs: options.agentStoreFs ?? createNodeSettingsFs(options.agentStoreFilePath ?? DEFAULT_AGENTS_PATH),
    basePolicy: LIVE_SESSION_PERMISSION_POLICY,
  });
  const taskStore = await createTaskStore({
    fs: options.taskStoreFs ?? createNodeSettingsFs(options.taskStoreFilePath ?? DEFAULT_TASKS_PATH),
    knownAgentIds: () => agentCatalog.knownIds(),
  });

  // Dispatch runs (Task 5.2 wiring): loop-runner over fan-out groups. Tier 1 mounts the router
  // with the honest not-attached branch runner (a branch errors truthfully without a child);
  // the live composition injects the real session-backed runner. The `retry_until_verified`
  // verification hook (dispatch-verify-hook-retry-until-verified) reads each attempt's declared
  // `evidencePaths` and confirms them on disk via the file-review snapshot primitive — Tier 1's
  // not-attached branch runner never claims evidence, so a `retry_until_verified` task here ends
  // `exhausted` honestly (never a fabricated `completed`); the live branch runner (compose-live)
  // supplies real evidence from the session's recorded file mutations.
  const dispatchRuns = createDispatchRunRegistry({
    resolveAgent: (id) => agentCatalog.get(id),
    runBranch: options.branchRunner ?? notAttachedBranchRunner(),
    verify: createFileEvidenceVerificationHook({
      workspaceRoot: () => settingsStore.activeWorkspace()?.rootPath,
    }),
    now,
  });

  // Workflow builder from prompt (Task 4.3): draft-only, MANDATORY contract validation, never
  // auto-run. Tier 1 wires the honest not-attached generator (a draft request rejects rather than
  // fabricating a TaskDefinition); the confirm route re-validates through the SAME agent
  // catalog / task store boundaries used by every other write path.
  const workflowBuilder = createWorkflowBuilder({
    generate: options.workflowDraftGenerator ?? notAttachedWorkflowDraftGenerator(),
    knownAgentIds: () => agentCatalog.knownIds(),
    basePolicy: LIVE_SESSION_PERMISSION_POLICY,
  });

  // --- MS365 (SharePoint over Microsoft Graph): the router mounts UNCONDITIONALLY. The former
  // `CGHC_MS365_ENABLED` env gate has been removed; there is no default-OFF switch. NOTE: this is a
  // local flag-removal only — it is NOT the team-level D2 boundary merge described in CLAUDE.md.
  // The SAME `ssrf` policy instance built above is reused here; no second SsrfPolicy is created.
  const ms365Router = await (async () => {
    const ms365Manual = createManualTokenProvider();
    const ms365DeviceConfig = readMs365DeviceConfig(process.env);
    const ms365Device =
      ms365DeviceConfig !== null
        ? createDeviceCodeProvider({
            ssrf,
            config: {
              clientId: ms365DeviceConfig.clientId,
              tenant: ms365DeviceConfig.tenant,
              scopes: MS365_SCOPES,
            },
          })
        : undefined;
    const ms365Connector = createMs365Connector({
      manual: ms365Manual,
      makeGraph: (getToken) => createHttpGraphClient({ ssrf, getToken }),
      ...(ms365Device !== undefined ? { device: ms365Device } : {}),
    });
    const siteScopeStore = await createSiteScopeStore({
      persistence: createSiteScopeFilePersistence(DEFAULT_MS365_SITE_SCOPE_PATH),
    });
    const siteScope = createSiteScopeService({ connector: ms365Connector, store: siteScopeStore });
    const writeModeStore = await createWriteModeStore({
      persistence: createWriteModeFilePersistence(DEFAULT_MS365_WRITE_MODE_PATH),
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
    const calendar = createCalendarService({ connector: ms365Connector });
    const onedrive = createOneDriveService({ connector: ms365Connector });
    const common = createCommonService({ connector: ms365Connector });
    // A Power Automate flow trigger URL embeds a SAS `sig` — it is a bearer SECRET, so it must
    // NOT be persisted to plaintext JSON (vault invariant). No flow-configuration UI/route wires
    // `setFlows` today, so the store stays in-memory (empty by default); `trigger_flow` works by
    // direct URL regardless. When a flow-config surface lands, persist URLs in the vault (the
    // `mcp:<id>:header` pattern), never plaintext on disk.
    const powerAutomateStore = await createPowerAutomateStore({
      persistence: { load: async () => null, save: async () => {} },
    });
    // Power Automate trigger is a plain webhook POST — the SAME `ssrf` policy the provider port
    // and Graph client use guards a user-configured flow URL, and the fetch is IP-pinned + host-
    // allowlisted (Logic Apps only) before it is ever sent (see power-automate-service.ts).
    const powerAutomate = createPowerAutomateService({ store: powerAutomateStore, ssrf });
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
        calendar,
        onedrive,
        powerAutomate,
        common,
        connectionState: () => ms365Connector.connectionState(),
        gate: permissionGate,
        now,
        writeMode: () => writeModeStore.mode(),
        sessionAllowed: (sessionId) => sessionScope.isAllowed(sessionId),
      },
    });
  })();

  // Local Knowledge Base + Graph (MVP) — only when the SQLite DB is present. Scoped to the active
  // workspace; purely local (no network, no embeddings).
  const knowledgeLocalService =
    sqliteDatabase !== undefined
      ? createKnowledgeLocalService({
          repo: createKnowledgeLocalRepository(sqliteDatabase),
          activeWorkspaceRoot: () => settingsStore.activeWorkspace()?.rootPath,
          now,
        })
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
    createSettingsRouter(settingsStore, modelPort, providerProfileStore, (_rootPath) => {
      // Workspace changed → tear down any preview / desktop app confined to the previous workspace.
      void previewService.dispose("workspace_changed");
      void appService.dispose("workspace_changed");
    }),
    createProviderRouter(providerPort, modelConfig),
    createProviderProfileRouter({
      profiles: providerProfileStore,
      tester: profileConnectionTester,
      discovery: profileModelDiscovery,
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
        // Gateway enforcement + logging happen for real now, in the Gateway HTTP proxy itself
        // (service/src/gateway/proxy-server.ts) — the actual point every routed profile's
        // traffic physically passes through. There is no session-boundary shortcut check here
        // anymore: a profile that hasn't been routed to the proxy was never gated by Gateway in
        // the first place, so a check at this layer would gate traffic Gateway never even sees.
      },
    }),
    createConversationRouter(conversationStore, providerProfileStore, credentialService),
    createSkillRouter(skillCatalog),
    createAgentRouter(agentCatalog),
    createTaskRouter(taskStore),
    createWorkflowRouter({ builder: workflowBuilder, tasks: taskStore, agents: agentCatalog }),
    createDispatchRouter({ runs: dispatchRuns, tasks: taskStore }),
    createFileReviewRouter({
      activeWorkspaceRoot: () => {
        const ws = settingsStore.activeWorkspace();
        return ws?.rootPath;
      },
    }),
    ...(knowledgeLocalService !== undefined
      ? [createKnowledgeLocalRouter(knowledgeLocalService)]
      : []),
    createRuntimePreviewRouter(previewService),
    createRuntimeAppRouter(appService),
    createDiagnosticsRouter({
      logger,
      ...(fileSink !== undefined ? { fileSink } : {}),
      ...(telemetry !== undefined ? { telemetry } : {}),
      scrubber,
      now,
    }),
    ...(mcpStore !== undefined
      ? [createMcpRouter({ registry: extensions.mcp, store: mcpStore, credentials: credentialStore, now })]
      : []),
    ...(ms365Router !== undefined ? [ms365Router] : []),
    createGatewayRouter(gatewayService),
    ...(options.extraRouters ?? []),
  ];

  logger.info("service composed", { logging: logDir !== undefined ? "file" : "console" });

  const deps: CoworkServiceDeps = {
    scrubber,
    logger,
    ...(telemetry !== undefined ? { telemetry } : {}),
    credentialService,
    providerPort,
    modelConfig,
    settingsStore,
    providerProfileStore,
    profileRuntimeBridge,
    recentWorkspaces,
    permissionGate,
    permissionAudit,
    previewService,
    appService,
    branchPermissionBindings,
    sessionService,
    streamHub,
    extensions,
    ...(mcpStore !== undefined ? { mcpStore } : {}),
    conversationStore,
    skillCatalog,
    agentCatalog,
    taskStore,
    dispatchRuns,
    redactError,
    ...(localAuth !== undefined ? { localAuth } : {}),
    ...(sqliteDatabase !== undefined ? { sqliteDatabase } : {}),
    buildToolPermissionProxy: (guard) =>
      new ToolPermissionProxy({
        guard,
        gate: permissionGate,
        reply: runtimeReply,
        now,
        branchPreset: (sessionId) => branchPermissionBindings.presetFor(sessionId),
      }),
    gatewayService,
  };

  return {
    routers,
    deps,
    // The service auto-mounts the (token-guarded) health router itself; we never re-mount it.
    start: async (): Promise<RunningService> => {
      const running = await startService({
        ...options,
        routers,
        runtimeReady: () => runtimeHealthSeam.isAlive(),
      });
      // The gateway proxy is a SEPARATE loopback server (not one of `routers`, since OpenCode —
      // not the renderer — is its caller), already started above (before `seedFromSettings` /
      // `syncActiveProfile` could re-validate a persisted, gateway-swapped baseUrl through the
      // SSRF-gated provider port). Tied to the SAME start/stop lifecycle so a settings-only →
      // live tier transition releases the port before the next tier binds it.
      const originalStopForProxy = running.service.stop.bind(running.service);
      Object.defineProperty(running.service, "stop", {
        configurable: true,
        value: async () => {
          await originalStopForProxy();
          await gatewayProxy.stop().catch(() => undefined);
        },
      });
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
  bootDiagnostic: (line: string) => void,
): Promise<void> {
  const defaultModel = store.defaultModel();
  if (defaultModel !== undefined) {
    modelConfig.configureModel({ scope: "default", model: defaultModel });
  }
  for (const provider of store.listProviderSettings()) {
    if (provider.baseUrl !== undefined) {
      // A persisted endpoint the SSRF policy refuses must not abort startup (it bricked the
      // app: even the settings-only onboarding tier died, so the user could never repair the
      // config). Degrade to "endpoint not configured"; the policy still blocks it everywhere
      // at runtime, and the provider UI shows the unconfigured state honestly.
      try {
        await providerPort.configureEndpoint(provider.providerId, { baseUrl: provider.baseUrl });
      } catch (err) {
        if (!(err instanceof SsrfBlockedError)) throw err;
        bootDiagnostic(`boot_provider_endpoint_skipped: ${provider.providerId} (${err.reason})`);
      }
    }
    if (provider.credentialRef !== undefined) {
      providerPort.configureCredential(provider.providerId, provider.credentialRef);
    }
  }
}
