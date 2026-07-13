/**
 * Conversation-level provider display (Phase 1: read-only until multi-profile registry exists).
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
  root.setAttribute("aria-label", "Provider và model của cuộc trò chuyện");
  const dot = el("span", "status-dot status-dot--idle");
  dot.setAttribute("aria-hidden", "true");
  const label = el("span", "provider-select__label", "Provider");
  const caret = el("span", "provider-select__caret", "▾");
  caret.setAttribute("aria-hidden", "true");
  const failText = el("p", "provider-select__fail");
  failText.hidden = true;
  root.append(dot, label, caret);
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
  control.failText.hidden = !input.failed;
  control.failText.textContent = input.failed ? "Kết nối thất bại" : "";
  control.dot.className = `status-dot status-dot--${input.status}`;
}
