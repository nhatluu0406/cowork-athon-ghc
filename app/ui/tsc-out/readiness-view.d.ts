/**
 * Progressive readiness view (CGHC-025) — a pure render of {@link ReadinessState}.
 *
 * Honest boot surface: it shows the REAL phase the controller reports and never fabricates a
 * "ready"/"completed" state (frontend.md). It holds NO business logic and NO transport — the
 * {@link ReadinessControllerHandle} owns polling/backoff and calls {@link ReadinessViewHandle.update}.
 * The only interactive surface is recovery: a keyboard-reachable Retry button (calls back into
 * the controller) and a native `<details>` "View diagnostics" affordance that reveals the last
 * scrubbed, non-secret error detail. The token / base URL are NEVER written into the DOM.
 *
 * Built via `textContent` only, so no untrusted string is parsed as HTML. Accessibility: the
 * phase line is a `role="status"` `aria-live` region; entering an error phase moves focus to the
 * Retry action so a keyboard/screen-reader user is taken straight to the recovery path.
 */
import type { ReadinessState } from "./readiness-controller.js";
export interface ReadinessViewHandle {
    /** The mounted root element (already appended to the container). */
    readonly root: HTMLElement;
    /** Render the given readiness state honestly. */
    update(state: ReadinessState): void;
    /** Remove the surface from the DOM. */
    destroy(): void;
}
export declare function createReadinessView(container: HTMLElement, opts: {
    onRetry: () => void;
}): ReadinessViewHandle;
//# sourceMappingURL=readiness-view.d.ts.map