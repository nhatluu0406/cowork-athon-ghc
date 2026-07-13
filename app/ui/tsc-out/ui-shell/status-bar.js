import { providerStatus } from "../provider-readiness.js";
import { el } from "./dom-utils.js";
export function createStatusBar() {
    const root = el("footer", "statusbar status-bar");
    const left = el("div", "status-bar__left");
    const workspace = el("span", "status-bar__segment status-bar__workspace", "Workspace");
    const service = el("span", "status-bar__segment status-bar__service", "Service");
    const runtime = el("span", "status-bar__segment status-bar__runtime", "Runtime");
    left.append(workspace, service, runtime);
    const provider = el("span", "status-bar__segment status-bar__provider", "Provider");
    root.append(left, provider);
    return { root, workspace, service, runtime, provider };
}
function runtimeStatusLabel(phase, hasPendingPermission) {
    if (hasPendingPermission)
        return "Runtime · Chờ quyền";
    switch (phase) {
        case "running":
        case "starting":
        case "cancelling":
            return "Runtime · Đang chạy";
        case "failed":
            return "Runtime · Lỗi";
        case "denied":
        case "cancelled":
        case "completed":
        case "completed_without_final_message":
            return "Runtime · Nhàn rỗi";
        case "idle":
        case "ready":
        default:
            return "Runtime · Nhàn rỗi";
    }
}
export function renderStatusBar(dom, input) {
    const ws = input.workspacePath === null
        ? "Workspace · Chưa chọn"
        : `Workspace · ${shortWorkspaceLabel(input.workspacePath)}`;
    dom.workspace.textContent = ws;
    dom.workspace.title = input.workspacePath ?? "";
    dom.service.textContent = input.serviceLabel.replace(/^Local service:\s*/i, "Service · ");
    dom.service.classList.toggle("is-ok", input.serviceOk);
    dom.runtime.textContent = runtimeStatusLabel(input.runtimePhase, input.hasPendingPermission);
    dom.runtime.classList.toggle("is-running", input.runtimePhase === "running" || input.runtimePhase === "starting");
    dom.runtime.classList.toggle("is-warn", input.hasPendingPermission);
    dom.runtime.classList.toggle("is-danger", input.runtimePhase === "failed");
    const provider = providerStatus(input.settings, input.connectionTestState);
    dom.provider.textContent = provider.label.replace(/^Provider:\s*/i, "");
    dom.provider.title = provider.detail;
    dom.provider.classList.toggle("is-ok", provider.ok);
}
function shortWorkspaceLabel(path) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2)
        return path;
    return `.../${parts.slice(-2).join("/")}`;
}
//# sourceMappingURL=status-bar.js.map