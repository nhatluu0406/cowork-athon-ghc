/**
 * Centralized provider + send readiness (renderer).
 *
 * Distinguishes local service health from provider configuration readiness.
 */
import type { ConversationRecord } from "./service-client.js";
import type { SettingsView } from "./service-client.js";
import type { ReadinessState } from "./readiness-controller.js";
import type { RuntimePhase } from "./conversation-controller.js";
export type ReadinessKind = "local_service_unavailable" | "workspace_missing" | "provider_missing" | "model_missing" | "credential_missing" | "base_url_invalid" | "locally_ready" | "connectivity_failed" | "runtime_starting" | "runtime_running" | "runtime_terminal" | "composer_locked" | "runtime_busy";
export type ConnectionTestState = "unknown" | "ok" | "failed";
export interface ProviderReadinessInput {
    readonly localServiceReady: boolean;
    readonly activeWorkspace: string | null;
    readonly settings: SettingsView | null;
    readonly runtimePhase: RuntimePhase;
    readonly activeConversationId: string | null;
    readonly activeRecord: ConversationRecord | null;
    readonly composerLocked: boolean;
    readonly connectionTestState: ConnectionTestState;
}
export interface SendPreflight {
    readonly canSend: boolean;
    readonly blockKind: ReadinessKind | null;
    readonly message: string;
    readonly showSettingsCta: boolean;
}
export interface StatusCopy {
    readonly label: string;
    readonly detail: string;
    readonly ok: boolean;
}
export declare function localServiceStatus(state: ReadinessState): StatusCopy;
export declare function isBaseUrlLocallyValid(baseUrl: string | undefined): boolean;
export declare function providerStatus(settings: SettingsView | null, connectionTestState?: ConnectionTestState): StatusCopy;
export declare function runtimeReadinessKind(phase: RuntimePhase): ReadinessKind;
export declare function assessSendPreflight(input: ProviderReadinessInput): SendPreflight;
export declare function shouldShowContinuationBanner(activeConversationId: string | null, record: ConversationRecord | null, runtimePhase: RuntimePhase): boolean;
export declare function buildReadinessInput(localServiceReady: boolean, state: {
    activeWorkspace: string | null;
    settings: SettingsView | null;
    conv: {
        state: {
            runtimePhase: RuntimePhase;
            activeConversationId: string | null;
            activeRecord: ConversationRecord | null;
        };
    };
    continuationUnlocked: boolean;
    connectionTestState: ConnectionTestState;
}): ProviderReadinessInput;
//# sourceMappingURL=provider-readiness.d.ts.map