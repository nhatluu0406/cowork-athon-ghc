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
export declare function createContextualSidebar(): ContextualSidebarDom;
//# sourceMappingURL=contextual-sidebar.d.ts.map