/**
 * Minimal live-session surface (Slice 4): explicit start, prompt, streaming, cancel.
 *
 * OpenCode starts only after the user clicks "Bắt đầu phiên" (shell `connectLive`). The panel
 * re-handshakes with the service, creates a session, opens the EV stream, and renders honest
 * status — never fabricated completion or internal debug ids.
 */
import type { CoworkShellBridge } from "@cowork-ghc/contracts";
import type { ServiceClient } from "./service-client.js";
import type { TimelineHandle } from "./timeline-view.js";
export type SessionPanelPhase = "idle" | "starting" | "running" | "completed" | "failed" | "cancelled";
export interface SessionPanelDeps {
    readonly bridge: CoworkShellBridge;
    readonly getClient: () => ServiceClient | null;
    readonly reconnect: () => void;
    readonly timeline: TimelineHandle;
    readonly sleep?: (ms: number) => Promise<void>;
}
export interface SessionPanelHandle {
    readonly root: HTMLElement;
}
export declare function mountSessionPanel(container: HTMLElement, deps: SessionPanelDeps): SessionPanelHandle;
//# sourceMappingURL=session-panel.d.ts.map