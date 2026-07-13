/**
 * V3 application frame composition.
 *
 * This module wires layout components together and exposes DOM handles for app-shell state.
 * Business behavior stays in app-shell.ts and service/controller modules.
 */
import { createActivityPanel, setRightPanelCollapsed } from "../activity-panel.js";
import { createContextualSidebar } from "./contextual-sidebar.js";
import { createCoworkView } from "./cowork-view.js";
import { el, icon } from "./dom-utils.js";
import { createInspectorShell } from "./inspector.js";
import { createIntegrationView } from "./integration-view.js";
import { createKnowledgeView } from "./knowledge-view.js";
import { createProductRail } from "./product-rail.js";
import { createStatusBar } from "./status-bar.js";
import { createTopbar } from "./topbar.js";
import { installShellTooltips } from "./tooltip.js";
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
    const settingsSurface = createSettingsSurface();
    const inspector = createInspectorShell();
    const statusBar = createStatusBar();
    const shellFrame = el("main", "shell shell-frame");
    shellFrame.append(rail.root, sidebar.root, cowork.root, workspaceView.root, knowledgeView.root, integrationSurface, settingsSurface.root, inspector.root);
    const drawerScrim = el("div", "drawer-scrim");
    drawerScrim.hidden = true;
    const skillsPanel = el("section", "skills-panel skills-drawer");
    skillsPanel.hidden = true;
    root.append(topbar.root, shellFrame, statusBar.root, drawerScrim, skillsPanel);
    installShellTooltips(root);
    let settingsOpener = null;
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
        settingsSurface: settingsSurface.root,
        settingsProviderBody: settingsSurface.providerBody,
        settingsGeneralBody: settingsSurface.generalBody,
        settingsButton: topbar.settingsButton,
        closeSettingsButton: settingsSurface.closeButton,
        settingsOpener: null,
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
        closeSettings: () => undefined,
        closeDrawers: () => undefined,
        applySidebarCollapsed: () => undefined,
        applyRightPanelCollapsed: () => undefined,
    };
    const closeSettings = () => {
        settingsSurface.root.hidden = true;
        shellFrame.classList.remove("shell-frame--settings");
        settingsOpener?.focus();
        settingsOpener = null;
    };
    const openSettings = () => {
        settingsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : topbar.settingsButton;
        dom.closeDrawers();
        settingsSurface.root.hidden = false;
        shellFrame.classList.add("shell-frame--settings");
        settingsSurface.showTab("provider");
        const initial = settingsSurface.providerBody.querySelector(".llm-provider-select") ?? settingsSurface.providerTab;
        initial.focus();
    };
    dom.openSettings = openSettings;
    dom.closeSettings = closeSettings;
    topbar.settingsButton.addEventListener("click", openSettings);
    statusBar.provider.addEventListener("click", openSettings);
    cowork.providerControl.root.addEventListener("click", openSettings);
    cowork.composerPreflightCta.addEventListener("click", openSettings);
    cowork.emptyStateCta.addEventListener("click", openSettings);
    settingsSurface.closeButton.addEventListener("click", closeSettings);
    settingsSurface.backButton.addEventListener("click", closeSettings);
    settingsSurface.root.addEventListener("keydown", (event) => {
        if (event.key === "Escape")
            closeSettings();
    });
    const isSidebarDrawerViewport = () => window.matchMedia("(max-width: 900px)").matches;
    const isInspectorDrawerViewport = () => window.matchMedia("(max-width: 1024px)").matches;
    const setDrawerOpen = (kind) => {
        shellFrame.classList.toggle("sidebar-drawer-open", kind === "sidebar");
        shellFrame.classList.toggle("inspector-drawer-open", kind === "inspector");
        drawerScrim.hidden = kind === null;
    };
    dom.closeDrawers = () => setDrawerOpen(null);
    const syncResponsiveDrawers = () => {
        if (shellFrame.classList.contains("sidebar-drawer-open") && !isSidebarDrawerViewport()) {
            setDrawerOpen(null);
        }
        if (inspector.root.hidden) {
            if (shellFrame.classList.contains("inspector-drawer-open"))
                setDrawerOpen(null);
            return;
        }
        if (isInspectorDrawerViewport()) {
            setDrawerOpen("inspector");
            return;
        }
        if (shellFrame.classList.contains("inspector-drawer-open"))
            setDrawerOpen(null);
    };
    const applySidebarCollapsed = (collapsed) => {
        shellFrame.classList.toggle("sidebar-collapsed", collapsed);
        sidebar.root.hidden = collapsed;
        const sidebarLabel = collapsed ? "Mở sidebar" : "Thu gọn sidebar";
        rail.sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        // Use data-tooltip only; remove native title to avoid duplicate tooltip
        rail.sidebarToggle.removeAttribute("title");
        rail.sidebarToggle.dataset["tooltip"] = sidebarLabel;
        rail.sidebarToggle.setAttribute("aria-label", sidebarLabel);
    };
    dom.applySidebarCollapsed = applySidebarCollapsed;
    const applyRightPanelCollapsed = (collapsed) => {
        setRightPanelCollapsed(inspector.root, activityPanel.toggle, collapsed);
        inspector.root.hidden = collapsed;
        shellFrame.classList.toggle("shell-frame--inspector-closed", collapsed);
        shellFrame.classList.toggle("shell-frame--inspector-open", !collapsed && shellFrame.dataset["layout"] === "work");
        topbar.inspectorToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        const inspectorLabel = collapsed ? "Mở inspector" : "Đóng inspector";
        // Use data-tooltip only; remove native title to avoid duplicate tooltip
        topbar.inspectorToggle.removeAttribute("title");
        topbar.inspectorToggle.dataset["tooltip"] = inspectorLabel;
        topbar.inspectorToggle.setAttribute("aria-label", inspectorLabel);
        topbar.inspectorToggle.replaceChildren(icon(collapsed ? "panel-right-open" : "panel-right-close", inspectorLabel));
        syncResponsiveDrawers();
    };
    dom.applyRightPanelCollapsed = applyRightPanelCollapsed;
    rail.sidebarToggle.addEventListener("click", () => {
        if (isSidebarDrawerViewport()) {
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
    window.addEventListener("resize", syncResponsiveDrawers);
    return dom;
}
function createSettingsSurface() {
    const root = el("section", "view view--settings settings-surface");
    root.hidden = true;
    root.dataset["view"] = "settings";
    root.setAttribute("aria-label", "Cài đặt");
    const header = el("div", "settings-surface__header");
    const titleBlock = el("div", "settings-surface__header-text");
    titleBlock.append(el("p", "settings-surface__eyebrow", "Cowork GHC"), el("h1", "settings-surface__title", "Cài đặt"));
    const actions = el("div", "settings-surface__actions");
    const backButton = el("button", "settings-surface__back", "Trở về");
    backButton.type = "button";
    const closeButton = el("button", "icon-btn settings-surface__close");
    closeButton.type = "button";
    closeButton.title = "Đóng cài đặt";
    closeButton.dataset["tooltip"] = "Đóng cài đặt";
    closeButton.setAttribute("aria-label", "Đóng cài đặt");
    closeButton.append(icon("panel-right-close", "Đóng cài đặt"));
    actions.append(backButton, closeButton);
    header.append(titleBlock, actions);
    const layout = el("div", "settings-surface__layout");
    const nav = el("nav", "settings-surface__nav");
    nav.setAttribute("aria-label", "Mục cài đặt");
    const providerTab = el("button", "settings-surface__tab settings-surface__tab--active", "Nhà cung cấp");
    providerTab.type = "button";
    providerTab.dataset["settingsTab"] = "provider";
    providerTab.setAttribute("aria-current", "page");
    const generalTab = el("button", "settings-surface__tab", "Chung");
    generalTab.type = "button";
    generalTab.dataset["settingsTab"] = "general";
    nav.append(providerTab, generalTab);
    const content = el("div", "settings-surface__content");
    const providerBody = el("section", "settings-surface__panel settings-surface__panel--provider");
    providerBody.setAttribute("aria-label", "Cài đặt nhà cung cấp");
    const generalBody = el("section", "settings-surface__panel settings-surface__panel--general");
    generalBody.hidden = true;
    generalBody.setAttribute("aria-label", "Cài đặt chung");
    content.append(providerBody, generalBody);
    layout.append(nav, content);
    root.append(header, layout);
    const showTab = (tab) => {
        const provider = tab === "provider";
        providerBody.hidden = !provider;
        generalBody.hidden = provider;
        providerTab.classList.toggle("settings-surface__tab--active", provider);
        generalTab.classList.toggle("settings-surface__tab--active", !provider);
        providerTab.setAttribute("aria-current", provider ? "page" : "false");
        generalTab.setAttribute("aria-current", provider ? "false" : "page");
    };
    providerTab.addEventListener("click", () => showTab("provider"));
    generalTab.addEventListener("click", () => showTab("general"));
    for (const tab of [providerTab, generalTab]) {
        tab.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End")
                return;
            event.preventDefault();
            const target = event.key === "Home"
                ? providerTab
                : event.key === "End"
                    ? generalTab
                    : tab === providerTab
                        ? generalTab
                        : providerTab;
            target.focus();
            target.click();
        });
    }
    return { root, providerBody, generalBody, providerTab, closeButton, backButton, showTab };
}
//# sourceMappingURL=create-app-frame.js.map