import type { RuntimePhase } from "../../conversation-controller.js";
import type { ConversationMessage } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";
import { renderAssistantMarkdown } from "../../markdown-message.js";

export interface ClaudePanelDom {
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly transcript: HTMLElement;
  readonly streaming: HTMLElement;
  readonly input: HTMLTextAreaElement;
  readonly send: HTMLButtonElement;
}

export function createClaudePanel(handlers: { readonly onSend: (text: string) => void }): ClaudePanelDom {
  const root = el("aside", "cc-panel");
  root.setAttribute("aria-label", "Panel Agent");

  const tabBar = el("div", "cc-panel__tabbar");
  tabBar.append(el("span", "cc-panel__tab", "AGENT"));

  const subheader = el("div", "cc-panel__session");
  const chip = el("span", "cc-panel__spark");
  chip.append(icon("sparkle", "Agent"));
  const title = el("span", "cc-panel__title", "Chưa có phiên");
  subheader.append(chip, title);

  const transcript = el("div", "cc-panel__transcript");
  transcript.setAttribute("aria-live", "polite");
  const streaming = el("div", "cc-panel__streaming");
  streaming.hidden = true;

  const composer = el("div", "cc-composer");
  const row = el("div", "cc-composer__row");
  const input = el("textarea", "cc-composer__input") as HTMLTextAreaElement;
  input.rows = 2;
  input.placeholder = "Yêu cầu Agent về tệp đang mở…";
  input.setAttribute("aria-label", "Soạn yêu cầu cho Agent");
  const send = el("button", "cc-composer__send") as HTMLButtonElement;
  send.type = "button";
  send.setAttribute("aria-label", "Gửi yêu cầu");
  send.append(icon("paper-plane", "Gửi"));
  row.append(input, send);
  const reason = el("p", "cc-composer__reason");
  reason.hidden = true;
  composer.append(row, reason);

  const doSend = (): void => {
    const text = input.value.trim();
    if (text.length === 0 || input.disabled) return;
    input.value = "";
    handlers.onSend(text);
  };
  send.addEventListener("click", doSend);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    doSend();
  });

  root.append(tabBar, subheader, transcript, streaming, composer);
  return { root, title, transcript, streaming, input, send };
}

export function renderClaudePanel(
  dom: ClaudePanelDom,
  state: {
    readonly title: string | null;
    readonly messages: readonly ConversationMessage[];
    readonly phase: RuntimePhase;
    readonly disabled: boolean;
    readonly disabledReason: string | null;
  },
): void {
  dom.title.textContent = state.title ?? "Chưa có phiên";
  dom.transcript.replaceChildren();
  if (state.messages.length === 0) {
    dom.transcript.append(el("p", "cc-panel__empty", "Gửi yêu cầu để bắt đầu — panel này dùng chung phiên với surface Cowork."));
  }
  for (const message of state.messages) {
    const node = el("div", `cc-msg cc-msg--${message.role}`);
    const textBox = el("div", "cc-msg__text");
    if (message.role === "assistant") {
      // #33: render assistant answers as safe Markdown (tables/code/headings), same renderer the
      // Cowork + MS365 surfaces use. User text stays plain.
      renderAssistantMarkdown(textBox, message.text);
    } else {
      textBox.append(el("p", "cc-msg__plain", message.text));
    }
    node.append(textBox);
    dom.transcript.append(node);
  }
  const running = state.phase === "running" || state.phase === "starting" || state.phase === "cancelling";
  dom.root.classList.toggle("cc-panel--running", running);
  const locked = state.disabled || running;
  dom.input.disabled = locked;
  dom.send.disabled = locked;
  const reason = dom.root.querySelector<HTMLElement>(".cc-composer__reason");
  if (reason !== null) {
    reason.hidden = state.disabledReason === null;
    reason.textContent = state.disabledReason ?? "";
  }
  dom.transcript.scrollTop = dom.transcript.scrollHeight;
}

export function setClaudePanelStreaming(dom: ClaudePanelDom, text: string, active: boolean): void {
  dom.streaming.hidden = !active;
  dom.streaming.replaceChildren();
  if (!active) return;
  const dot = el("span", "cc-panel__pulse");
  dom.streaming.append(dot, el("span", "cc-panel__streaming-text", text.length > 0 ? text : "Đang xử lý…"));
  dom.streaming.scrollTop = dom.streaming.scrollHeight;
}
