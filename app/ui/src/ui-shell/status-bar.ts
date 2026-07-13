import type { RuntimePhase } from "../conversation-controller.js";
import type { SettingsView } from "../service-client.js";
import type { ConnectionTestState } from "../provider-readiness.js";
import { providerStatus } from "../provider-readiness.js";
import { el, icon } from "./dom-utils.js";

export interface StatusBarDom {
  readonly root: HTMLElement;
  readonly workspace: HTMLElement;
  readonly workspaceLabel: HTMLElement;
  readonly service: HTMLElement;
  readonly serviceLabel: HTMLElement;
  readonly runtime: HTMLElement;
  readonly runtimeLabel: HTMLElement;
  readonly provider: HTMLButtonElement;
  readonly providerLabel: HTMLElement;
}

function segment(
  className: string,
  iconName: Parameters<typeof icon>[0],
  label: string,
  button = false,
): { root: HTMLElement; label: HTMLElement } {
  const root = el(button ? "button" : "span", `status-bar__segment ${className}`);
  if (root instanceof HTMLButtonElement) root.type = "button";
  const text = el("span", "status-bar__label", label);
  root.append(icon(iconName), text);
  return { root, label: text };
}

export function createStatusBar(): StatusBarDom {
  const root = el("footer", "statusbar status-bar");
  const left = el("div", "status-bar__left");
  const right = el("div", "status-bar__right");

  const workspacePart = segment("status-bar__workspace", "folder-open", "Workspace");
  const servicePart = segment("status-bar__service", "activity", "Service");
  const runtimePart = segment("status-bar__runtime", "gateway", "Runtime");
  const providerPart = segment("status-bar__provider", "sliders", "Provider", true);
  const provider = providerPart.root as HTMLButtonElement;
  provider.setAttribute("aria-label", "Mở cài đặt nhà cung cấp");

  left.append(workspacePart.root);
  right.append(servicePart.root, runtimePart.root, provider);
  root.append(left, right);

  return {
    root,
    workspace: workspacePart.root,
    workspaceLabel: workspacePart.label,
    service: servicePart.root,
    serviceLabel: servicePart.label,
    runtime: runtimePart.root,
    runtimeLabel: runtimePart.label,
    provider,
    providerLabel: providerPart.label,
  };
}

function runtimeStatusLabel(phase: RuntimePhase, hasPendingPermission: boolean): string {
  if (hasPendingPermission) return "Chờ quyền";
  switch (phase) {
    case "running":
    case "starting":
    case "cancelling":
      return "Đang chạy";
    case "failed":
      return "Lỗi";
    case "denied":
    case "cancelled":
    case "completed":
    case "completed_without_final_message":
    case "idle":
    case "ready":
    default:
      return "Nhàn rỗi";
  }
}

export function renderStatusBar(
  dom: StatusBarDom,
  input: {
    readonly workspacePath: string | null;
    readonly serviceLabel: string;
    readonly serviceOk: boolean;
    readonly runtimePhase: RuntimePhase;
    readonly hasPendingPermission: boolean;
    readonly settings: SettingsView | null;
    readonly connectionTestState: ConnectionTestState;
  },
): void {
  dom.workspaceLabel.textContent =
    input.workspacePath === null ? "Chưa chọn workspace" : shortWorkspaceLabel(input.workspacePath);
  dom.workspace.dataset["tooltip"] = input.workspacePath ?? "Chưa chọn workspace";

  dom.serviceLabel.textContent = input.serviceLabel.replace(/^Local service:\s*/i, "").replace(/^Service\s*·\s*/i, "");
  dom.service.classList.toggle("is-ok", input.serviceOk);
  dom.service.classList.toggle("is-danger", !input.serviceOk);

  dom.runtimeLabel.textContent = runtimeStatusLabel(input.runtimePhase, input.hasPendingPermission);
  dom.runtime.classList.toggle("is-running", input.runtimePhase === "running" || input.runtimePhase === "starting");
  dom.runtime.classList.toggle("is-warn", input.hasPendingPermission);
  dom.runtime.classList.toggle("is-danger", input.runtimePhase === "failed");

  const provider = providerStatus(input.settings, input.connectionTestState);
  dom.providerLabel.textContent = provider.label;
  dom.provider.dataset["tooltip"] = provider.detail;
  dom.provider.setAttribute("aria-label", `Mở cài đặt nhà cung cấp: ${provider.label}`);
  dom.provider.classList.toggle("is-ok", provider.ok);
  dom.provider.classList.toggle("is-warn", !provider.ok && input.connectionTestState !== "failed");
  dom.provider.classList.toggle("is-danger", input.connectionTestState === "failed");
}

function shortWorkspaceLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return path;
  return parts.at(-1) ?? path;
}
