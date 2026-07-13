export function shellLayoutModeForSurface(surfaceId) {
    if (surfaceId === "cowork")
        return "work";
    if (surfaceId === "knowledge")
        return "knowledge";
    return "integration";
}
export function shellHasSidebar(layout) {
    return layout === "work";
}
export function applyShellLayoutClasses(frame, layout, inspectorOpen) {
    frame.classList.toggle("shell-frame--no-sidebar", !shellHasSidebar(layout));
    frame.classList.toggle("shell-frame--inspector-open", inspectorOpen && shellHasSidebar(layout));
    frame.dataset["layout"] = layout;
}
export function applyWorkMode(root, sidebar, coworkView, workspaceView, coworkPanel, workspacePanel, mode) {
    root.dataset["workMode"] = mode;
    for (const btn of sidebar.querySelectorAll("[data-work-mode]")) {
        const active = btn.dataset["workMode"] === mode;
        btn.classList.toggle("work-mode-tab--active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    }
    coworkPanel.hidden = mode !== "cowork";
    workspacePanel.hidden = mode !== "workspace";
    coworkView.hidden = mode !== "cowork";
    workspaceView.hidden = mode !== "workspace";
}
//# sourceMappingURL=shell-layout.js.map