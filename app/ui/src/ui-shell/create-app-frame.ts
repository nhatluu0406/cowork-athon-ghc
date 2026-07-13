/**
 * V3 application frame composition.
 *
 * This module wires layout components together and exposes DOM handles for app-shell state.
 * Business behavior stays in app-shell.ts and service/controller modules.
 */

import { createActivityPanel, setRightPanelCollapsed, type ActivityPanelDom } from "../activity-panel.js";
import type { ProductSurfaceId } from "../surface-registry.js";
import { createContextualSidebar } from "./contextual-sidebar.js";
import type { ConversationProviderControl } from "./conversation-provider-control.js";
import { createCoworkView } from "./cowork-view.js";
import { el, icon } from "./dom-utils.js";
import { createInspectorShell } from "./inspector.js";
import { createIntegrationView } from "./integration-view.js";
import { createKnowledgeView, type KnowledgeViewDom } from "./knowledge-view.js";
import { createProductRail } from "./product-rail.js";
import { createStatusBar, type StatusBarDom } from "./status-bar.js";
import { createTopbar } from "./topbar.js";
import { installShellTooltips } from "./tooltip.js";
import { createWorkspaceView, type WorkspaceViewDom } from "./workspace-view.js";

const DEFAULT_TITLE = "Cuộc trò chuyện mới";

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
  readonly emptyStateCta: HTMLButtonElement;
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
  readonly settingsSurface: HTMLElement;
  readonly settingsProviderBody: HTMLElement;
  readonly settingsGeneralBody: HTMLElement;
  readonly settingsButton: HTMLButtonElement;
  readonly closeSettingsButton: HTMLButtonElement;
  settingsOpener: HTMLElement | null;
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
  closeSettings: () => void;
  applySidebarCollapsed: (collapsed: boolean) => void;
  applyRightPanelCollapsed: (collapsed: boolean) => void;
}

export function createAppFrame(root: HTMLElement): AppFrameDom {
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
  shellFrame.append(
    rail.root,
    sidebar.root,
    cowork.root,
    workspaceView.root,
    knowledgeView.root,
    integrationSurface,
    settingsSurface.root,
    inspector.root,
  );

  const drawerScrim = el("div", "drawer-scrim");
  drawerScrim.hidden = true;

  const skillsPanel = el("section", "skills-panel skills-drawer");
  skillsPanel.hidden = true;

  root.append(topbar.root, shellFrame, statusBar.root, drawerScrim, skillsPanel);
  installShellTooltips(root);

  let settingsOpener: HTMLElement | null = null;
  const activityPanel = createActivityPanel(inspector.root);

  const dom: AppFrameDom = {
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
    applySidebarCollapsed: () => undefined,
    applyRightPanelCollapsed: () => undefined,
  };

  const closeSettings = (): void => {
    settingsSurface.root.hidden = true;
    shellFrame.classList.remove("shell-frame--settings");
    settingsOpener?.focus();
    settingsOpener = null;
  };

  const openSettings = (): void => {
    settingsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : topbar.settingsButton;
    settingsSurface.root.hidden = false;
    shellFrame.classList.add("shell-frame--settings");
    settingsSurface.showTab("provider");
    const initial = settingsSurface.providerBody.querySelector<HTMLElement>(".llm-provider-select") ?? settingsSurface.providerTab;
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
    if (event.key === "Escape") closeSettings();
  });

  const setDrawerOpen = (kind: "sidebar" | "inspector" | null): void => {
    shellFrame.classList.toggle("sidebar-drawer-open", kind === "sidebar");
    shellFrame.classList.toggle("inspector-drawer-open", kind === "inspector");
    drawerScrim.hidden = kind === null;
  };

  const applySidebarCollapsed = (collapsed: boolean): void => {
    shellFrame.classList.toggle("sidebar-collapsed", collapsed);
    sidebar.root.hidden = collapsed;
    rail.sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    rail.sidebarToggle.title = collapsed ? "Mở sidebar" : "Thu gọn sidebar";
    rail.sidebarToggle.dataset["tooltip"] = rail.sidebarToggle.title;
    rail.sidebarToggle.setAttribute("aria-label", rail.sidebarToggle.title);
  };
  dom.applySidebarCollapsed = applySidebarCollapsed;

  const applyRightPanelCollapsed = (collapsed: boolean): void => {
    setRightPanelCollapsed(inspector.root, activityPanel.toggle, collapsed);
    inspector.root.hidden = collapsed;
    topbar.inspectorToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const inspectorLabel = collapsed ? "Mở inspector" : "Đóng inspector";
    topbar.inspectorToggle.title = inspectorLabel;
    topbar.inspectorToggle.dataset["tooltip"] = inspectorLabel;
    topbar.inspectorToggle.setAttribute("aria-label", inspectorLabel);
    topbar.inspectorToggle.replaceChildren(
      icon(collapsed ? "panel-right-open" : "panel-right-close", inspectorLabel),
    );
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

  const workModeTabs = [sidebar.workModeCoworkTab, sidebar.workModeWorkspaceTab] as const;
  for (const tab of workModeTabs) {
    tab.addEventListener("keydown", (event) => {
      const current = workModeTabs.indexOf(tab);
      const nextIndex =
        event.key === "ArrowRight"
          ? (current + 1) % workModeTabs.length
          : event.key === "ArrowLeft"
            ? (current + workModeTabs.length - 1) % workModeTabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? workModeTabs.length - 1
                : -1;
      if (nextIndex < 0) return;
      const nextTab = workModeTabs[nextIndex];
      if (nextTab === undefined) return;
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

function createSettingsSurface(): {
  readonly root: HTMLElement;
  readonly providerBody: HTMLElement;
  readonly generalBody: HTMLElement;
  readonly providerTab: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement;
  readonly backButton: HTMLButtonElement;
  readonly showTab: (tab: "provider" | "general") => void;
} {
  const root = el("section", "view view--settings settings-surface");
  root.hidden = true;
  root.dataset["view"] = "settings";
  root.setAttribute("aria-label", "Cài đặt");

  const header = el("div", "settings-surface__header");
  const titleBlock = el("div", "settings-surface__header-text");
  titleBlock.append(
    el("p", "settings-surface__eyebrow", "Cowork GHC"),
    el("h1", "settings-surface__title", "Cài đặt"),
  );
  const actions = el("div", "settings-surface__actions");
  const backButton = el("button", "settings-surface__back", "Trở về") as HTMLButtonElement;
  backButton.type = "button";
  const closeButton = el("button", "icon-btn settings-surface__close") as HTMLButtonElement;
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
  const providerTab = el("button", "settings-surface__tab settings-surface__tab--active", "Nhà cung cấp") as HTMLButtonElement;
  providerTab.type = "button";
  providerTab.dataset["settingsTab"] = "provider";
  providerTab.setAttribute("aria-current", "page");
  const generalTab = el("button", "settings-surface__tab", "Chung") as HTMLButtonElement;
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

  const showTab = (tab: "provider" | "general"): void => {
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
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const target =
        event.key === "Home"
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
