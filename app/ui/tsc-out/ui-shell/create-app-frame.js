/**
 * V3 application frame composition.
 *
 * This module wires layout components together and exposes DOM handles for app-shell state.
 * Business behavior stays in app-shell.ts and service/controller modules.
 */
import { createActivityPanel, setRightPanelCollapsed } from "../activity-panel.js";
import { closeModalWithFocus, createModalKeyHandler, openModalWithFocus } from "../modal-focus.js";
import { createContextualSidebar } from "./contextual-sidebar.js";
import { createCoworkView } from "./cowork-view.js";
import { el, icon } from "./dom-utils.js";
import { createInspectorShell } from "./inspector.js";
import { createIntegrationView } from "./integration-view.js";
import { createKnowledgeView } from "./knowledge-view.js";
import { createProductRail } from "./product-rail.js";
import { createStatusBar } from "./status-bar.js";
import { createTopbar } from "./topbar.js";
import { createWorkspaceView } from "./workspace-view.js";
const DEFAULT_TITLE = "Cuộc trò chuyện mới";
export function createAppFrame(root) {
    root.className = "app-shell app";
    root.replaceChildren();
    const topbar = createTopbar();
    const rail = createProductRail();
    const sidebar = createContextualSidebar();
    const cowork = createCoworkView(DEFAULT_TITLE);
    const workspaceView = createWorkspaceView();
    const knowledgeView = createKnowledgeView();
    const integrationSurface = createIntegrationView();
    const inspector = createInspectorShell();
    const statusBar = createStatusBar();
    const shellFrame = el("main", "shell shell-frame");
    shellFrame.append(rail.root, sidebar.root, cowork.root, workspaceView.root, knowledgeView.root, integrationSurface, inspector.root);
    const drawerScrim = el("div", "drawer-scrim");
    drawerScrim.hidden = true;
    const settingsModal = el("div", "modal");
    settingsModal.hidden = true;
    settingsModal.setAttribute("role", "dialog");
    settingsModal.setAttribute("aria-modal", "true");
    settingsModal.setAttribute("aria-label", "Cài đặt");
    settingsModal.setAttribute("aria-hidden", "true");
    const settingsPanel = el("div", "modal__panel");
    const settingsHeader = el("div", "modal__header");
    const modalTitle = el("h2", "modal__title", "Cài đặt");
    modalTitle.tabIndex = -1;
    const closeSettings = el("button", "icon-btn", "Đóng");
    closeSettings.type = "button";
    settingsHeader.append(modalTitle, closeSettings);
    const settingsBody = el("div", "modal__body");
    settingsPanel.append(settingsHeader, settingsBody);
    settingsModal.append(settingsPanel);
    const skillsPanel = el("section", "skills-panel skills-drawer");
    skillsPanel.hidden = true;
    root.append(topbar.root, shellFrame, statusBar.root, drawerScrim, settingsModal, skillsPanel);
    let settingsOpener = null;
    const modalKeyHandler = createModalKeyHandler({
        panel: settingsPanel,
        closeButton: closeSettings,
        onClose: () => {
            closeModalWithFocus(settingsModal, settingsOpener, modalKeyHandler);
            settingsOpener = null;
        },
    });
    const activityPanel = createActivityPanel(inspector.root);
    const dom = {
        root,
        shellFrame,
        drawerScrim,
        serviceStatus: statusBar.service,
        providerStatus: statusBar.provider,
        serviceDetail: statusBar.service,
        statusBar,
        workspaceLabel: sidebar.workspaceLabel,
        modelLabel: statusBar.provider,
        sessionSearch: sidebar.sessionSearch,
        sessionList: sidebar.sessionList,
        chatTitle: cowork.chatTitle,
        chatSub: cowork.chatSub,
        chat: cowork.root,
        coworkView: cowork.root,
        workspaceView,
        knowledgeView,
        transcript: cowork.transcript,
        continuationBanner: cowork.continuationBanner,
        continuationButton: cowork.continuationButton,
        transcriptInner: cowork.transcriptInner,
        emptyState: cowork.emptyState,
        emptyStateCta: cowork.emptyStateCta,
        thinking: cowork.thinking,
        composer: cowork.composer,
        composerInput: cowork.composerInput,
        composerHint: cowork.composerHint,
        composerPreflight: cowork.composerPreflight,
        composerPreflightMessage: cowork.composerPreflightMessage,
        composerPreflightCta: cowork.composerPreflightCta,
        attachButton: cowork.attachButton,
        attachmentChips: cowork.attachmentChips,
        sendButton: cowork.sendButton,
        cancelButton: cowork.cancelButton,
        newConversationButton: sidebar.newConversationButton,
        providerControl: cowork.providerControl,
        skillsButton: cowork.skillsButton,
        settingsModal,
        settingsPanel,
        settingsBody,
        settingsButton: topbar.settingsButton,
        closeSettingsButton: closeSettings,
        settingsOpener: null,
        modalKeyHandler,
        activityPanel,
        executionStatus: inspector.executionStatus,
        permissionSummary: inspector.permissionSummary,
        sidebar: sidebar.root,
        rightPanel: inspector.root,
        activityMobileToggle: topbar.inspectorToggle,
        sidebarToggle: rail.sidebarToggle,
        workModeCoworkTab: sidebar.workModeCoworkTab,
        workModeWorkspaceTab: sidebar.workModeWorkspaceTab,
        coworkSidebarPanel: sidebar.coworkPanel,
        workspaceSidebarPanel: sidebar.workspacePanel,
        skillsPanel,
        productRail: rail.root,
        surfaceButtons: rail.surfaceButtons,
        integrationSurface,
        workspaceNavigatorSlot: sidebar.workspaceNavigatorSlot,
        workspaceBox: sidebar.workspaceBox,
        rightPanelTopbarToggle: topbar.inspectorToggle,
        sidebarRailToggle: rail.sidebarToggle,
        openSettings: () => undefined,
        applySidebarCollapsed: () => undefined,
        applyRightPanelCollapsed: () => undefined,
    };
    const openSettings = () => {
        settingsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : topbar.settingsButton;
        const initial = settingsBody.querySelector(".llm-provider-select") ??
            settingsBody.querySelector(".llm-settings-title") ??
            closeSettings;
        openModalWithFocus(settingsModal, initial, modalKeyHandler);
    };
    dom.openSettings = openSettings;
    topbar.settingsButton.addEventListener("click", openSettings);
    statusBar.provider.addEventListener("click", openSettings);
    cowork.providerControl.root.addEventListener("click", openSettings);
    cowork.composerPreflightCta.addEventListener("click", openSettings);
    cowork.emptyStateCta.addEventListener("click", openSettings);
    closeSettings.addEventListener("click", () => {
        closeModalWithFocus(settingsModal, settingsOpener, modalKeyHandler);
        settingsOpener = null;
    });
    const setDrawerOpen = (kind) => {
        shellFrame.classList.toggle("sidebar-drawer-open", kind === "sidebar");
        shellFrame.classList.toggle("inspector-drawer-open", kind === "inspector");
        drawerScrim.hidden = kind === null;
    };
    const applySidebarCollapsed = (collapsed) => {
        shellFrame.classList.toggle("sidebar-collapsed", collapsed);
        sidebar.root.hidden = collapsed;
        rail.sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        rail.sidebarToggle.title = collapsed ? "Mở sidebar" : "Thu gọn sidebar";
        rail.sidebarToggle.setAttribute("aria-label", rail.sidebarToggle.title);
    };
    dom.applySidebarCollapsed = applySidebarCollapsed;
    const applyRightPanelCollapsed = (collapsed) => {
        setRightPanelCollapsed(inspector.root, activityPanel.toggle, collapsed);
        inspector.root.hidden = collapsed;
        topbar.inspectorToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        const inspectorLabel = collapsed ? "Mở inspector" : "Đóng inspector";
        topbar.inspectorToggle.title = inspectorLabel;
        topbar.inspectorToggle.dataset["tooltip"] = inspectorLabel;
        topbar.inspectorToggle.setAttribute("aria-label", inspectorLabel);
        topbar.inspectorToggle.replaceChildren(icon(collapsed ? "panel-right-open" : "panel-right-close", inspectorLabel));
        topbar.inspectorToggle.title = collapsed ? "Mở inspector" : "Đóng inspector";
        topbar.inspectorToggle.setAttribute("aria-label", topbar.inspectorToggle.title);
        topbar.inspectorToggle.title = inspectorLabel;
        topbar.inspectorToggle.dataset["tooltip"] = inspectorLabel;
        topbar.inspectorToggle.setAttribute("aria-label", inspectorLabel);
        shellFrame.classList.toggle("inspector-drawer-open", !collapsed && window.matchMedia("(max-width: 1366px)").matches);
        drawerScrim.hidden = collapsed || !window.matchMedia("(max-width: 1366px)").matches;
    };
    dom.applyRightPanelCollapsed = applyRightPanelCollapsed;
    rail.sidebarToggle.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 900px)").matches) {
            const next = shellFrame.classList.contains("sidebar-drawer-open") ? null : "sidebar";
            setDrawerOpen(next);
            return;
        }
        applySidebarCollapsed(!sidebar.root.hidden);
    });
    topbar.inspectorToggle.addEventListener("click", () => {
        applyRightPanelCollapsed(!inspector.root.hidden);
    });
    const workModeTabs = [sidebar.workModeCoworkTab, sidebar.workModeWorkspaceTab];
    for (const tab of workModeTabs) {
        tab.addEventListener("keydown", (event) => {
            const current = workModeTabs.indexOf(tab);
            const nextIndex = event.key === "ArrowRight"
                ? (current + 1) % workModeTabs.length
                : event.key === "ArrowLeft"
                    ? (current + workModeTabs.length - 1) % workModeTabs.length
                    : event.key === "Home"
                        ? 0
                        : event.key === "End"
                            ? workModeTabs.length - 1
                            : -1;
            if (nextIndex < 0)
                return;
            const nextTab = workModeTabs[nextIndex];
            if (nextTab === undefined)
                return;
            event.preventDefault();
            nextTab.focus();
            nextTab.click();
        });
    }
    activityPanel.toggle.addEventListener("click", () => {
        applyRightPanelCollapsed(true);
    });
    drawerScrim.addEventListener("click", () => setDrawerOpen(null));
    return dom;
}
//# sourceMappingURL=create-app-frame.js.map