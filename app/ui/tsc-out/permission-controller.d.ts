/**
 * Permission controller (CGHC-017) — owns transport + lifecycle for the Allow/Deny modal.
 *
 * The modal ({@link ./permission-modal}) is a pure render + callbacks; THIS module is the only
 * place that talks to the loopback service (via the typed {@link ServiceClient}). It keeps
 * business logic OUT of the view (frontend.md) and renders execution visibility honestly:
 *  - It reflects ONLY real pending requests. When the list is empty (the normal pre-Tier-2
 *    state, no live session), it shows NOTHING — never fabricated activity.
 *  - It surfaces the HEAD pending request as a modal, de-duped by `requestId` so a refresh that
 *    returns the same head does not tear down and re-open the open modal.
 *  - On Allow/Deny it POSTs the decision, then refreshes. A Deny maps to a REAL server-side
 *    block (P3, enforced at the execution boundary — not here).
 *  - An `unknown` / `already_resolved` outcome closes the modal with a TRUTHFUL note, never a
 *    fabricated success.
 */
import type { PermissionDecision } from "@cowork-ghc/contracts";
import type { PendingPermissionView, PermissionDecisionResponse, ServiceClient } from "./service-client.js";
/**
 * Injectable timer seam so tests can drive the polling lifecycle deterministically (no real
 * waits). Defaults to the host `setInterval`/`clearInterval`. The handle is opaque (`unknown`)
 * so a fake can return any token.
 */
export interface PermissionControllerTimer {
    setInterval(handler: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}
/**
 * Injectable visibility seam (CGHC-017 Info) so tests drive the tab-hidden lifecycle without a
 * real `visibilitychange` event. Defaults to the `document` visibility API. While the tab is
 * hidden the controller PAUSES polling (no wasted loopback calls); on return to visible it
 * resumes the bounded interval and refreshes once.
 */
export interface PermissionControllerVisibility {
    isHidden(): boolean;
    addVisibilityListener(handler: () => void): void;
    removeVisibilityListener(handler: () => void): void;
}
export interface PermissionControllerDeps {
    readonly client: Pick<ServiceClient, "listPendingPermissions" | "decidePermission">;
    /** Where the modal + status note mount (usually the app root). */
    readonly container: HTMLElement;
    /** Poll cadence for `start()`; defaults to 500ms while the app is active. */
    readonly pollIntervalMs?: number;
    /** Timer seam; defaults to host `setInterval`/`clearInterval`. Tests inject a fake. */
    readonly timer?: PermissionControllerTimer;
    /** Visibility seam; defaults to the `document` visibility API. Tests inject a fake. */
    readonly visibility?: PermissionControllerVisibility;
    /** Fired when a pending permission is shown (read-only history seed). */
    readonly onPending?: (request: PendingPermissionView) => void;
    /** Fired after a decision POST returns (resolved / already_resolved). */
    readonly onDecision?: (input: {
        readonly request: PendingPermissionView;
        readonly outcome: PermissionDecisionResponse;
        readonly requestedDecision: PermissionDecision;
    }) => void;
}
export interface PermissionControllerHandle {
    /** Fetch pending requests once and reconcile the modal against them. */
    refresh(): Promise<void>;
    /** Begin periodic polling. */
    start(): void;
    /** Stop polling and close any open modal. */
    stop(): void;
}
export declare function createPermissionController(deps: PermissionControllerDeps): PermissionControllerHandle;
//# sourceMappingURL=permission-controller.d.ts.map