/**
 * Knowledge settings section — configure/test-connection/disconnect (T2.6).
 *
 * Reuses existing Settings UX conventions (diagnostics/settings-router.ts pattern).
 * Enforces FR-013/SEC-2: token field is empty on load, cleared after submit, never in state.
 *
 * Routes:
 * - POST /v1/knowledge/configure (baseUrl, token)
 * - POST /v1/knowledge/test-connection
 * - DELETE /v1/knowledge/connection
 * - GET /v1/knowledge/status
 */
import type { ServiceClient } from "./service-client.js";
export interface KnowledgeSettingsDom {
    readonly root: HTMLElement;
    readonly baseUrlInput: HTMLInputElement;
    readonly tokenInput: HTMLInputElement;
    readonly saveButton: HTMLButtonElement;
    readonly testButton: HTMLButtonElement;
    readonly disconnectButton: HTMLButtonElement;
    readonly statusDisplay: HTMLElement;
}
export declare function mountKnowledgeSettingsPanel(host: HTMLElement, config: {
    client: Pick<ServiceClient, "getKnowledgeStatus" | "configureKnowledgeSource" | "testKnowledgeConnection" | "disconnectKnowledgeSource">;
}): void;
//# sourceMappingURL=knowledge-settings.d.ts.map