/**
 * Permission Allow/Deny modal (CGHC-017, P2 + F5) — a PURE render + callbacks surface.
 *
 * It holds NO transport and NO business logic: it is handed one authoritative
 * {@link PendingPermissionView} and two callbacks, and it only renders + reports the user's
 * intent. The controller ({@link ./permission-controller}) owns the HTTP client, so a Deny
 * here maps — through the client — to a REAL server-side block at the execution boundary
 * (frontend.md: "Deny must actually prevent the action"; enforcement is server-side, P3).
 *
 * Honesty / accessibility guarantees this component is responsible for:
 *  - P2: the action kind (in human terms) + description + targetPath are all rendered, so the
 *    user sees exactly what is being asked and its target.
 *  - F5 (SHOULD): before a mutation the human-readable `description` is shown, plus a LABELLED
 *    diff slot. The current pending projection carries description/targetPath, NOT full diff
 *    content, so the slot stays hidden — this component never FABRICATES a diff. Full diff
 *    content is a Tier-2/runtime enrichment (carry-forward): when the projection later carries
 *    diff text, populate `#permission-diff` from it.
 *  - Fail-safe: ESC and a backdrop click map to DENY, never to Allow. There is no code path
 *    from a dismissal to `onAllow`.
 *  - Focus is trapped inside the dialog while open and RESTORED to the previously-focused
 *    element on close. Focus lands on Deny first (so Enter/Space is fail-safe).
 *  - role="dialog" aria-modal="true" with a labelled title; every control is labelled; no
 *    secret is ever written into the DOM (the projection carries none).
 */
import type { PendingPermissionView } from "./service-client.js";
import type { PermissionScope } from "@cowork-ghc/contracts";
/** Callbacks the modal reports intent through. A dismissal (ESC/backdrop) routes to `onDeny`. */
export interface PermissionModalCallbacks {
    /** User approved; `scope` is the chosen once/always (default `once`). */
    onAllow(scope: PermissionScope): void;
    /** User denied OR dismissed (ESC/backdrop). Fail-safe: this NEVER allows. */
    onDeny(): void;
}
/** Handle to the open modal; `close()` tears it down and restores focus. */
export interface PermissionModalHandle {
    readonly root: HTMLElement;
    /** For the currently-shown head request (controller de-dupes by requestId). */
    readonly requestId: string;
    /**
     * Update the "other requests waiting behind this one" count while the modal stays open
     * (controller keeps the same head modal across refreshes). `0` hides the indicator. The
     * controller feeds this from the REAL pending list — the modal never invents a number.
     */
    setQueueCount(waiting: number): void;
    close(): void;
}
/** Open-time options for {@link openPermissionModal}. */
export interface PermissionModalOptions {
    /** Number of OTHER pending requests waiting behind this head; `>0` shows a queue indicator. */
    readonly queueCount?: number;
}
/** Open the permission modal for one pending request. Returns a handle to close it. */
export declare function openPermissionModal(container: HTMLElement, pending: PendingPermissionView, callbacks: PermissionModalCallbacks, options?: PermissionModalOptions): PermissionModalHandle;
//# sourceMappingURL=permission-modal.d.ts.map