/**
 * Browser-safe client of the loopback service (ADR 0003).
 *
 * The renderer is an HTTP client of the local application service, exactly like the
 * shell and the integration tests. It reaches the service ONLY through this typed client
 * — never a generic passthrough, never direct filesystem/credential access. This mirrors
 * the authoritative contract in `service/src/boundary/{client,contract}.ts`: a Bearer
 * per-launch token on every request and a versioned `{ ok, data | error }` envelope.
 *
 * It is deliberately a small, dependency-free fetch wrapper so the renderer bundle never
 * pulls the Node-only `@cowork-ghc/service` package. Later UI tasks widen it with more
 * typed methods, each mapping to a declared boundary route. The token is held in a
 * closure only — never placed in the DOM, `localStorage`, or logs.
 */

import {
  BOUNDARY_PROTOCOL_VERSION,
  type BoundaryErrorCode,
  type CredentialRef,
  type HealthData,
  type ModelDiscoveryResult,
  type ModelRef,
  type ProviderDescriptor,
  type ResponseEnvelope,
  type RuntimePreviewOutput,
  type RuntimePreviewProjectInfo,
  type RuntimePreviewStartInput,
  type RuntimePreviewState,
  type RuntimeAppOutput,
  type RuntimeAppProjectInfo,
  type RuntimeAppStartInput,
  type RuntimeAppState,
  type SessionMeta,
  type TestResult,
  type WorkspaceGrant,
} from "@cowork-ghc/contracts";
import type { SessionView } from "@cowork-ghc/service/execution";
import type { KnowledgeStatusView } from "@cowork-ghc/service/knowledge/types";
import type {
  KnowledgeDocumentView,
  KnowledgeGraphApiResult,
  KnowledgeIndexView,
  KnowledgeSearchHitView,
} from "@cowork-ghc/service/knowledge-local/types";
import {
  createPermissionClient,
  type DecidePermissionInput,
  type PendingPermissionView,
  type PermissionDecisionResponse,
} from "./permission-client.js";
import type { MicrosoftIntegrationView } from "./integration-slots.js";

// Re-exported so consumers keep importing the permission wire types from `./service-client.js`
// (the split in CGHC-025 preserves the public surface).
export type {
  DecidePermissionInput,
  PendingPermissionView,
  PermissionDecisionResponse,
} from "./permission-client.js";

/**
 * The built-in `GET /v1/health` payload — the SAME canonical {@link HealthData} the
 * service produces (via `@cowork-ghc/contracts`). Aliased so renderer imports (readiness
 * controller/view) keep the `ServiceHealth` name; the literal `status: "ok"` is preserved,
 * not widened to `string`.
 */
export type ServiceHealth = HealthData;

/** Secret-free paired-device view mirrored from `/v1/remote` (no token material). */
export interface RemoteDeviceView {
  readonly deviceId: string;
  readonly name: string;
  readonly pairedAtIso: string;
  readonly lastSeenAtIso: string;
}

/** Remote-control status the `/remote` panel renders. */
export interface RemoteStatus {
  readonly enabled: boolean;
  readonly url: string | null;
  readonly lanUrls: readonly string[];
  readonly devices: readonly RemoteDeviceView[];
  readonly activeCode: boolean;
}

/** A freshly issued one-time pairing code (+ optional scannable QR). */
export interface RemotePairingCode {
  readonly code: string;
  readonly expiresAtMs: number;
  readonly qrSvg: string | null;
  readonly pairingUrl: string | null;
}

/** A stored dispatch task (built-in template or user task) as listed by `/v1/tasks`. */
export interface DispatchTaskView {
  readonly id: string;
  readonly name: string;
  readonly source: "built_in" | "user_local";
  readonly goal: string;
  readonly loop: { readonly mode: "run_once" | "retry_until_verified" | "scheduled" };
  readonly branches?: readonly { readonly agentId: string; readonly focus?: string }[];
  readonly agentId?: string;
}

/** Secret-free live view of one fan-out branch (mirrors the service view). */
export interface DispatchBranchView {
  readonly branchId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly status: "pending" | "running" | "completed" | "errored" | "cancelled";
  readonly summary?: string;
}

/** Secret-free live view of one dispatch run (loop over fan-out groups). */
export interface DispatchRunView {
  readonly runId: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly loopMode: "run_once" | "retry_until_verified" | "scheduled";
  readonly startedAt: string;
  readonly status: "running" | "completed" | "partial" | "errored" | "cancelled" | "exhausted";
  readonly attempts: number;
  readonly verified: boolean;
  readonly reason?: string;
  readonly branches: readonly DispatchBranchView[];
}

/** Non-secret rejection reasons mirrored from the service (CGHC-008). */
export type WorkspaceRejectReason =
  | "not_absolute"
  | "unc_path"
  | "not_found"
  | "not_a_directory"
  | "not_writable";

/** Outcome of asking the service to validate + grant a chosen folder. */
export type WorkspaceGrantResult =
  | { readonly granted: true; readonly grant: WorkspaceGrant }
  | { readonly granted: false; readonly reason: WorkspaceRejectReason; readonly message: string };

/** A recent workspace decorated with a freshly-probed availability flag. */
export interface RecentWorkspaceView {
  readonly id: string;
  readonly rootPath: string;
  readonly lastOpenedAt: string;
  readonly available: boolean;
}

export type WorkspaceEntryKind = "file" | "folder";

export interface WorkspaceListEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: WorkspaceEntryKind;
  readonly extension?: string;
  readonly sizeBytes?: number;
  readonly modifiedTime?: string;
}

export interface WorkspaceListResult {
  readonly rootName: string;
  readonly parentPath: string;
  readonly entries: readonly WorkspaceListEntry[];
  readonly truncated: boolean;
  readonly limit: number;
}

export type WorkspaceFileContentKind =
  | "text"
  | "image"
  | "pdf"
  | "docx"
  | "spreadsheet"
  | "presentation"
  | "missing"
  | "unsupported";

export interface WorkspaceSpreadsheetSheetView {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

export interface WorkspacePresentationSlideView {
  readonly index: number;
  readonly title: string;
  readonly text: string;
}

export interface WorkspaceFileContentView {
  readonly relativePath: string;
  readonly kind: WorkspaceFileContentKind;
  readonly editable: boolean;
  readonly mimeType?: string;
  readonly content?: string;
  readonly html?: string;
  readonly dataBase64?: string;
  readonly sheets?: readonly WorkspaceSpreadsheetSheetView[];
  readonly slides?: readonly WorkspacePresentationSlideView[];
  readonly truncated: boolean;
  readonly sizeBytes: number;
}

export type WorkspaceFileWriteInput =
  | { readonly kind: "text"; readonly content: string }
  | { readonly kind: "spreadsheet"; readonly sheets: readonly WorkspaceSpreadsheetSheetView[] };

/** UI theme preference mirrored from the service (CGHC-022). */
export type ThemePreference = "system" | "light" | "dark";

/** General settings mirrored from the service. Non-secret. */
export interface GeneralSettingsView {
  readonly theme: ThemePreference;
  readonly verboseLogging: boolean;
  readonly telemetryEnabled: boolean;
  readonly devtoolsEnabled: boolean;
  /** Require the local password at startup (false = device-bound secure auto-unlock). */
  readonly requireLoginOnStartup: boolean;
}

/**
 * A per-provider settings row. NON-SECRET by construction: `hasCredential` + the account
 * label (the credential HANDLE) — never a key. The renderer never sees or holds key bytes.
 */
export interface ProviderSettingsView {
  readonly providerId: string;
  readonly hasCredential: boolean;
  readonly credentialAccount?: string;
  readonly baseUrl?: string;
  readonly envVar?: string;
}

export type ProviderProfileType = "deepseek" | "custom-openai-compat";

export interface ProviderProfileView {
  readonly id: string;
  readonly displayName: string;
  readonly providerType: ProviderProfileType;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly credentialConfigured: boolean;
  readonly credentialAccount?: string;
  readonly presetId?: string;
  readonly isActive: boolean;
  readonly verificationCurrent: boolean;
  readonly lastVerifiedAt?: string;
  readonly lastVerifiedOk?: boolean;
}

export interface ProviderProfileRecord {
  readonly id: string;
  readonly displayName: string;
  readonly providerType: ProviderProfileType;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly credentialConfigured: boolean;
  readonly presetId?: string;
}

/** The non-secret settings projection the service returns to the renderer (CGHC-022 SD1). */
export interface SettingsView {
  readonly general: GeneralSettingsView;
  readonly providers: readonly ProviderSettingsView[];
  readonly defaultModel: ModelRef | null;
  readonly activeWorkspace: { readonly rootPath: string } | null;
  readonly providerProfiles?: readonly ProviderProfileView[];
  readonly activeProfileId?: string | null;
}

/** Result of dispatching a prompt to a live session. */
export type SendSessionMessageResult =
  | { readonly accepted: true; readonly sessionId: string }
  | { readonly accepted: false; readonly reason: string; readonly sessionId: string };

/** Input for creating a session bound to the active workspace. */
export interface CreateSessionInput {
  readonly workspaceId: string;
  readonly title?: string;
  readonly model?: ModelRef;
}

export type ConversationStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "cancelled"
  | "errored"
  | "interrupted";

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: string;
  readonly attachments?: readonly AttachmentMetadata[];
  readonly skills?: readonly SkillUseMetadata[];
}

export type SkillSource = "built_in" | "user_local";
export type SkillStatus = "enabled" | "disabled" | "invalid";

export interface SkillUseMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source: SkillSource;
  readonly contentHash: string;
  readonly modifiedAt: string;
}

export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly source: SkillSource;
  readonly status: SkillStatus;
  readonly validationStatus: "valid" | "invalid";
  readonly invalidReason?: string;
  readonly contentHash?: string;
  readonly modifiedAt?: string;
  readonly sizeBytes?: number;
}

export interface EnabledSkillSnapshot {
  readonly metadata: SkillUseMetadata;
  readonly content: string;
}

/** Secret-free MCP server row from GET /v1/mcp/servers (Wave 2 Phase 1). */
export interface McpServerListItem {
  readonly id: string;
  readonly name: string;
  readonly command?: string;
  readonly url?: string;
  readonly enabled: boolean;
  readonly status: string;
  readonly connection: string;
  readonly hasHeaderSecret: boolean;
  readonly toolCount: number;
  readonly updatedAt: string;
}

/** Metadata persisted for workspace text-file attachments (no raw content). */
export type AttachmentInclusionStatus =
  | "selected"
  | "included"
  | "rejected"
  | "omitted_by_budget";

export interface AttachmentMetadata {
  readonly relativePath: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly contentHash: string;
  readonly truncated: boolean;
  readonly maxBytesApplied: number;
  readonly inclusionStatus?: AttachmentInclusionStatus;
  readonly inclusionReason?: string;
}

export type AttachmentReadResult =
  | {
      readonly ok: true;
      readonly metadata: AttachmentMetadata;
      readonly content: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly message: string;
    };

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly workspacePath: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly runtimeSessionId: string | null;
  readonly parentId?: string;
  readonly status: ConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  /** Which product surface owns this conversation. Absent in legacy records → treat as "cowork". */
  readonly surface: "cowork" | "ms365";
}

/** Redacted activity metadata from conversation persistence (no secrets). */
export interface PersistedActivitySnapshot {
  readonly items: readonly Record<string, unknown>[];
  readonly fileChanges: readonly Record<string, unknown>[];
  readonly permissionHistory: readonly Record<string, unknown>[];
  readonly readPaths: readonly string[];
  readonly terminalState: string | null;
}

export interface ConversationRecord extends ConversationSummary {
  readonly messages: readonly ConversationMessage[];
  readonly model?: ModelRef;
  readonly providerSnapshot?: ConversationProviderSnapshot;
  readonly activity?: PersistedActivitySnapshot;
  readonly runtimeTurns?: readonly RuntimeTurnRecord[];
}

export interface ConversationProviderSnapshot {
  readonly profileId: string;
  readonly displayName: string;
  readonly providerType: ProviderProfileType;
  readonly modelId: string;
  readonly baseUrl: string;
}

export interface RuntimeTurnRecord {
  readonly runtimeSessionId: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: "running" | "completed" | "cancelled" | "errored";
}

export interface CreateConversationInput {
  readonly workspacePath: string;
  readonly title?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly parentId?: string;
  readonly surface?: "cowork" | "ms365";
  readonly providerSnapshot?: ConversationProviderSnapshot;
}

export interface ContinueSessionResult {
  readonly session: SessionMeta;
  readonly view: SessionView;
  readonly canPrompt: boolean;
}

/** Result of clearing a per-session model override (LOW-1). */
export interface ClearSessionModelResult {
  readonly cleared: boolean;
  readonly defaultModel: ModelRef | null;
}

/** MS365 integration state and connected services (Task 4: MS365 UI wiring). */
export interface Ms365ViewData {
  readonly connectionState: string;
  readonly services: readonly { readonly id: string; readonly label: string; readonly connected: boolean }[];
  readonly scopes: readonly string[];
  readonly actionHistory: readonly { readonly label: string; readonly source: string; readonly at?: string }[];
  /** Connected account's non-secret display identity (name/username), when known. */
  readonly account?: { readonly name?: string; readonly username?: string };
  /** Active token expiry as epoch milliseconds, when known. */
  readonly expiresAtMs?: number;
  readonly error?: string;
}

/** Batch write-mode for MS365 write operations: manual confirms each write; auto approves once. */
export type Ms365WriteMode = "manual" | "auto";

/** A SharePoint site the connected MS365 account can see, with its search-scope toggle. */
export interface Ms365SiteView {
  readonly id: string;
  readonly displayName: string;
  readonly webUrl: string;
  readonly enabled: boolean;
}

/** Result of initiating MS365 device-code flow. */
export type Ms365DeviceBeginResult =
  | { readonly userCode: string; readonly verificationUri: string; readonly expiresInSec: number }
  | { readonly error: "not_configured" };

/** Result of polling MS365 device-code status. */
export interface Ms365DevicePollResult {
  readonly status: "pending" | "connected" | "expired";
  readonly view?: Ms365ViewData;
}

/**
 * Client-side failure code: either a real {@link BoundaryErrorCode} from the service's
 * error envelope, `"protocol_mismatch"` when the envelope's protocol tag does not match
 * {@link BOUNDARY_PROTOCOL_VERSION}, or a client-synthesized code when a success envelope
 * reports an unusable runtime (e.g. create session accepted:false).
 */
export type ServiceClientErrorCode =
  | BoundaryErrorCode
  | "protocol_mismatch"
  | "runtime_unavailable"
  | "runtime_not_attached";

/** Error surfaced by the client; carries a stable, non-secret code. */
export class ServiceClientError extends Error {
  readonly code: ServiceClientErrorCode;
  constructor(code: ServiceClientErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ServiceClientError";
  }
}

/** The renderer-visible client surface. Extended by later UI tasks. */
/** Local diagnostics (Wave 6): logging status + local-only aggregate telemetry. */
export interface DiagnosticsLoggingStatus {
  readonly verbose: boolean;
  readonly toFile: boolean;
  readonly sizeBytes: number;
}
export interface DiagnosticsTelemetrySnapshot {
  readonly enabled: boolean;
  readonly counters: Readonly<Record<string, number>>;
  readonly updatedAt: string | null;
}
export interface DiagnosticsStatus {
  readonly logging: DiagnosticsLoggingStatus;
  readonly telemetry: DiagnosticsTelemetrySnapshot;
}
export interface DiagnosticsExport {
  readonly filename: string;
  readonly json: string;
}
export type DiagnosticsClearTarget = "telemetry" | "logs" | "all";

export interface ServiceClient {
  health(): Promise<ServiceHealth>;
  /** Read local logging status + telemetry counters (Wave 6). */
  getDiagnostics(): Promise<DiagnosticsStatus>;
  /** Clear local telemetry counters and/or log files; returns the refreshed status. */
  clearDiagnostics(target: DiagnosticsClearTarget): Promise<DiagnosticsStatus>;
  /** Produce a redacted diagnostics JSON blob for the shell to save to a user-chosen file. */
  exportDiagnostics(): Promise<DiagnosticsExport>;
  /**
   * Send the folder the user picked to the service for server-side validation + grant. The UI
   * never validates or grants itself — it renders whichever {@link WorkspaceGrantResult} comes
   * back. A `granted:false` result must NOT become the active workspace / start a session.
   */
  grantWorkspace(rootPath: string): Promise<WorkspaceGrantResult>;
  /** List recent workspaces, each with a server-probed `available` flag. */
  recentWorkspaces(): Promise<readonly RecentWorkspaceView[]>;
  /** List direct children of the active workspace or a loaded child folder. */
  listWorkspaceChildren(relativePath?: string, limit?: number): Promise<WorkspaceListResult>;

  // --- Runtime preview (Code surface web preview) ---
  /** Inspect the active workspace for previewable capability (static / dev-server). */
  detectRuntimePreview(): Promise<RuntimePreviewProjectInfo>;
  /** Read the current preview state. */
  getRuntimePreviewState(): Promise<RuntimePreviewState>;
  /** Read preview state + output lines newer than `afterSeq`. */
  getRuntimePreviewOutput(afterSeq: number): Promise<RuntimePreviewOutput>;
  /** Start a static (no-command) preview of the workspace. */
  startStaticPreview(): Promise<RuntimePreviewState>;
  /** Step 1 of a dev-server launch: raise a `command_exec` permission request. */
  requestPreviewLaunch(
    input: RuntimePreviewStartInput,
  ): Promise<{ requestId: string; command: string; cwd: string }>;
  /** Step 2: resolve the launch permission (Allow starts it server-side). */
  resolvePreviewLaunch(requestId: string, decision: "allow" | "deny"): Promise<RuntimePreviewState>;
  /** Stop the active preview. */
  stopRuntimePreview(): Promise<RuntimePreviewState>;
  /** Restart the active preview (re-uses the approved launch / static kind). */
  restartRuntimePreview(): Promise<RuntimePreviewState>;

  // --- Runtime desktop-app launch (Code surface Slice 2) ---
  /** Inspect the active workspace for desktop-app (Electron) launch capability. */
  detectRuntimeApp(): Promise<RuntimeAppProjectInfo>;
  /** Read the current desktop-app state. */
  getRuntimeAppState(): Promise<RuntimeAppState>;
  /** Read desktop-app state + output lines newer than `afterSeq`. */
  getRuntimeAppOutput(afterSeq: number): Promise<RuntimeAppOutput>;
  /** Step 1 of a Build/Run: raise a `command_exec` permission request. */
  requestAppLaunch(
    input: RuntimeAppStartInput,
  ): Promise<{ requestId: string; action: "build" | "run"; command: string; cwd: string }>;
  /** Step 2: resolve the launch permission (Allow starts it server-side). */
  resolveAppLaunch(requestId: string, decision: "allow" | "deny"): Promise<RuntimeAppState>;
  /** Stop the active desktop app. */
  stopRuntimeApp(): Promise<RuntimeAppState>;
  /** Restart the active desktop app (re-uses the last approved run launch). */
  restartRuntimeApp(): Promise<RuntimeAppState>;
  /** Fetch the current non-secret settings projection (CGHC-022 SD1). */
  getSettings(): Promise<SettingsView>;
  /** List provider descriptors exposed by the service (provider-neutral). */
  listProviders(): Promise<readonly ProviderDescriptor[]>;
  /**
   * Store a credential in the OS keyring and bind its handle to the provider in settings.
   * The secret is sent once over the authenticated loopback boundary and never returned.
   */
  storeProviderCredential(providerId: string, secret: string): Promise<SettingsView>;
  /** Remove the keyring entry and clear the provider credential binding. */
  removeProviderCredential(providerId: string): Promise<SettingsView>;
  /** Development / verification only: import a credential from a named process env var. */
  importProviderCredentialFromEnv(providerId: string, envVar: string): Promise<SettingsView>;
  /** Set the child env-var NAME for a custom OpenAI-compatible provider (non-secret). */
  setProviderEnvVar(providerId: string, envVar: string): Promise<SettingsView>;
  /** Bounded provider connectivity test (resolves credential from keyring). */
  testProviderConnection(providerId: string): Promise<TestResult>;
  listProviderProfiles(): Promise<{
    readonly profiles: readonly ProviderProfileView[];
    readonly activeProfileId: string | null;
  }>;
  createProviderProfile(input: {
    readonly displayName: string;
    readonly providerType: ProviderProfileType;
    readonly baseUrl?: string;
    readonly modelId?: string;
    readonly presetId?: string;
  }): Promise<ProviderProfileRecord>;
  updateProviderProfile(
    profileId: string,
    input: { readonly displayName?: string; readonly baseUrl?: string; readonly modelId?: string },
  ): Promise<ProviderProfileRecord>;
  deleteProviderProfile(profileId: string): Promise<void>;
  setActiveProviderProfile(profileId: string): Promise<SettingsView>;
  storeProfileCredential(profileId: string, secret: string): Promise<SettingsView>;
  removeProfileCredential(profileId: string): Promise<SettingsView>;
  testProfileConnection(profileId: string): Promise<TestResult>;
  /**
   * Best-effort model discovery for a profile draft. `baseUrl` optionally overrides the saved
   * endpoint (an in-form edit). Never blocks configuration: on any failure the result carries
   * `ok: false` and the caller keeps manual model-id entry.
   */
  discoverProfileModels(profileId: string, baseUrl?: string): Promise<ModelDiscoveryResult>;
  /** Patch general settings; returns the updated settings view. */
  updateGeneral(patch: Partial<GeneralSettingsView>): Promise<SettingsView>;
  /**
   * Bind a credential HANDLE to a provider. The UI passes only a {@link CredentialRef}
   * handle (store + account) — never a raw key, which lives in the OS credential store.
   */
  setProviderCredentialRef(providerId: string, ref: CredentialRef): Promise<SettingsView>;
  /** Remove a provider's credential binding. */
  removeProviderCredentialRef(providerId: string): Promise<SettingsView>;
  /** Set the custom endpoint base_url (non-secret). */
  setProviderBaseUrl(providerId: string, baseUrl: string): Promise<SettingsView>;
  /** Set (or clear with `null`) the persisted default-model preference (SSOT = service). */
  setDefaultModel(model: ModelRef | null): Promise<SettingsView>;
  /** Persist the server-validated active workspace root used by live launch. */
  setActiveWorkspace(rootPath: string): Promise<SettingsView>;
  /** Clear a per-session model override so the session reverts to the default (LOW-1). */
  clearSessionModel(sessionId: string): Promise<ClearSessionModelResult>;
  /** Create a live session for the selected workspace. */
  createSession(input: CreateSessionInput): Promise<SessionMeta>;
  /** Dispatch a prompt to the live session (202 when accepted). */
  sendSessionMessage(sessionId: string, text: string): Promise<SendSessionMessageResult>;
  /** Request cancellation of the in-flight run. */
  cancelSession(sessionId: string): Promise<void>;
  /** Read remote-control status (gateway URL, LAN URLs, paired devices). */
  remoteStatus(): Promise<RemoteStatus>;
  /** Issue a one-time pairing code (+ QR SVG when the gateway is reachable). */
  remoteIssuePairingCode(): Promise<RemotePairingCode>;
  /** Revoke every paired device (the `/remote off` teardown). */
  remoteRevokeAll(): Promise<void>;
  /** List dispatch task templates + user tasks (the dispatch catalog). */
  listDispatchTasks(): Promise<readonly DispatchTaskView[]>;
  /** Start a STORED task as a dispatch run (fan-out per its branches). */
  runDispatchTask(taskId: string): Promise<DispatchRunView>;
  /** List dispatch runs, newest first. */
  listDispatchRuns(): Promise<readonly DispatchRunView[]>;
  /** One dispatch run by id. */
  getDispatchRun(runId: string): Promise<DispatchRunView>;
  /** Cancel a dispatch run (loop + in-flight branches). */
  cancelDispatchRun(runId: string): Promise<void>;
  /** List persisted conversations (optional local search query + surface filter). */
  listConversations(
    query?: string,
    surface?: "cowork" | "ms365",
  ): Promise<readonly ConversationSummary[]>;
  createConversation(input: CreateConversationInput): Promise<ConversationRecord>;
  getConversation(id: string): Promise<ConversationRecord>;
  getLastActiveConversationId(): Promise<string | null>;
  patchConversation(
    id: string,
    patch: {
      readonly title?: string;
      readonly status?: ConversationStatus;
      readonly runtimeSessionId?: string | null;
      readonly activity?: Record<string, unknown>;
      readonly registerRuntimeTurn?: RuntimeTurnRecord;
      readonly completeRuntimeTurn?: {
        readonly runtimeSessionId: string;
        readonly status: RuntimeTurnRecord["status"];
        readonly completedAt: string;
      };
      readonly lastActive?: boolean;
    },
  ): Promise<ConversationRecord>;
  deleteConversation(id: string): Promise<void>;
  compactConversation(id: string): Promise<{ readonly summary: string }>;
  appendConversationMessage(
    id: string,
    role: "user" | "assistant",
    text: string,
    attachments?: readonly AttachmentMetadata[],
    skills?: readonly SkillUseMetadata[],
  ): Promise<ConversationRecord>;
  listSkills(): Promise<readonly SkillView[]>;
  refreshSkills(): Promise<readonly SkillView[]>;
  setSkillEnabled(id: string, enabled: boolean): Promise<SkillView>;
  enabledSkillSnapshots(): Promise<readonly EnabledSkillSnapshot[]>;
  previewSkill(id: string): Promise<{ readonly content: string; readonly truncated: boolean }>;
  readSkillContent(id: string): Promise<string>;
  createSkill(input: {
    readonly id?: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly body: string;
  }): Promise<SkillView>;
  updateSkill(
    id: string,
    input: {
      readonly name: string;
      readonly description: string;
      readonly version: string;
      readonly body: string;
    },
  ): Promise<SkillView>;
  deleteSkill(id: string): Promise<void>;
  listMcpServers(): Promise<readonly McpServerListItem[]>;
  createMcpServer(input: {
    readonly id?: string;
    readonly name: string;
    readonly command?: string;
    readonly url?: string;
    readonly headerSecret?: string;
  }): Promise<McpServerListItem>;
  updateMcpServer(
    id: string,
    input: {
      readonly name?: string;
      readonly command?: string;
      readonly url?: string;
      readonly headerSecret?: string | null;
    },
  ): Promise<McpServerListItem>;
  deleteMcpServer(id: string): Promise<void>;
  setMcpServerEnabled(id: string, enabled: boolean): Promise<McpServerListItem>;
  /** Re-probe reachability/health for one server (issue #28 health badge). */
  mcpServerHealth(id: string): Promise<{ readonly id: string; readonly connection: string }>;
  readWorkspaceAttachment(
    absolutePath: string,
    priorBytesUsed?: number,
  ): Promise<AttachmentReadResult>;
  /** Reconnect to an OpenCode session after service restart (when still available). */
  continueRuntimeSession(sessionId: string): Promise<ContinueSessionResult>;
  getRuntimeSession(sessionId: string): Promise<ContinueSessionResult>;
  previewWorkspaceFile(relativePath: string): Promise<{
    readonly relativePath: string;
    readonly kind: "text" | "binary" | "missing";
    readonly content?: string;
    readonly truncated: boolean;
    readonly sizeBytes: number;
  }>;
  readWorkspaceFileContent(relativePath: string): Promise<WorkspaceFileContentView>;
  writeWorkspaceFileContent(
    relativePath: string,
    input: WorkspaceFileWriteInput,
  ): Promise<{ readonly relativePath: string; readonly sizeBytes: number }>;
  captureFileReviewSnapshot(relativePath: string): Promise<import("@cowork-ghc/service/file-review").FileSnapshotCapture>;
  buildFileReview(input: Record<string, unknown>): Promise<import("@cowork-ghc/service/file-review").FileReviewArtifact>;
  /**
   * List the pending permission requests (CGHC-017, P1). The UI renders these honestly and
   * never fabricates activity — the list is empty when nothing is awaiting a decision.
   */
  listPendingPermissions(): Promise<readonly PendingPermissionView[]>;
  /**
   * Record an Allow/Deny decision on the single server-side gate. A Deny maps to a REAL
   * server-side block (enforced at the execution boundary, not the UI). The `unknown` /
   * `already_resolved` outcomes are returned honestly — never a fabricated success.
   */
  decidePermission(input: DecidePermissionInput): Promise<PermissionDecisionResponse>;
  /** Local app lock status (ADR 0007). Never returns secrets. */
  authStatus(): Promise<
    | { readonly state: "needs_setup" }
    | { readonly state: "locked"; readonly username: string }
    | { readonly state: "unlocked"; readonly username: string; readonly userId: string }
  >;
  authSetup(username: string, password: string): Promise<{
    readonly state: "unlocked";
    readonly username: string;
    readonly userId: string;
  }>;
  authUnlock(username: string, password: string): Promise<{
    readonly state: "unlocked";
    readonly username: string;
    readonly userId: string;
  }>;
  /**
   * Knowledge (M365 Knowledge-Graph) settings surface (REQ-205): read status, configure a source
   * (the raw token crosses the boundary inbound only — every response is the secret-free
   * {@link KnowledgeStatusView}), force a health re-check, and disconnect.
   */
  getKnowledgeStatus(): Promise<KnowledgeStatusView>;
  configureKnowledgeSource(baseUrl: string, token: string): Promise<KnowledgeStatusView>;
  testKnowledgeConnection(): Promise<{ readonly ok: boolean }>;
  disconnectKnowledgeSource(): Promise<KnowledgeStatusView>;
  /**
   * Local Knowledge Base + Graph (offline, workspace-scoped): read index status, start/cancel a
   * background sync, clear the index, keyword search, and the graph. Distinct from the M365 methods
   * above — this is the local SQLite index, no network.
   */
  knowledgeLocalStatus(): Promise<KnowledgeIndexView>;
  knowledgeLocalSync(): Promise<KnowledgeIndexView>;
  knowledgeLocalCancel(): Promise<KnowledgeIndexView>;
  knowledgeLocalClear(): Promise<KnowledgeIndexView>;
  knowledgeLocalSearch(query: string, limit?: number): Promise<readonly KnowledgeSearchHitView[]>;
  knowledgeLocalGraph(limit?: number): Promise<KnowledgeGraphApiResult>;
  knowledgeLocalDocuments(): Promise<readonly KnowledgeDocumentView[]>;
  /** Connect an MS365 account using a Bearer token. */
  connectMs365Token(token: string): Promise<Ms365ViewData>;
  /** Fetch the current MS365 connection state and services. */
  fetchMs365View(): Promise<Ms365ViewData>;
  /** Begin MS365 device-code authentication flow. */
  beginMs365Device(): Promise<Ms365DeviceBeginResult>;
  /** Poll the status of an MS365 device-code flow. */
  pollMs365Device(): Promise<Ms365DevicePollResult>;
  /** Disconnect the current MS365 session; returns the fresh (disconnected) view. */
  disconnectMs365(): Promise<Ms365ViewData>;
  /** List SharePoint sites visible to the connected account, with their search-scope toggle. */
  listMs365Sites(): Promise<readonly Ms365SiteView[]>;
  /** Enable/disable a site for search scope; returns the refreshed site list. */
  setMs365SiteEnabled(siteId: string, enabled: boolean): Promise<readonly Ms365SiteView[]>;
  /** Đọc chế độ ghi hàng loạt MS365 hiện tại. */
  fetchMs365WriteMode(): Promise<{ mode: Ms365WriteMode }>;
  /** Đổi chế độ ghi hàng loạt MS365 (nguồn sự thật ở service). */
  setMs365WriteMode(mode: Ms365WriteMode): Promise<{ mode: Ms365WriteMode }>;
  /** Grant/revoke the MS365 tool session-scope allowlist for a single OpenCode session. */
  setMs365SessionScope(sessionId: string, enabled: boolean): Promise<{ allowed: boolean }>;
}

/** Create a client bound to a loopback base URL + per-launch token. */
export function createServiceClient(baseUrl: string, clientToken: string): ServiceClient {
  const root = baseUrl.replace(/\/$/, "");

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${clientToken}` };
    if (init?.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${root}${path}`, { ...init, headers });
    const envelope = (await response.json()) as ResponseEnvelope<T>;
    // Refuse a wrong/drifted wire contract rather than silently accepting it: the service
    // stamps every envelope with the shared protocol tag (single source of truth in
    // `@cowork-ghc/contracts`). A mismatch means the two ends disagree on the wire shape.
    if (envelope.protocol !== BOUNDARY_PROTOCOL_VERSION) {
      throw new ServiceClientError(
        "protocol_mismatch",
        `Unexpected boundary protocol (expected ${BOUNDARY_PROTOCOL_VERSION}).`,
      );
    }
    if (!envelope.ok) {
      throw new ServiceClientError(envelope.error.code, envelope.error.message);
    }
    return envelope.data;
  }

  const permission = createPermissionClient(call);

  return {
    health: () => call<ServiceHealth>("/v1/health"),
    grantWorkspace: (rootPath) =>
      call<WorkspaceGrantResult>("/v1/workspace/grant", {
        method: "POST",
        body: JSON.stringify({ rootPath }),
      }),
    recentWorkspaces: async () =>
      (await call<{ recent: readonly RecentWorkspaceView[] }>("/v1/workspace/recent")).recent,
    listWorkspaceChildren: async (relativePath = "", limit = 200) => {
      const query = new URLSearchParams();
      if (relativePath.trim().length > 0) query.set("path", relativePath);
      query.set("limit", String(limit));
      return (await call<{ tree: WorkspaceListResult }>(`/v1/workspace/list?${query.toString()}`)).tree;
    },

    detectRuntimePreview: async () =>
      (await call<{ info: RuntimePreviewProjectInfo }>("/v1/runtime-preview/detect")).info,
    getRuntimePreviewState: async () =>
      (await call<{ state: RuntimePreviewState }>("/v1/runtime-preview/state")).state,
    getRuntimePreviewOutput: async (afterSeq) =>
      (
        await call<{ output: RuntimePreviewOutput }>(
          `/v1/runtime-preview/output?after=${String(afterSeq)}`,
        )
      ).output,
    startStaticPreview: async () =>
      (await call<{ state: RuntimePreviewState }>("/v1/runtime-preview/start-static", { method: "POST" }))
        .state,
    requestPreviewLaunch: (input) =>
      call<{ requestId: string; command: string; cwd: string }>("/v1/runtime-preview/request-launch", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    resolvePreviewLaunch: async (requestId, decision) =>
      (
        await call<{ state: RuntimePreviewState }>("/v1/runtime-preview/resolve", {
          method: "POST",
          body: JSON.stringify({ requestId, decision }),
        })
      ).state,
    stopRuntimePreview: async () =>
      (await call<{ state: RuntimePreviewState }>("/v1/runtime-preview/stop", { method: "POST" })).state,
    restartRuntimePreview: async () =>
      (await call<{ state: RuntimePreviewState }>("/v1/runtime-preview/restart", { method: "POST" }))
        .state,

    detectRuntimeApp: async () =>
      (await call<{ info: RuntimeAppProjectInfo }>("/v1/runtime-app/detect")).info,
    getRuntimeAppState: async () =>
      (await call<{ state: RuntimeAppState }>("/v1/runtime-app/state")).state,
    getRuntimeAppOutput: async (afterSeq) =>
      (await call<{ output: RuntimeAppOutput }>(`/v1/runtime-app/output?after=${String(afterSeq)}`)).output,
    requestAppLaunch: (input) =>
      call<{ requestId: string; action: "build" | "run"; command: string; cwd: string }>(
        "/v1/runtime-app/request-launch",
        { method: "POST", body: JSON.stringify(input) },
      ),
    resolveAppLaunch: async (requestId, decision) =>
      (
        await call<{ state: RuntimeAppState }>("/v1/runtime-app/resolve", {
          method: "POST",
          body: JSON.stringify({ requestId, decision }),
        })
      ).state,
    stopRuntimeApp: async () =>
      (await call<{ state: RuntimeAppState }>("/v1/runtime-app/stop", { method: "POST" })).state,
    restartRuntimeApp: async () =>
      (await call<{ state: RuntimeAppState }>("/v1/runtime-app/restart", { method: "POST" })).state,

    getSettings: async () => (await call<{ settings: SettingsView }>("/v1/settings")).settings,
    listProviders: async () =>
      (await call<{ providers: readonly ProviderDescriptor[] }>("/v1/providers")).providers,
    storeProviderCredential: async (providerId, secret) => {
      const { ref } = await call<{ ref: CredentialRef }>("/v1/credentials", {
        method: "POST",
        body: JSON.stringify({ providerId, secret }),
      });
      return (
        await call<{ settings: SettingsView }>("/v1/settings/providers/credential", {
          method: "PUT",
          body: JSON.stringify({ providerId, ref }),
        })
      ).settings;
    },
    importProviderCredentialFromEnv: async (providerId, envVar) => {
      const { ref } = await call<{ ref: CredentialRef }>("/v1/credentials/import-env", {
        method: "POST",
        body: JSON.stringify({ providerId, envVar }),
      });
      return (
        await call<{ settings: SettingsView }>("/v1/settings/providers/credential", {
          method: "PUT",
          body: JSON.stringify({ providerId, ref }),
        })
      ).settings;
    },
    removeProviderCredential: async (providerId) => {
      const settings = (await call<{ settings: SettingsView }>("/v1/settings")).settings;
      const row = settings.providers.find((p) => p.providerId === providerId);
      if (row?.hasCredential && row.credentialAccount !== undefined) {
        await call<{ removed: boolean }>("/v1/credentials", {
          method: "DELETE",
          body: JSON.stringify({ ref: { store: "os", account: row.credentialAccount } }),
        });
      }
      return (
        await call<{ settings: SettingsView }>("/v1/settings/providers/credential", {
          method: "DELETE",
          body: JSON.stringify({ providerId }),
        })
      ).settings;
    },
    setProviderEnvVar: async (providerId, envVar) =>
      (
        await call<{ settings: SettingsView }>("/v1/settings/providers/env-var", {
          method: "PUT",
          body: JSON.stringify({ providerId, envVar }),
        })
      ).settings,
    testProviderConnection: async (providerId) =>
      (await call<{ result: TestResult }>("/v1/providers/test-connection", {
        method: "POST",
        body: JSON.stringify({ providerId }),
      })).result,
    listProviderProfiles: async () =>
      call<{ profiles: readonly ProviderProfileView[]; activeProfileId: string | null }>(
        "/v1/provider-profiles",
      ),
    createProviderProfile: async (input) =>
      (await call<{ profile: ProviderProfileRecord }>("/v1/provider-profiles", {
        method: "POST",
        body: JSON.stringify(input),
      })).profile,
    updateProviderProfile: async (profileId, input) =>
      (await call<{ profile: ProviderProfileRecord }>(`/v1/provider-profiles/${encodeURIComponent(profileId)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      })).profile,
    deleteProviderProfile: async (profileId) => {
      await call<{ deleted: boolean }>(`/v1/provider-profiles/${encodeURIComponent(profileId)}`, {
        method: "DELETE",
        body: "{}",
      });
    },
    setActiveProviderProfile: async (profileId) => {
      await call<{ profile: ProviderProfileRecord; activeProfileId: string }>(
        "/v1/provider-profiles/active",
        {
          method: "PUT",
          body: JSON.stringify({ profileId }),
        },
      );
      return (await call<{ settings: SettingsView }>("/v1/settings")).settings;
    },
    storeProfileCredential: async (profileId, secret) => {
      const account = `profile:${profileId}`;
      const { ref } = await call<{ ref: CredentialRef }>("/v1/credentials", {
        method: "POST",
        body: JSON.stringify({ providerId: profileId, secret, account }),
      });
      await call<{ profile: ProviderProfileRecord }>(
        `/v1/provider-profiles/${encodeURIComponent(profileId)}/credential`,
        {
          method: "PUT",
          body: JSON.stringify({ ref }),
        },
      );
      return (await call<{ settings: SettingsView }>("/v1/settings")).settings;
    },
    removeProfileCredential: async (profileId) => {
      const settings = await call<{ settings: SettingsView }>("/v1/settings").then((r) => r.settings);
      const row = settings.providerProfiles?.find((p) => p.id === profileId);
      if (row?.credentialConfigured && row.credentialAccount !== undefined) {
        await call<{ removed: boolean }>("/v1/credentials", {
          method: "DELETE",
          body: JSON.stringify({ ref: { store: "os", account: row.credentialAccount } }),
        });
      }
      await call<{ profile: ProviderProfileRecord }>(
        `/v1/provider-profiles/${encodeURIComponent(profileId)}/credential`,
        { method: "DELETE" },
      );
      return (await call<{ settings: SettingsView }>("/v1/settings")).settings;
    },
    testProfileConnection: async (profileId) =>
      (
        await call<{ result: TestResult }>(
          `/v1/provider-profiles/${encodeURIComponent(profileId)}/test-connection`,
          { method: "POST", body: JSON.stringify({}) },
        )
      ).result,
    discoverProfileModels: async (profileId, baseUrl) =>
      (
        await call<{ result: ModelDiscoveryResult }>(
          `/v1/provider-profiles/${encodeURIComponent(profileId)}/discover-models`,
          {
            method: "POST",
            body: JSON.stringify(baseUrl !== undefined ? { baseUrl } : {}),
          },
        )
      ).result,
    updateGeneral: async (patch) =>
      (
        await call<{ settings: SettingsView }>("/v1/settings/general", {
          method: "PATCH",
          body: JSON.stringify(patch),
        })
      ).settings,
    setProviderCredentialRef: async (providerId, ref) =>
      (
        await call<{ settings: SettingsView }>("/v1/settings/providers/credential", {
          method: "PUT",
          body: JSON.stringify({ providerId, ref }),
        })
      ).settings,
    removeProviderCredentialRef: async (providerId) =>
      (
        await call<{ settings: SettingsView }>("/v1/settings/providers/credential", {
          method: "DELETE",
          body: JSON.stringify({ providerId }),
        })
      ).settings,
    setProviderBaseUrl: async (providerId, baseUrl) =>
      (
        await call<{ settings: SettingsView }>("/v1/settings/providers/base-url", {
          method: "PUT",
          body: JSON.stringify({ providerId, baseUrl }),
        })
      ).settings,
    setDefaultModel: async (model) =>
      (
        await call<{ settings: SettingsView }>("/v1/settings/model/default", {
          method: "PUT",
          body: JSON.stringify({ model }),
        })
      ).settings,
    setActiveWorkspace: async (rootPath) =>
      (
        await call<{ settings: SettingsView }>("/v1/settings/active-workspace", {
          method: "PUT",
          body: JSON.stringify({ rootPath }),
        })
      ).settings,
    clearSessionModel: (sessionId) =>
      call<ClearSessionModelResult>("/v1/settings/model/session", {
        method: "DELETE",
        body: JSON.stringify({ sessionId }),
      }),

    createSession: async (input) => {
      const data = await call<{
        session?: SessionMeta;
        accepted?: boolean;
        reason?: string;
      }>("/v1/session", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (data.session !== undefined) return data.session;
      const reason = data.reason === "runtime_not_attached" ? "runtime_not_attached" : "runtime_unavailable";
      throw new ServiceClientError(
        reason,
        "Runtime chưa sẵn sàng. Thử lại sau khi local service khởi động xong.",
      );
    },

    sendSessionMessage: async (sessionId, text) => {
      const data = await call<{
        accepted: boolean;
        sessionId: string;
        reason?: string;
        code?: string;
      }>(`/v1/session/${encodeURIComponent(sessionId)}/message`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (data.accepted) return { accepted: true, sessionId: data.sessionId };
      return {
        accepted: false,
        sessionId: data.sessionId,
        reason: data.reason ?? data.code ?? "runtime_unavailable",
      };
    },

    cancelSession: async (sessionId) => {
      await call<{ cancelled: boolean; sessionId: string }>(
        `/v1/session/${encodeURIComponent(sessionId)}/cancel`,
        { method: "POST", body: "{}" },
      );
    },

    remoteStatus: () => call<RemoteStatus>("/v1/remote/status"),
    remoteIssuePairingCode: () =>
      call<RemotePairingCode>("/v1/remote/pairing-code", { method: "POST", body: "{}" }),
    remoteRevokeAll: async () => {
      await call<{ ok: true }>("/v1/remote/revoke-all", { method: "POST", body: "{}" });
    },

    listDispatchTasks: async () =>
      (await call<{ tasks: readonly DispatchTaskView[] }>("/v1/tasks")).tasks,
    runDispatchTask: async (taskId) =>
      (
        await call<{ run: DispatchRunView }>(
          `/v1/dispatch/tasks/${encodeURIComponent(taskId)}/run`,
          { method: "POST", body: "{}" },
        )
      ).run,
    listDispatchRuns: async () =>
      (await call<{ runs: readonly DispatchRunView[] }>("/v1/dispatch/runs")).runs,
    getDispatchRun: async (runId) =>
      (await call<{ run: DispatchRunView }>(`/v1/dispatch/runs/${encodeURIComponent(runId)}`)).run,
    cancelDispatchRun: async (runId) => {
      await call<{ cancelled: boolean }>(
        `/v1/dispatch/runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST", body: "{}" },
      );
    },

    listConversations: async (query, surface) => {
      const params = new URLSearchParams();
      const q = query?.trim();
      if (q !== undefined && q.length > 0) params.set("q", q);
      if (surface !== undefined) params.set("surface", surface);
      const suffix = params.toString();
      const path = suffix.length > 0 ? `/v1/conversations?${suffix}` : "/v1/conversations";
      return (await call<{ conversations: readonly ConversationSummary[] }>(path)).conversations;
    },

    createConversation: async (input) =>
      (await call<{ conversation: ConversationRecord }>("/v1/conversations", {
        method: "POST",
        body: JSON.stringify(input),
      })).conversation,

    getConversation: async (id) =>
      (await call<{ conversation: ConversationRecord }>(
        `/v1/conversations/${encodeURIComponent(id)}`,
      )).conversation,

    getLastActiveConversationId: async () =>
      (await call<{ conversationId: string | null }>("/v1/conversations/last-active"))
        .conversationId,

    patchConversation: async (id, patch) =>
      (await call<{ conversation: ConversationRecord }>(
        `/v1/conversations/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      )).conversation,

    deleteConversation: async (id) => {
      await call<{ deleted: boolean }>(`/v1/conversations/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },

    compactConversation: async (id) =>
      await call<{ summary: string }>(`/v1/conversations/${encodeURIComponent(id)}/compact`, {
        method: "POST",
      }),

    appendConversationMessage: async (id, role, text, attachments, skills) =>
      (await call<{ conversation: ConversationRecord }>(
        `/v1/conversations/${encodeURIComponent(id)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            role,
            text,
            ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
            ...(skills !== undefined && skills.length > 0 ? { skills } : {}),
          }),
        },
      )).conversation,

    listSkills: async () =>
      (await call<{ skills: readonly SkillView[] }>("/v1/skills")).skills,
    refreshSkills: async () =>
      (await call<{ skills: readonly SkillView[] }>("/v1/skills/refresh", {
        method: "POST",
        body: "{}",
      })).skills,
    setSkillEnabled: async (id, enabled) =>
      (await call<{ skill: SkillView }>(`/v1/skills/${encodeURIComponent(id)}/enabled`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      })).skill,
    enabledSkillSnapshots: async () =>
      (await call<{ skills: readonly EnabledSkillSnapshot[] }>("/v1/skills/enabled")).skills,
    previewSkill: async (id) =>
      (await call<{ preview: { readonly content: string; readonly truncated: boolean } }>(
        `/v1/skills/${encodeURIComponent(id)}/preview`,
      )).preview,
    readSkillContent: async (id) =>
      (await call<{ content: string }>(`/v1/skills/${encodeURIComponent(id)}/content`)).content,
    createSkill: async (input) =>
      (await call<{ skill: SkillView }>("/v1/skills", {
        method: "POST",
        body: JSON.stringify(input),
      })).skill,
    updateSkill: async (id, input) =>
      (await call<{ skill: SkillView }>(`/v1/skills/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      })).skill,
    deleteSkill: async (id) => {
      await call<{ ok: boolean }>(`/v1/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    listMcpServers: async () =>
      (await call<{ servers: readonly McpServerListItem[] }>("/v1/mcp/servers")).servers,

    createMcpServer: async (input) =>
      (
        await call<{ server: McpServerListItem }>("/v1/mcp/servers", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).server,

    updateMcpServer: async (id, input) =>
      (
        await call<{ server: McpServerListItem }>(`/v1/mcp/servers/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        })
      ).server,

    deleteMcpServer: async (id) => {
      await call<{ ok: boolean }>(`/v1/mcp/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    setMcpServerEnabled: async (id, enabled) =>
      (
        await call<{ server: McpServerListItem }>(
          `/v1/mcp/servers/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`,
          { method: "POST", body: "{}" },
        )
      ).server,

    mcpServerHealth: async (id) =>
      call<{ id: string; connection: string }>(`/v1/mcp/servers/${encodeURIComponent(id)}/health`),

    readWorkspaceAttachment: async (absolutePath, priorBytesUsed = 0) =>
      call<AttachmentReadResult>("/v1/workspace/attachment-read", {
        method: "POST",
        body: JSON.stringify({ absolutePath, priorBytesUsed }),
      }),

    continueRuntimeSession: async (sessionId) =>
      call<ContinueSessionResult>(
        `/v1/session/${encodeURIComponent(sessionId)}/continue`,
        { method: "POST", body: "{}" },
      ),

    getRuntimeSession: async (sessionId) => {
      const data = await call<{ session: SessionMeta; view: SessionView }>(
        `/v1/session/${encodeURIComponent(sessionId)}`,
      );
      return {
        session: data.session,
        view: data.view,
        canPrompt: data.view.terminal === null,
      };
    },

    getDiagnostics: () => call<DiagnosticsStatus>("/v1/diagnostics"),
    clearDiagnostics: (target) =>
      call<DiagnosticsStatus>("/v1/diagnostics/clear", {
        method: "POST",
        body: JSON.stringify({ target }),
      }),
    exportDiagnostics: () => call<DiagnosticsExport>("/v1/diagnostics/export"),

    previewWorkspaceFile: async (relativePath) =>
      (
        await call<{
          preview: {
            relativePath: string;
            kind: "text" | "binary" | "missing";
            content?: string;
            truncated: boolean;
            sizeBytes: number;
          };
        }>(`/v1/workspace/file-preview?path=${encodeURIComponent(relativePath)}`)
      ).preview,

    readWorkspaceFileContent: async (relativePath) =>
      (await call<{ file: WorkspaceFileContentView }>(
        `/v1/workspace/file-content?path=${encodeURIComponent(relativePath)}`,
      )).file,

    writeWorkspaceFileContent: async (relativePath, input) =>
      (
        await call<{ result: { relativePath: string; sizeBytes: number } }>(
          "/v1/workspace/file-content",
          { method: "PUT", body: JSON.stringify({ relativePath, ...input }) },
        )
      ).result,

    captureFileReviewSnapshot: async (relativePath) =>
      (
        await call<{ snapshot: import("@cowork-ghc/service/file-review").FileSnapshotCapture }>(
          "/v1/file-review/snapshot",
          { method: "POST", body: JSON.stringify({ relativePath }) },
        )
      ).snapshot,

    buildFileReview: async (input) =>
      (
        await call<{ review: import("@cowork-ghc/service/file-review").FileReviewArtifact }>(
          "/v1/file-review/build",
          { method: "POST", body: JSON.stringify(input) },
        )
      ).review,

    listPendingPermissions: permission.listPendingPermissions,
    decidePermission: permission.decidePermission,

    authStatus: () =>
      call<
        | { readonly state: "needs_setup" }
        | { readonly state: "locked"; readonly username: string }
        | { readonly state: "unlocked"; readonly username: string; readonly userId: string }
      >("/v1/auth/status"),
    authSetup: (username, password) =>
      call<{ readonly state: "unlocked"; readonly username: string; readonly userId: string }>(
        "/v1/auth/setup",
        { method: "POST", body: JSON.stringify({ username, password }) },
      ),
    authUnlock: (username, password) =>
      call<{ readonly state: "unlocked"; readonly username: string; readonly userId: string }>(
        "/v1/auth/unlock",
        { method: "POST", body: JSON.stringify({ username, password }) },
      ),

    getKnowledgeStatus: () => call<KnowledgeStatusView>("/v1/knowledge/status"),
    configureKnowledgeSource: (baseUrl, token) =>
      call<KnowledgeStatusView>("/v1/knowledge/configure", {
        method: "POST",
        body: JSON.stringify({ baseUrl, token }),
      }),
    testKnowledgeConnection: async () => {
      // The route returns the refreshed status; the settings panel re-reads it separately, so a
      // simple ok/throw is the honest signal here (a failed re-check throws from `call`).
      await call<KnowledgeStatusView>("/v1/knowledge/test-connection", { method: "POST" });
      return { ok: true };
    },
    disconnectKnowledgeSource: async () => {
      await call<{ readonly status: "not_configured" }>("/v1/knowledge/connection", {
        method: "DELETE",
      });
      return { status: "not_configured", baseUrl: null, lastHealthCheckAt: null };
    },

    knowledgeLocalStatus: async () =>
      (await call<{ status: KnowledgeIndexView }>("/v1/knowledge-local/status")).status,
    knowledgeLocalSync: async () =>
      (await call<{ status: KnowledgeIndexView }>("/v1/knowledge-local/sync", { method: "POST" })).status,
    knowledgeLocalCancel: async () =>
      (await call<{ status: KnowledgeIndexView }>("/v1/knowledge-local/cancel", { method: "POST" })).status,
    knowledgeLocalClear: async () =>
      (await call<{ status: KnowledgeIndexView }>("/v1/knowledge-local/clear", { method: "POST" })).status,
    knowledgeLocalSearch: async (query, limit) => {
      const params = new URLSearchParams({ q: query });
      if (limit !== undefined) params.set("limit", String(limit));
      return (await call<{ hits: readonly KnowledgeSearchHitView[] }>(`/v1/knowledge-local/search?${params.toString()}`)).hits;
    },
    knowledgeLocalGraph: async (limit) => {
      const suffix = limit !== undefined ? `?limit=${String(limit)}` : "";
      return (await call<{ graph: KnowledgeGraphApiResult }>(`/v1/knowledge-local/graph${suffix}`)).graph;
    },
    knowledgeLocalDocuments: async () =>
      (await call<{ documents: readonly KnowledgeDocumentView[] }>("/v1/knowledge-local/documents")).documents,

    connectMs365Token: async (token) =>
      call<Ms365ViewData>("/v1/ms365/connect", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),

    fetchMs365View: () => call<Ms365ViewData>("/v1/ms365/view"),

    beginMs365Device: () =>
      call<Ms365DeviceBeginResult>("/v1/ms365/device/begin", {
        method: "POST",
      }),

    pollMs365Device: () =>
      call<Ms365DevicePollResult>("/v1/ms365/device/poll", {
        method: "POST",
      }),

    disconnectMs365: () =>
      call<Ms365ViewData>("/v1/ms365/disconnect", {
        method: "POST",
      }),

    listMs365Sites: async () =>
      (await call<{ sites: readonly Ms365SiteView[] }>("/v1/ms365/sites")).sites,

    setMs365SiteEnabled: async (siteId, enabled) =>
      (
        await call<{ sites: readonly Ms365SiteView[] }>("/v1/ms365/sites/toggle", {
          method: "POST",
          body: JSON.stringify({ siteId, enabled }),
        })
      ).sites,

    fetchMs365WriteMode: () => call<{ mode: Ms365WriteMode }>("/v1/ms365/write-mode"),
    setMs365WriteMode: (mode) =>
      call<{ mode: Ms365WriteMode }>("/v1/ms365/write-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),

    setMs365SessionScope: (sessionId, enabled) =>
      call<{ allowed: boolean }>("/v1/ms365/session-scope", {
        method: "POST",
        body: JSON.stringify({ sessionId, enabled }),
      }),
  };
}
