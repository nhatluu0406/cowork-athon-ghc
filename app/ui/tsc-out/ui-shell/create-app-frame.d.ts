/**
 * V3 application frame composition.
 *
 * This module wires layout components together and exposes DOM handles for app-shell state.
 * Business behavior stays in app-shell.ts and service/controller modules.
 */
import { type ActivityPanelDom } from "../activity-panel.js";
import type { ProductSurfaceId } from "../surface-registry.js";
import { type KnowledgeViewDom } from "./knowledge-view.js";
import { type StatusBarDom } from "./status-bar.js";
import { type WorkspaceViewDom } from "./workspace-view.js";
import type { ConversationProviderControl } from "./conversation-provider-control.js";
export interface AppFrameDom {
    readonly root: HTMLElement;
    readonly shellFrame: HTMLElement;
    readonly drawerScrim: HTMLElement;
    readonly serviceStatus: HTMLElement;
    readonly providerStatus: HTMLElement;
    readonly serviceDetail: HTMLElement;
    readonly statusBar: StatusBarDom;
    readonly workspaceLabel: HTMLElement;
    readonly modelLabel: HTMLElement;
    readonly sessionSearch: HTMLInputElement;
    readonly sessionList: HTMLElement;
    readonly chatTitle: HTMLElement;
    readonly chatSub: HTMLElement;
    readonly chat: HTMLElement;
    readonly coworkView: HTMLElement;
    readonly workspaceView: WorkspaceViewDom;
    readonly knowledgeView: KnowledgeViewDom;
    readonly transcript: HTMLElement;
    readonly continuationBanner: HTMLElement;
    readonly continuationButton: HTMLButtonElement;
    readonly transcriptInner: HTMLElement;
    readonly emptyState: HTMLElement;
    readonly thinking: HTMLElement;
    readonly composer: HTMLElement;
    readonly composerInput: HTMLElement;
    readonly composerHint: HTMLElement;
    readonly composerPreflight: HTMLElement;
    readonly composerPreflightMessage: HTMLElement;
    readonly composerPreflightCta: HTMLButtonElement;
    readonly attachButton: HTMLButtonElement;
    readonly attachmentChips: HTMLElement;
    readonly sendButton: HTMLButtonElement;
    readonly cancelButton: HTMLButtonElement;
    readonly newConversationButton: HTMLButtonElement;
    readonly providerControl: ConversationProviderControl;
    readonly skillsButton: HTMLButtonElement;
    readonly settingsModal: HTMLElement;
    readonly settingsPanel: HTMLElement;
    readonly settingsBody: HTMLElement;
    readonly settingsButton: HTMLButtonElement;
    readonly closeSettingsButton: HTMLButtonElement;
    settingsOpener: HTMLElement | null;
    readonly modalKeyHandler: (event: KeyboardEvent) => void;
    readonly activityPanel: ActivityPanelDom;
    readonly executionStatus: HTMLElement;
    readonly permissionSummary: HTMLElement;
    readonly sidebar: HTMLElement;
    readonly rightPanel: HTMLElement;
    readonly activityMobileToggle: HTMLButtonElement;
    readonly sidebarToggle: HTMLButtonElement;
    readonly workModeCoworkTab: HTMLButtonElement;
    readonly workModeWorkspaceTab: HTMLButtonElement;
    readonly coworkSidebarPanel: HTMLElement;
    readonly workspaceSidebarPanel: HTMLElement;
    readonly skillsPanel: HTMLElement;
    readonly productRail: HTMLElement;
    readonly surfaceButtons: Map<ProductSurfaceId, HTMLButtonElement>;
    readonly integrationSurface: HTMLElement;
    readonly workspaceNavigatorSlot: HTMLElement;
    readonly workspaceBox: HTMLElement;
    readonly rightPanelTopbarToggle: HTMLButtonElement;
    readonly sidebarRailToggle: HTMLButtonElement;
    openSettings: () => void;
    applySidebarCollapsed: (collapsed: boolean) => void;
    applyRightPanelCollapsed: (collapsed: boolean) => void;
}
export declare function createAppFrame(root: HTMLElement): AppFrameDom;
//# sourceMappingURL=create-app-frame.d.ts.map