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
import { type BoundaryErrorCode, type CredentialRef, type HealthData, type ModelRef, type ProviderDescriptor, type SessionMeta, type TestResult, type WorkspaceGrant } from "@cowork-ghc/contracts";
import type { SessionView } from "@cowork-ghc/service/execution";
import { type DecidePermissionInput, type PendingPermissionView, type PermissionDecisionResponse } from "./permission-client.js";
export type { DecidePermissionInput, PendingPermissionView, PermissionDecisionResponse, } from "./permission-client.js";
/**
 * The built-in `GET /v1/health` payload — the SAME canonical {@link HealthData} the
 * service produces (via `@cowork-ghc/contracts`). Aliased so renderer imports (readiness
 * controller/view) keep the `ServiceHealth` name; the literal `status: "ok"` is preserved,
 * not widened to `string`.
 */
export type ServiceHealth = HealthData;
/** Non-secret rejection reasons mirrored from the service (CGHC-008). */
export type WorkspaceRejectReason = "not_absolute" | "unc_path" | "not_found" | "not_a_directory" | "not_writable";
/** Outcome of asking the service to validate + grant a chosen folder. */
export type WorkspaceGrantResult = {
    readonly granted: true;
    readonly grant: WorkspaceGrant;
} | {
    readonly granted: false;
    readonly reason: WorkspaceRejectReason;
    readonly message: string;
};
/** A recent workspace decorated with a freshly-probed availability flag. */
export interface RecentWorkspaceView {
    readonly id: string;
    readonly rootPath: string;
    readonly lastOpenedAt: string;
    readonly available: boolean;
}
/** UI theme preference mirrored from the service (CGHC-022). */
export type ThemePreference = "system" | "light" | "dark";
/** General settings mirrored from the service. Non-secret. */
export interface GeneralSettingsView {
    readonly theme: ThemePreference;
    readonly verboseLogging: boolean;
    readonly telemetryEnabled: boolean;
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
/** The non-secret settings projection the service returns to the renderer (CGHC-022 SD1). */
export interface SettingsView {
    readonly general: GeneralSettingsView;
    readonly providers: readonly ProviderSettingsView[];
    readonly defaultModel: ModelRef | null;
    readonly activeWorkspace: {
        readonly rootPath: string;
    } | null;
}
/** Result of dispatching a prompt to a live session. */
export type SendSessionMessageResult = {
    readonly accepted: true;
    readonly sessionId: string;
} | {
    readonly accepted: false;
    readonly reason: string;
    readonly sessionId: string;
};
/** Input for creating a session bound to the active workspace. */
export interface CreateSessionInput {
    readonly workspaceId: string;
    readonly title?: string;
    readonly model?: ModelRef;
}
export type ConversationStatus = "draft" | "ready" | "running" | "completed" | "cancelled" | "errored" | "interrupted";
export interface ConversationMessage {
    readonly id: string;
    readonly role: "user" | "assistant";
    readonly text: string;
    readonly at: string;
}
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
    readonly activity?: PersistedActivitySnapshot;
    readonly runtimeTurns?: readonly RuntimeTurnRecord[];
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
/**
 * Client-side failure code: either a real {@link BoundaryErrorCode} from the service's
 * error envelope, or `"protocol_mismatch"` when the envelope's protocol tag does not match
 * {@link BOUNDARY_PROTOCOL_VERSION} (a drifted/wrong wire contract we refuse rather than
 * silently accept).
 */
export type ServiceClientErrorCode = BoundaryErrorCode | "protocol_mismatch";
/** Error surfaced by the client; carries a stable, non-secret code. */
export declare class ServiceClientError extends Error {
    readonly code: ServiceClientErrorCode;
    constructor(code: ServiceClientErrorCode, message: string);
}
/** The renderer-visible client surface. Extended by later UI tasks. */
export interface ServiceClient {
    health(): Promise<ServiceHealth>;
    /**
     * Send the folder the user picked to the service for server-side validation + grant. The UI
     * never validates or grants itself — it renders whichever {@link WorkspaceGrantResult} comes
     * back. A `granted:false` result must NOT become the active workspace / start a session.
     */
    grantWorkspace(rootPath: string): Promise<WorkspaceGrantResult>;
    /** List recent workspaces, each with a server-probed `available` flag. */
    recentWorkspaces(): Promise<readonly RecentWorkspaceView[]>;
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
    /** List persisted conversations (optional local search query). */
    listConversations(query?: string): Promise<readonly ConversationSummary[]>;
    createConversation(input: CreateConversationInput): Promise<ConversationRecord>;
    getConversation(id: string): Promise<ConversationRecord>;
    getLastActiveConversationId(): Promise<string | null>;
    patchConversation(id: string, patch: {
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
    }): Promise<ConversationRecord>;
    deleteConversation(id: string): Promise<void>;
    appendConversationMessage(id: string, role: "user" | "assistant", text: string): Promise<ConversationRecord>;
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
}
/** Create a client bound to a loopback base URL + per-launch token. */
export declare function createServiceClient(baseUrl: string, clientToken: string): ServiceClient;
//# sourceMappingURL=service-client.d.ts.map