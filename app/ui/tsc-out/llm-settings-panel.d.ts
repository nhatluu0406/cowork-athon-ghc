/**
 * LLM settings panel (Slice 3 — CGHC-011 / CGHC-019).
 *
 * Thin renderer client: provider preset selection, model persistence, credential store/delete,
 * and bounded test-connection through the loopback service. No secret is ever read back or
 * written into persistent renderer state beyond the password field (cleared after save).
 */
import type { RendererBootstrap } from "@cowork-ghc/contracts";
import type { ServiceClient, SettingsView } from "./service-client.js";
export interface LlmSettingsPanelDeps {
    readonly client: Pick<ServiceClient, "getSettings" | "listProviders" | "setProviderBaseUrl" | "setProviderEnvVar" | "setDefaultModel" | "storeProviderCredential" | "removeProviderCredential" | "importProviderCredentialFromEnv" | "testProviderConnection">;
    readonly getBootstrap?: () => Promise<RendererBootstrap>;
    readonly onSettingsUpdated?: (view: SettingsView) => void;
    readonly onConnectionTestResult?: (ok: boolean) => void;
}
/** Mount the LLM settings panel into `container`. */
export declare function mountLlmSettingsPanel(container: HTMLElement, deps: LlmSettingsPanelDeps): void;
//# sourceMappingURL=llm-settings-panel.d.ts.map