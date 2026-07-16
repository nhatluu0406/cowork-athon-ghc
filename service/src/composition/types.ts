/**
 * Option + dependency types for the Cowork GHC composition root (Tier 1 assembly).
 *
 * {@link CoworkServiceOptions} carries the bind options plus injectable seams. Every Tier 1
 * seam defaults to a REAL in-process implementation; the Tier 2 runtime seams default to the
 * honest not-attached doubles in `tier2-seams.ts`. {@link CoworkServiceDeps} exposes the wired
 * singletons so the shell/tests can drive them and the live supervisor (CGHC-028) can attach.
 */

import type { ServiceOptions } from "../server/http-service.js";
import type { RunningService } from "../start.js";
import type { BoundaryRouter } from "../boundary/contract.js";
import type { CredentialStore } from "../credential/index.js";
import type { CredentialService } from "../credential/index.js";
import type { RedactingLogger, SecretScrubber } from "../diagnostics/index.js";
import type { SettingsFs, SettingsStore } from "../diagnostics/index.js";
import type {
  DnsResolver,
  ModelConfigService,
  ProviderConnector,
  ProviderPort,
} from "../provider/index.js";
import type { WorkspaceFsProbe, RecentExistenceProbe, RecentWorkspaces } from "../workspace/index.js";
import type { WorkspaceGuard } from "../workspace/index.js";
import type { PermissionGate, RuntimeReplyPort, InMemoryAuditSink } from "../permission/index.js";
import type { ToolPermissionProxy } from "../files/index.js";
import type { SessionService, RuntimeHealth, SessionStore, SendPrompt } from "../session/index.js";
import type { ConversationStore } from "../conversation/index.js";
import type { SessionStreamHub } from "../server/session-stream-hub.js";
import type { ExtensionRegistry } from "../extensions/index.js";
import type { SkillCatalog, SkillRoot } from "../skills/index.js";
import type { AgentCatalog } from "../agents/index.js";
import type { TaskStore } from "../tasks/index.js";
import type { McpStore } from "../db/index.js";
import type { ProviderProfileStore } from "../provider-profiles/provider-profile-store.js";
import type { ProfileRuntimeBridge } from "../provider-profiles/profile-runtime-bridge.js";
import type { LocalAuthService, SqliteDatabase } from "../db/index.js";

export interface CoworkServiceOptions extends ServiceOptions {
  // ---- Tier 1 seams (default: real in-process implementations) ----
  /**
   * Absolute path to the service-owned SQLite database (ADR 0007).
   * When set, settings + encrypted secrets live in SQLite and local app lock is required.
   * Default for the packaged shell: `<userData>/cowork-ghc.db`.
   */
  readonly dbPath?: string;
  /**
   * Optional pre-opened SQLite database (tests inject `:memory:`). Takes precedence over
   * {@link dbPath} when both are present. Caller retains close responsibility when injecting.
   */
  readonly sqliteDatabase?: SqliteDatabase;
  /**
   * Directory for local structured log files (Wave 6). Default: `<dirname(dbPath)>/logs` when a
   * database path is set; console-only otherwise. Tests inject a temp dir.
   */
  readonly logDir?: string;
  /** Persistence seam for the settings store. Default: node fs or SQLite when {@link dbPath} is set. */
  readonly settingsFs?: SettingsFs;
  /** Settings file path when {@link settingsFs} is not supplied. Default: `.runtime/settings.json`. */
  readonly settingsFilePath?: string;
  /**
   * Directory for persisted conversation records (user-data). Default: `.runtime/conversations`
   * relative to cwd when not set by the shell.
   */
  readonly conversationsDir?: string;
  /** Explicit, bounded roots scanned one directory deep for local Skills. */
  readonly skillRoots?: readonly SkillRoot[];
  /** Persisted global-local enabled registry. Default: `.runtime/skills-enabled.json`. */
  readonly skillsStateFilePath?: string;
  /** Persistence seam for user AgentDefinitions. Default: node fs at {@link agentStoreFilePath}. */
  readonly agentStoreFs?: SettingsFs;
  /** User-agents file path when {@link agentStoreFs} is not supplied. Default: `.runtime/agents.json`. */
  readonly agentStoreFilePath?: string;
  /** Persistence seam for user TaskDefinitions. Default: node fs at {@link taskStoreFilePath}. */
  readonly taskStoreFs?: SettingsFs;
  /** User-tasks file path when {@link taskStoreFs} is not supplied. Default: `.runtime/tasks.json`. */
  readonly taskStoreFilePath?: string;
  /**
   * The ONE credential store. Default: encrypted SQLite vault when a database is open;
   * otherwise tests inject the memory store. Legacy keyring is used only as a migration source.
   */
  readonly credentialStore?: CredentialStore;
  /**
   * Legacy credential source for one-time keyring → vault migration after unlock.
   * Tests inject a memory store; production opens keyring when still present.
   */
  readonly legacyCredentialStore?: CredentialStore;
  /**
   * Auto-unlock the local vault at composition (shell main only). Never log or persist.
   * Used to restore unlock across settings-only → live service restart in the same process.
   */
  readonly autoUnlock?: { readonly username: string; readonly password: string };
  /**
   * Called after a successful setup/unlock with the plaintext password (shell main only).
   * Used to re-unlock after live restart. Never log or persist to disk.
   */
  readonly rememberUnlock?: (username: string, password: string) => void;
  /** Workspace validation fs probe. Default: the real `node:fs` probe. */
  readonly workspaceFsProbe?: WorkspaceFsProbe;
  /** Recent-workspace existence probe. Default: the real `node:fs` probe. */
  readonly workspaceExistsProbe?: RecentExistenceProbe;
  /** DNS resolver for the SSRF policy. Default: `node:dns`. Tests inject a deterministic fake. */
  readonly dnsResolver?: DnsResolver;
  /** Injectable clock. Default: `() => new Date().toISOString()`. */
  readonly now?: () => string;
  /** Permission fail-closed timeout (P6) in ms. Default: 120000. */
  readonly permissionTimeoutMs?: number;

  /** Allow POST /v1/credentials/import-env (development / verification only). Default: false. */
  readonly allowEnvCredentialImport?: boolean;

  // ---- Tier 2 seams (default: honest not-attached doubles; CGHC-028 fills these) ----
  /**
   * Provider wire probe/cancel. Default: real HTTP probe connector (CGHC-011 onboarding).
   * Tests may inject a fake; live streaming may replace cancel later (CGHC-028).
   */
  readonly connector?: ProviderConnector;
  /** Outbound runtime permission-reply port. Default: rejects with RuntimeNotAttachedError. */
  readonly runtimeReply?: RuntimeReplyPort;
  /** Supervised-child liveness. Default: `isAlive()` returns false. */
  readonly runtimeHealth?: RuntimeHealth;
  /** OpenCode session store seam. Default: every method throws RuntimeNotAttachedError. */
  readonly sessionStore?: SessionStore;
  /**
   * Prompt-dispatch seam the session router POSTs a prompt through. Default: rejects with
   * RuntimeNotAttachedError so the message route honestly reports `runtime_not_attached`.
   */
  readonly sendPrompt?: SendPrompt;

  /**
   * Extra token-guarded routers mounted after the built-ins (e.g. the flag-gated `/v1/remote`
   * control surface wired by `compose-live`). Empty by default — the baseline is unchanged.
   */
  readonly extraRouters?: readonly BoundaryRouter[];
}

/** The wired singletons exposed for the shell, tests, and the Tier 2 live supervisor to attach. */
export interface CoworkServiceDeps {
  readonly scrubber: SecretScrubber;
  /** The local structured logger (redacting; file sink under data/logs when packaged). */
  readonly logger: RedactingLogger;
  readonly credentialService: CredentialService;
  readonly providerPort: ProviderPort;
  readonly modelConfig: ModelConfigService;
  readonly settingsStore: SettingsStore;
  readonly providerProfileStore: ProviderProfileStore;
  readonly profileRuntimeBridge: ProfileRuntimeBridge;
  readonly recentWorkspaces: RecentWorkspaces;
  readonly permissionGate: PermissionGate;
  readonly permissionAudit: InMemoryAuditSink;
  readonly sessionService: SessionService;
  readonly streamHub: SessionStreamHub;
  /** Local app lock + in-memory vault master key (absent when no SQLite database). */
  readonly localAuth?: LocalAuthService;
  /** Open SQLite handle when {@link CoworkServiceOptions.dbPath} / sqliteDatabase is used. */
  readonly sqliteDatabase?: SqliteDatabase;
  /** File-backed conversation index (session management slice). */
  readonly conversationStore: ConversationStore;
  /** Service-owned local Skill discovery, validation, enabled state, and snapshots. */
  readonly skillCatalog: SkillCatalog;
  /** Built-in + user AgentDefinition catalog (agent-harness-plan.md Task 5.1). */
  readonly agentCatalog: AgentCatalog;
  /** Persisted TaskDefinition store (agent-harness-plan.md Task 4.1). */
  readonly taskStore: TaskStore;
  /**
   * The runtime-extension layer (CGHC-026): skill registry (RE1), MCP lifecycle (RE2), workflow
   * templates (RE4) over ONE extension-state source of truth with RE5 failure isolation. Wired
   * with honest not-attached seams (live skill execution / a live MCP process are Tier 2 /
   * CGHC-028); no HTTP router is mounted for this POC.
   */
  readonly extensions: ExtensionRegistry;
  /**
   * MCP Phase 1 SQLite persistence (Wave 2B). Present only when a database is open; the router
   * is mounted alongside it. Absent (in-memory settings, no `dbPath`), MCP is registry-only —
   * no relaunch persistence and no HTTP router.
   */
  readonly mcpStore?: McpStore;
  /** The composed VALUE-scrub-then-shape-sanitize redactor fed into every EV mapper. */
  readonly redactError: (message: string) => string;
  /**
   * Build a {@link ToolPermissionProxy} for a granted workspace (the guard is per-grant). It
   * shares the ONE permission gate + runtime-reply port so a Deny blocks at the boundary.
   */
  buildToolPermissionProxy(guard: WorkspaceGuard): ToolPermissionProxy;
}

/** A fully-wired but not-yet-listening service: its routers, its deps, and a start seam. */
export interface CoworkService {
  readonly routers: readonly BoundaryRouter[];
  readonly deps: CoworkServiceDeps;
  /** Mount the routers and open the loopback socket via the shared {@link startService} seam. */
  start(): Promise<RunningService>;
}
