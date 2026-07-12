/**
 * Placeholder renderer view.
 *
 * A tiny, HONEST status surface for the scaffold: it shows the real connection phase to
 * the loopback service and never fabricates a "completed"/"ready" state (frontend rule:
 * render execution visibility honestly). Real features — workspace picker (CGHC-008), EV
 * timeline (CGHC-015), permission UI (CGHC-017), settings (CGHC-022) — replace this. It
 * builds DOM via `textContent` only, so no untrusted string is ever parsed as HTML and no
 * secret is written into the DOM.
 */
import type { ServiceHealth } from "./service-client.js";
export type ViewState = {
    readonly phase: "connecting";
} | {
    readonly phase: "ready";
    readonly health: ServiceHealth;
} | {
    readonly phase: "error";
    readonly message: string;
};
/** Render the current view state into `root`, replacing prior content. */
export declare function renderView(root: HTMLElement, state: ViewState): void;
//# sourceMappingURL=view.d.ts.map