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
import { type BoundaryErrorCode, type CredentialRef, type HealthData, type ModelRef, type WorkspaceGrant } from "@cowork-ghc/contracts";
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
}
/** The non-secret settings projection the service returns to the renderer (CGHC-022 SD1). */
export interface SettingsView {
    readonly general: GeneralSettingsView;
    readonly providers: readonly ProviderSettingsView[];
    readonly defaultModel: ModelRef | null;
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
    /** Clear a per-session model override so the session reverts to the default (LOW-1). */
    clearSessionModel(sessionId: string): Promise<ClearSessionModelResult>;
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