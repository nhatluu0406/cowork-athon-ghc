import { el, icon } from "./dom-utils.js";
export function createContextualSidebar() {
    const root = el("aside", "contextual-sidebar sidebar");
    root.setAttribute("aria-label", "Sidebar ngữ cảnh");
    const tabs = el("div", "work-mode-tabs sidebar-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Chế độ làm việc");
    const workModeCoworkTab = el("button", "work-mode-tab work-mode-tab--active", "Cowork");
    workModeCoworkTab.type = "button";
    workModeCoworkTab.dataset["workMode"] = "cowork";
    workModeCoworkTab.setAttribute("role", "tab");
    workModeCoworkTab.setAttribute("aria-selected", "true");
    const workModeWorkspaceTab = el("button", "work-mode-tab", "Workspace");
    workModeWorkspaceTab.type = "button";
    workModeWorkspaceTab.dataset["workMode"] = "workspace";
    workModeWorkspaceTab.setAttribute("role", "tab");
    workModeWorkspaceTab.setAttribute("aria-selected", "false");
    tabs.append(workModeCoworkTab, workModeWorkspaceTab);
    const coworkPanel = el("div", "context-panel context-panel--cowork");
    const toolbar = el("div", "cowork-sidebar__toolbar");
    const newConversationButton = el("button", "icon-btn icon-btn--sm cowork-sidebar__new");
    newConversationButton.type = "button";
    newConversationButton.title = "Cuộc trò chuyện mới";
    newConversationButton.setAttribute("aria-label", "Cuộc trò chuyện mới");
    newConversationButton.append(icon("conversation", "Cuộc trò chuyện mới"));
    const searchWrap = el("div", "sidebar__search");
    searchWrap.append(icon("search"));
    const sessionSearch = el("input", "");
    sessionSearch.type = "search";
    sessionSearch.placeholder = "Tìm cuộc trò chuyện...";
    sessionSearch.setAttribute("aria-label", "Tìm cuộc trò chuyện");
    searchWrap.append(sessionSearch);
    toolbar.append(newConversationButton, searchWrap);
    const sessionList = el("div", "conv-list sidebar__history");
    coworkPanel.append(toolbar, sessionList);
    const workspacePanel = el("div", "context-panel context-panel--workspace");
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
//# sourceMappingURL=contextual-sidebar.js.map