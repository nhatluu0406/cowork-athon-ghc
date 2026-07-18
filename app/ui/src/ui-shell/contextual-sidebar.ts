import { el, icon } from "./dom-utils.js";

export interface ContextualSidebarDom {
  readonly root: HTMLElement;
  readonly sessionSearch: HTMLInputElement;
  readonly sessionList: HTMLElement;
  readonly newConversationButton: HTMLButtonElement;
  readonly workModeCoworkTab: HTMLButtonElement;
  readonly workModeWorkspaceTab: HTMLButtonElement;
  readonly coworkPanel: HTMLElement;
  readonly workspacePanel: HTMLElement;
  readonly workspaceLabel: HTMLElement;
  readonly workspaceBox: HTMLElement;
  readonly workspaceNavigatorSlot: HTMLElement;
}

export function createContextualSidebar(): ContextualSidebarDom {
  const root = el("aside", "contextual-sidebar sidebar");
  root.setAttribute("aria-label", "Sidebar ngữ cảnh");

  const tabs = el("div", "work-mode-tabs sidebar-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Chế độ làm việc");
  const workModeCoworkTab = el("button", "work-mode-tab work-mode-tab--active", "Cowork") as HTMLButtonElement;
  workModeCoworkTab.type = "button";
  workModeCoworkTab.dataset["workMode"] = "cowork";
  workModeCoworkTab.setAttribute("role", "tab");
  workModeCoworkTab.setAttribute("aria-selected", "true");
  workModeCoworkTab.setAttribute("aria-controls", "cowork-sidebar-panel");

  const workModeWorkspaceTab = el("button", "work-mode-tab", "Workspace") as HTMLButtonElement;
  workModeWorkspaceTab.type = "button";
  workModeWorkspaceTab.dataset["workMode"] = "workspace";
  workModeWorkspaceTab.setAttribute("role", "tab");
  workModeWorkspaceTab.setAttribute("aria-selected", "false");
  workModeWorkspaceTab.setAttribute("aria-controls", "workspace-sidebar-panel");
  tabs.append(workModeCoworkTab, workModeWorkspaceTab);

  const coworkPanel = el("div", "context-panel context-panel--cowork");
  coworkPanel.id = "cowork-sidebar-panel";
  coworkPanel.setAttribute("role", "tabpanel");
  const toolbar = el("div", "cowork-sidebar__toolbar");
  const newConversationButton = el("button", "icon-btn icon-btn--sm cowork-sidebar__new") as HTMLButtonElement;
  newConversationButton.type = "button";
  newConversationButton.dataset["tooltip"] = "Cuộc trò chuyện mới";
  newConversationButton.setAttribute("aria-label", "Cuộc trò chuyện mới");
  newConversationButton.append(icon("square-pen", "Cuộc trò chuyện mới"));

  const searchWrap = el("div", "sidebar__search");
  searchWrap.append(icon("search"));
  const sessionSearch = el("input", "") as HTMLInputElement;
  sessionSearch.type = "search";
  sessionSearch.placeholder = "Tìm kiếm";
  sessionSearch.setAttribute("aria-label", "Tìm kiếm");
  searchWrap.append(sessionSearch);
  toolbar.append(newConversationButton, searchWrap);
  const sessionList = el("div", "conv-list sidebar__history");
  coworkPanel.append(toolbar, sessionList);

  const workspacePanel = el("div", "context-panel context-panel--workspace");
  workspacePanel.id = "workspace-sidebar-panel";
  workspacePanel.setAttribute("role", "tabpanel");
  workspacePanel.hidden = true;
  const workspaceBox = el("section", "workspace-identity-slot");
  const workspaceLabel = el("p", "workspace-context", "Chưa chọn workspace");
  workspaceLabel.hidden = true;
  const workspaceNavigatorSlot = el("section", "workspace-nav workspace-nav--full");
  workspacePanel.append(workspaceBox, workspaceLabel, workspaceNavigatorSlot);

  root.append(tabs, coworkPanel, workspacePanel);

  return {
    root,
    sessionSearch,
    sessionList,
    newConversationButton,
    workModeCoworkTab,
    workModeWorkspaceTab,
    coworkPanel,
    workspacePanel,
    workspaceLabel,
    workspaceBox,
    workspaceNavigatorSlot,
  };
}
