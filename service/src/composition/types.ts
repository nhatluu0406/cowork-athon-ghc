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
import type { SecretScrubber } from "../diagnostics/index.js";
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
import type { ProviderProfileStore } from "../provider-profiles/provider-profile-store.js";
import type { ProfileRuntimeBridge } from "../provider-profiles/profile-runtime-bridge.js";

export interface CoworkServiceOptions extends ServiceOptions {
  // ---- Tier 1 seams (default: real in-process implementations) ----
  /** Persistence seam for the settings store. Default: node fs at {@link settingsFilePath}. */
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
  /** The ONE credential store. Default: the OS keyring adapter (tests inject the memory store). */
  readonly credentialStore?: CredentialStore;
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
  /** File-backed conversation index (session management slice). */
  readonly conversationStore: ConversationStore;
  /** Service-owned local Skill discovery, validation, enabled state, and snapshots. */
  readonly skillCatalog: SkillCatalog;
  /**
   * The runtime-extension layer (CGHC-026): skill registry (RE1), MCP lifecycle (RE2), workflow
   * templates (RE4) over ONE extension-state source of truth with RE5 failure isolation. Wired
   * with honest not-attached seams (live skill execution / a live MCP process are Tier 2 /
   * CGHC-028); no HTTP router is mounted for this POC.
   */
  readonly extensions: ExtensionRegistry;
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
