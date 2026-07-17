/**
 * Conversation-level model/provider switcher.
 *
 * Clicking it opens a menu of the provider profiles configured in "Nhà cung cấp" and switches
 * the active one (the model used for new conversations). When none are configured it falls back
 * to opening Settings so the user can add one. The menu itself is owned by app-shell (which has
 * the client + settings state); this module only builds/renders the button.
 */

import { el } from "./dom-utils.js";

export interface ConversationProviderControl {
  readonly root: HTMLButtonElement;
  readonly dot: HTMLElement;
  readonly label: HTMLElement;
  readonly failText: HTMLElement;
}

export function createConversationProviderControl(): ConversationProviderControl {
  const root = el("button", "provider-select conversation-provider-control") as HTMLButtonElement;
  root.type = "button";
  root.dataset["tooltip"] = "Đổi model / nhà cung cấp";
  root.setAttribute("aria-haspopup", "menu");
  root.setAttribute("aria-label", "Đổi model / nhà cung cấp");
  const dot = el("span", "status-dot status-dot--idle");
  dot.setAttribute("aria-hidden", "true");
  const label = el("span", "provider-select__label", "Provider");
  const failText = el("p", "provider-select__fail");
  failText.hidden = true;
  root.append(dot, label);
  return { root, dot, label, failText };
}

export function renderConversationProviderControl(
  control: ConversationProviderControl,
  input: {
    readonly visible: boolean;
    readonly interactive: boolean;
    readonly label: string;
    readonly status: "ok" | "warn" | "danger" | "idle";
    readonly failed: boolean;
  },
): void {
  control.root.hidden = !input.visible;
  control.root.disabled = !input.interactive;
  control.label.textContent = input.label;
  control.root.dataset["tooltip"] = `${input.label} — bấm để đổi model`;
  control.root.setAttribute("aria-label", `Đổi model / nhà cung cấp: ${input.label}`);
  control.failText.hidden = !input.failed;
  control.failText.textContent = input.failed ? "Kết nối thất bại" : "";
  control.dot.className = `status-dot status-dot--${input.status}`;
}
