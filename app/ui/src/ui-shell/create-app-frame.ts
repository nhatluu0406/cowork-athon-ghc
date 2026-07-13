/**
 * V3 application frame — layout DOM only (no business logic).
 */

import { PRODUCT_SURFACES, visibleProductSurfaces, type ProductSurfaceId } from "../surface-registry.js";
import { createActivityPanel, type ActivityPanelDom } from "../activity-panel.js";
import { createModalKeyHandler, closeModalWithFocus, openModalWithFocus } from "../modal-focus.js";
import { setRightPanelCollapsed } from "../activity-panel.js";
import {
  createConversationProviderControl,
  type ConversationProviderControl,
} from "./conversation-provider-control.js";
import { createKnowledgeView, type KnowledgeViewDom } from "./knowledge-view.js";
import { createStatusBar, type StatusBarDom } from "./status-bar.js";
import { createWorkspaceView, type WorkspaceViewDom } from "./workspace-view.js";
import { appendIconLabel, el, icon } from "./dom-utils.js";

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

export function createAppFrame(root: HTMLElement): AppFrameDom {
  root.className = "app-shell app";
  root.replaceChildren();

  const topbar = el("header", "topbar");
  const brand = el("div", "topbar__brand");
  appendIconLabel(brand, "cowork", "Cowork GHC");
  const infoButton = el("button", "icon-btn topbar__info no-drag") as HTMLButtonElement;
  infoButton.type = "button";
  infoButton.setAttribute("aria-label", "Thông tin sản phẩm");
  infoButton.append(icon("activity", "Thông tin"));
  const settingsButton = el("button", "icon-btn no-drag") as HTMLButtonElement;
  settingsButton.type = "button";
  settingsButton.setAttribute("aria-label", "Mở cài đặt");
  settingsButton.append(icon("settings"), el("span", "icon-label", "Cài đặt"));
  const layoutControls = el("div", "topbar__layout-controls no-drag");
  const rightPanelTopbarToggle = el("button", "topbar__layout-toggle right-panel-topbar-toggle") as HTMLButtonElement;
  rightPanelTopbarToggle.type = "button";
  rightPanelTopbarToggle.title = "Thu gọn bảng thông tin";
  rightPanelTopbarToggle.setAttribute("aria-label", "Thu gọn bảng thông tin");
  rightPanelTopbarToggle.setAttribute("aria-expanded", "true");
  appendIconLabel(rightPanelTopbarToggle, "panel", "Thông tin");
  layoutControls.append(rightPanelTopbarToggle);
  topbar.append(brand, el("div", "topbar__spacer"), infoButton, layoutControls, settingsButton);

  const serviceStatus = el("span", "topbar__status no-drag");
  serviceStatus.hidden = true;
  const providerStatus = el("button", "topbar__gateway topbar__provider-status no-drag");
  providerStatus.type = "button";
  providerStatus.hidden = true;

  const shellFrame = el("main", "workspace shell-frame");
  const productRail = el("aside", "product-rail");
  productRail.setAttribute("aria-label", "Product surfaces");
  const railBrand = el("div", "product-rail__brand");
  railBrand.append(icon("cowork", "Cowork GHC"));
  productRail.append(railBrand);
  const railNav = el("nav", "product-rail__nav");
  const surfaceButtons = new Map<ProductSurfaceId, HTMLButtonElement>();
  for (const surface of visibleProductSurfaces(PRODUCT_SURFACES)) {
    const item = el("button", `product-rail__item product-rail__item--${surface.availability}`) as HTMLButtonElement;
    item.type = "button";
    item.dataset["surfaceId"] = surface.id;
    item.title =
      surface.dependency !== undefined
        ? `${surface.label} - Chờ tích hợp ${surface.dependency}`
        : surface.label;
    item.setAttribute("aria-label", item.title);
    item.setAttribute("aria-current", surface.id === "cowork" ? "page" : "false");
    item.append(icon(surface.icon, surface.label));
    railNav.append(item);
    surfaceButtons.set(surface.id, item);
  }
  productRail.append(railNav);
  const sidebarRailToggle = el("button", "product-rail__sidebar-toggle") as HTMLButtonElement;
  sidebarRailToggle.type = "button";
  sidebarRailToggle.title = "Mở sidebar";
  sidebarRailToggle.setAttribute("aria-label", "Mở sidebar");
  sidebarRailToggle.setAttribute("aria-expanded", "false");
  sidebarRailToggle.append(icon("conversation", "Mở sidebar"));
  productRail.append(sidebarRailToggle);

  const sidebar = el("aside", "sidebar contextual-sidebar");
  sidebar.setAttribute("aria-label", "Sidebar ngữ cảnh");
  const workModeTabs = el("div", "work-mode-tabs");
  workModeTabs.setAttribute("role", "tablist");
  const workModeCoworkTab = el("button", "work-mode-tab work-mode-tab--active", "Cowork") as HTMLButtonElement;
  workModeCoworkTab.type = "button";
  workModeCoworkTab.dataset["workMode"] = "cowork";
  workModeCoworkTab.setAttribute("role", "tab");
  workModeCoworkTab.setAttribute("aria-selected", "true");
  const workModeWorkspaceTab = el("button", "work-mode-tab", "Workspace") as HTMLButtonElement;
  workModeWorkspaceTab.type = "button";
  workModeWorkspaceTab.dataset["workMode"] = "workspace";
  workModeWorkspaceTab.setAttribute("role", "tab");
  workModeWorkspaceTab.setAttribute("aria-selected", "false");
  workModeTabs.append(workModeCoworkTab, workModeWorkspaceTab);

  const sidebarToggle = el("button", "sidebar-collapse", "Thu gọn") as HTMLButtonElement;
  sidebarToggle.type = "button";
  sidebarToggle.setAttribute("aria-expanded", "true");
  sidebarToggle.setAttribute("aria-label", "Thu gọn sidebar");
  const sidebarHeader = el("div", "context-sidebar__header");
  sidebarHeader.append(workModeTabs, sidebarToggle);

  const coworkSidebarPanel = el("div", "sidebar__cowork-panel context-panel context-panel--cowork");
  const newConversationButton = el("button", "sidebar__new-btn icon-only-btn") as HTMLButtonElement;
  newConversationButton.type = "button";
  newConversationButton.title = "Cuộc trò chuyện mới";
  newConversationButton.setAttribute("aria-label", "Cuộc trò chuyện mới");
  newConversationButton.append(icon("conversation", "Cuộc trò chuyện mới"));
  const workspaceLabel = el("p", "workspace-context", "Chưa chọn workspace");
  const workspaceBox = el("section", "workspace-slot");
  const sessionSearch = el("input", "sidebar__search") as HTMLInputElement;
  sessionSearch.type = "search";
  sessionSearch.placeholder = "Tìm cuộc trò chuyện…";
  sessionSearch.setAttribute("aria-label", "Tìm cuộc trò chuyện");
  const sessionList = el("div", "sidebar__history");
  const coworkToolbar = el("div", "cowork-sidebar__toolbar");
  coworkToolbar.append(newConversationButton, sessionSearch);
  coworkSidebarPanel.append(
    coworkToolbar,
    workspaceLabel,
    workspaceBox,
    el("h2", "sidebar__heading", "Phiên"),
    sessionList,
  );

  const workspaceSidebarPanel = el("div", "context-panel context-panel--workspace");
  workspaceSidebarPanel.hidden = true;
  const workspaceNavigatorSlot = el("section", "workspace-nav workspace-nav--full");
  workspaceSidebarPanel.append(workspaceNavigatorSlot);

  sidebar.append(sidebarHeader, coworkSidebarPanel, workspaceSidebarPanel);

  const coworkView = el("section", "view view--cowork cowork-view chat-area");
  coworkView.dataset["view"] = "cowork";
  const header = el("div", "chat-header");
  const headerInfo = el("div", "chat-header__info");
  const chatTitle = el("div", "chat-header__title", DEFAULT_TITLE);
  const chatSub = el("div", "chat-header__sub", "Cowork GHC sử dụng workspace và provider đã cấu hình.");
  headerInfo.append(chatTitle, chatSub);
  const headerActions = el("div", "chat-header__actions");
  const activityMobileToggle = el("button", "label-btn activity-mobile-toggle") as HTMLButtonElement;
  activityMobileToggle.type = "button";
  activityMobileToggle.setAttribute("aria-label", "Mở bảng hoạt động");
  activityMobileToggle.setAttribute("aria-expanded", "false");
  appendIconLabel(activityMobileToggle, "panel", "Thông tin");
  headerActions.append(activityMobileToggle);
  const chatIcon = el("div", "chat-header__icon");
  chatIcon.append(icon("cowork", "Cowork"));
  header.append(chatIcon, headerInfo, headerActions);

  const continuationBanner = el("div", "continuation-banner");
  continuationBanner.hidden = true;
  continuationBanner.append(el("span", "continuation-banner__text", "Đây là lịch sử đã lưu — không phải phiên runtime đang chạy."));
  const continuationButton = el("button", "label-btn", "Tiếp tục cuộc trò chuyện này") as HTMLButtonElement;
  continuationButton.type = "button";
  continuationBanner.append(continuationButton);

  const transcript = el("div", "transcript");
  const transcriptInner = el("div", "transcript__inner");
  const emptyState = el("div", "empty-state");
  emptyState.append(el("h2", "empty-state__title", "Bắt đầu làm việc với Cowork GHC"));
  emptyState.append(
    el("p", "empty-state__copy", "Chọn workspace, cấu hình provider/model, rồi tạo cuộc trò chuyện mới hoặc gửi yêu cầu."),
  );
  const thinking = el("div", "thinking");
  thinking.hidden = true;
  thinking.append(el("span", "thinking__dots", "..."), el("span", "thinking__label", "Đang xử lý"));
  transcriptInner.append(emptyState, thinking);
  transcript.append(transcriptInner);

  const composer = el("div", "composer");
  const composerBox = el("div", "composer__box");
  const composerInput = el("div", "composer__input");
  composerInput.contentEditable = "true";
  composerInput.setAttribute("role", "textbox");
  composerInput.setAttribute("aria-multiline", "true");
  composerInput.setAttribute("aria-label", "Nhập yêu cầu");
  composerInput.setAttribute("data-placeholder", "Nhập yêu cầu cho Cowork GHC...");
  const composerBar = el("div", "composer__bar");
  const attachButton = el("button", "icon-btn attach-btn") as HTMLButtonElement;
  attachButton.type = "button";
  attachButton.title = "Đính kèm tệp văn bản trong workspace";
  attachButton.setAttribute("aria-label", "Đính kèm");
  attachButton.append(icon("attachment"));
  const skillsButton = el("button", "composer-skills-btn") as HTMLButtonElement;
  skillsButton.type = "button";
  skillsButton.textContent = "Skills: 0";
  skillsButton.setAttribute("aria-label", "Mở Skills");
  const providerControl = createConversationProviderControl();
  const cancelButton = el("button", "stop-btn", "Dừng") as HTMLButtonElement;
  cancelButton.type = "button";
  cancelButton.hidden = true;
  const sendButton = el("button", "send-btn", "Gửi") as HTMLButtonElement;
  sendButton.type = "button";
  const attachmentChips = el("div", "composer__attachments");
  attachmentChips.hidden = true;
  composerBar.append(
    attachButton,
    skillsButton,
    providerControl.root,
    el("div", "composer__spacer"),
    cancelButton,
    sendButton,
  );
  const composerPreflight = el("div", "composer-preflight");
  composerPreflight.hidden = true;
  composerPreflight.setAttribute("role", "status");
  const composerPreflightMessage = el("p", "composer-preflight__message");
  const composerPreflightCta = el("button", "label-btn composer-preflight__cta", "Mở cài đặt provider") as HTMLButtonElement;
  composerPreflightCta.type = "button";
  composerPreflight.append(composerPreflightMessage, composerPreflightCta);
  const composerHint = el("div", "composer__hint", "Enter để gửi, Shift+Enter xuống dòng");
  composerBox.append(composerInput, attachmentChips, composerPreflight, composerBar);
  composer.append(composerBox, composerHint);
  coworkView.append(header, transcript, composer);

  const workspaceView = createWorkspaceView();
  const knowledgeView = createKnowledgeView();
  const integrationSurface = el("section", "integration-surface view view--integration");
  integrationSurface.hidden = true;

  const rightPanel = el("aside", "right-panel inspector-shell");
  rightPanel.setAttribute("aria-label", "Inspector");
  const rpHeader = el("div", "rp-header");
  const rpTitle = el("span", "rp-header__title");
  appendIconLabel(rpTitle, "panel", "Inspector");
  rpHeader.append(rpTitle);
  const executionStatus = el("p", "execution-status");
  executionStatus.hidden = true;
  const planCard = el("section", "plan-card");
  planCard.append(el("div", "plan-card__hd", "Kế hoạch"));
  const planSteps = el("div", "plan-card__steps");
  planCard.append(planSteps);
  const outputSection = el("section", "file-section");
  outputSection.append(el("div", "file-section__label", "Tệp đầu ra"));
  const outputFiles = el("div", "output-files");
  outputSection.append(outputFiles);
  const inputSection = el("section", "file-section");
  inputSection.append(el("div", "file-section__label", "Tệp đã đọc"));
  const inputFiles = el("div", "input-files");
  inputSection.append(inputFiles);
  const permissionSummary = el("p", "permission-summary", "Quyền: chưa có yêu cầu.");
  rightPanel.append(rpHeader, executionStatus, planCard, outputSection, inputSection, permissionSummary);

  shellFrame.append(
    productRail,
    sidebar,
    coworkView,
    workspaceView.root,
    knowledgeView.root,
    integrationSurface,
    rightPanel,
  );

  const statusBar = createStatusBar();
  const serviceDetail = statusBar.service;

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
  settingsHeader.append(modalTitle);
  const closeSettings = el("button", "icon-btn", "Đóng") as HTMLButtonElement;
  closeSettings.type = "button";
  settingsHeader.append(closeSettings);
  const settingsBody = el("div", "modal__body");
  settingsPanel.append(settingsHeader, settingsBody);
  settingsModal.append(settingsPanel);

  const skillsPanel = el("section", "skills-panel skills-drawer");
  skillsPanel.hidden = true;

  let settingsOpener: HTMLElement | null = null;
  const modalKeyHandler = createModalKeyHandler({
    panel: settingsPanel,
    closeButton: closeSettings,
    onClose: () => {
      closeModalWithFocus(settingsModal, settingsOpener, modalKeyHandler);
      settingsOpener = null;
    },
  });

  root.append(topbar, shellFrame, statusBar.root, drawerScrim, settingsModal, skillsPanel);

  const domPartial: AppFrameDom = {
    root,
    shellFrame,
    drawerScrim,
    serviceStatus,
    providerStatus,
    serviceDetail,
    statusBar,
    workspaceLabel,
    modelLabel: providerStatus,
    sessionSearch,
    sessionList,
    chatTitle,
    chatSub,
    chat: coworkView,
    coworkView,
    workspaceView,
    knowledgeView,
    transcript,
    continuationBanner,
    continuationButton,
    transcriptInner,
    emptyState,
    thinking,
    composer,
    composerInput,
    composerHint,
    composerPreflight,
    composerPreflightMessage,
    composerPreflightCta,
    attachButton,
    attachmentChips,
    sendButton,
    cancelButton,
    newConversationButton,
    providerControl,
    skillsButton,
    settingsModal,
    settingsPanel,
    settingsBody,
    settingsButton,
    closeSettingsButton: closeSettings,
    settingsOpener: null,
    modalKeyHandler,
    activityPanel: createActivityPanel(rightPanel),
    executionStatus,
    permissionSummary,
    sidebar,
    rightPanel,
    activityMobileToggle,
    sidebarToggle,
    workModeCoworkTab,
    workModeWorkspaceTab,
    coworkSidebarPanel,
    workspaceSidebarPanel,
    skillsPanel,
    productRail,
    surfaceButtons,
    integrationSurface,
    workspaceNavigatorSlot,
    workspaceBox,
    rightPanelTopbarToggle,
    sidebarRailToggle,
    openSettings: () => undefined,
    applySidebarCollapsed: () => undefined,
    applyRightPanelCollapsed: () => undefined,
  };

  const openSettings = (): void => {
    settingsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : settingsButton;
    const initial =
      settingsBody.querySelector<HTMLElement>(".llm-provider-select") ??
      settingsBody.querySelector<HTMLElement>(".llm-settings-title") ??
      closeSettings;
    openModalWithFocus(settingsModal, initial, modalKeyHandler);
  };
  domPartial.openSettings = openSettings;

  settingsButton.addEventListener("click", openSettings);
  providerControl.root.addEventListener("click", openSettings);
  composerPreflightCta.addEventListener("click", openSettings);
  closeSettings.addEventListener("click", () => {
    closeModalWithFocus(settingsModal, settingsOpener, modalKeyHandler);
    settingsOpener = null;
  });

  activityMobileToggle.addEventListener("click", () => {
    const open = shellFrame.classList.toggle("inspector-drawer-open");
    drawerScrim.hidden = !open;
    activityMobileToggle.setAttribute("aria-expanded", open ? "true" : "false");
    appendIconLabel(activityMobileToggle, "panel", open ? "Ẩn thông tin" : "Thông tin");
  });

  drawerScrim.addEventListener("click", () => {
    shellFrame.classList.remove("inspector-drawer-open", "sidebar-drawer-open");
    drawerScrim.hidden = true;
    activityMobileToggle.setAttribute("aria-expanded", "false");
  });

  const applySidebarCollapsed = (collapsed: boolean): void => {
    shellFrame.classList.toggle("sidebar-collapsed", collapsed);
    sidebar.setAttribute("aria-hidden", collapsed ? "true" : "false");
    sidebarToggle.textContent = collapsed ? "Mở" : "Thu gọn";
    sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    sidebarToggle.setAttribute("aria-label", collapsed ? "Mở sidebar" : "Thu gọn sidebar");
    sidebarRailToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const railLabel = collapsed ? "Mở sidebar" : "Thu gọn sidebar";
    sidebarRailToggle.title = railLabel;
    sidebarRailToggle.setAttribute("aria-label", railLabel);
  };
  domPartial.applySidebarCollapsed = applySidebarCollapsed;

  const applyRightPanelCollapsed = (collapsed: boolean): void => {
    setRightPanelCollapsed(rightPanel, domPartial.activityPanel.toggle, collapsed);
    rightPanelTopbarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const label = collapsed ? "Mở bảng thông tin" : "Thu gọn bảng thông tin";
    rightPanelTopbarToggle.title = label;
    rightPanelTopbarToggle.setAttribute("aria-label", label);
    appendIconLabel(rightPanelTopbarToggle, "panel", collapsed ? "Mở thông tin" : "Thông tin");
    rightPanel.hidden = collapsed;
  };
  domPartial.applyRightPanelCollapsed = applyRightPanelCollapsed;

  sidebarToggle.addEventListener("click", () => {
    applySidebarCollapsed(!shellFrame.classList.contains("sidebar-collapsed"));
  });
  sidebarRailToggle.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      const open = shellFrame.classList.toggle("sidebar-drawer-open");
      drawerScrim.hidden = !open && !shellFrame.classList.contains("inspector-drawer-open");
      return;
    }
    applySidebarCollapsed(!shellFrame.classList.contains("sidebar-collapsed"));
  });
  rightPanelTopbarToggle.addEventListener("click", () => {
    applyRightPanelCollapsed(!rightPanel.hidden);
  });
  domPartial.activityPanel.toggle.addEventListener("click", () => {
    applyRightPanelCollapsed(!rightPanel.hidden);
  });

  return domPartial;
}
