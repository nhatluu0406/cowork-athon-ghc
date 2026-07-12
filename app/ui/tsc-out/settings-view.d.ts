/**
 * Settings view (CGHC-022 SD1/SD4/LOW-1) — renderer side.
 *
 * A thin CLIENT of the loopback service with NO business logic: it renders whatever the
 * service returns and calls typed client methods to persist edits. The service owns the
 * settings store, validation, redaction, and the credential HANDLE — the renderer never
 * touches the filesystem or the credential store and never holds key bytes.
 *
 * It shows: general settings (theme + verbose logging + telemetry), each provider's
 * credential-binding STATUS (hasCredential + the non-secret account label — never a key)
 * and base_url, the persisted default-model preference, and a control to clear the current
 * session's model override so it reverts to the default (LOW-1).
 *
 * DOM is built with `textContent` only (no HTML parsing); controls are keyboard-reachable
 * and labelled; no secret is ever written into the DOM.
 */
import type { ServiceClient } from "./service-client.js";
export interface SettingsViewDeps {
    readonly client: Pick<ServiceClient, "getSettings" | "updateGeneral">;
}
/** Mount the settings view into `container`. Returns nothing; it manages its own state. */
export declare function mountSettingsView(container: HTMLElement, deps: SettingsViewDeps): void;
//# sourceMappingURL=settings-view.d.ts.map