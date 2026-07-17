import type { MicrosoftIntegrationView } from "../../integration-slots.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";

const SUGGESTIONS = [
  "Task trễ trên Planner",
  "Mail chưa đọc hôm nay",
  "Tìm tệp trên SharePoint",
  "Đăng thông báo lên Teams",
] as const;

export interface MsAssistantConversationItem {
  readonly id: string;
  readonly title: string;
}

export interface MsAssistantHandlers {
  readonly onOpenConnect: () => void;
  readonly onSend: (text: string) => void;
  readonly onSelectConversation: (id: string) => void;
  readonly onNewConversation: () => void;
}

export interface MsAssistantComposerRefs {
  readonly send: HTMLButtonElement;
  readonly input: HTMLTextAreaElement;
  readonly chips: readonly HTMLButtonElement[];
}

export interface MsAssistantRenderResult {
  readonly transcript: HTMLElement;
  readonly composer: MsAssistantComposerRefs | null;
}

export function renderMsAssistant(
  container: HTMLElement,
  view: MicrosoftIntegrationView,
  handlers: MsAssistantHandlers,
  conversations: readonly MsAssistantConversationItem[],
  activeId: string | null = null,
): MsAssistantRenderResult {
  container.replaceChildren();
  const layout = el("div", "ms-assistant-layout");
  const column = el("div", "ms-assistant");
  const transcript = el("div", "ms-assistant__transcript");
  if (view.connectionState !== "connected") {
    const card = el("section", "ms-card ms-assistant__empty");
    const logo = el("div", "ms-assistant__logo");
    logo.append(createMicrosoftLogo(30));
    const cta = el("button", "ms-assistant__connect-cta", "Mở trang kết nối") as HTMLButtonElement;
    cta.type = "button";
    cta.addEventListener("click", handlers.onOpenConnect);
    card.append(
      logo,
      el("h2", "ms-card__title", "Chưa kết nối Microsoft 365"),
      el("p", "ms-card__copy", "Kết nối tài khoản để trợ lý thao tác trên Outlook, Teams, SharePoint và Planner thay bạn."),
      cta,
    );
    transcript.append(card);
    const composer = renderComposer(false, handlers.onSend);
    column.append(transcript, composer.root);
    layout.append(column); // no sidebar when disconnected
    container.append(layout);
    return { transcript, composer: { send: composer.send, input: composer.input, chips: composer.chips } };
  }
  const sidebar = renderMs365Sidebar(conversations, handlers, activeId);
  const composer = renderComposer(true, handlers.onSend);
  column.append(transcript, composer.root);
  layout.append(sidebar, column);
  container.append(layout);
  return { transcript, composer: { send: composer.send, input: composer.input, chips: composer.chips } };
}

function renderMs365Sidebar(
  conversations: readonly MsAssistantConversationItem[],
  handlers: MsAssistantHandlers,
  activeId: string | null,
): HTMLElement {
  const sidebar = el("aside", "ms-history");
  const newBtn = el("button", "ms-history__new", "Cuộc trò chuyện mới") as HTMLButtonElement;
  newBtn.type = "button";
  newBtn.addEventListener("click", () => handlers.onNewConversation());
  const list = el("ul", "ms-history__list");
  for (const conv of conversations) {
    const item = el("li", "ms-history__item");
    const btn = el("button", "ms-history__item-btn", conv.title || "Cuộc trò chuyện") as HTMLButtonElement;
    btn.type = "button";
    if (conv.id === activeId) btn.classList.add("ms-history__item-btn--active");
    btn.addEventListener("click", () => handlers.onSelectConversation(conv.id));
    item.append(btn);
    list.append(item);
  }
  sidebar.append(newBtn, list);
  return sidebar;
}

function renderComposer(
  enabled: boolean,
  onSend: (text: string) => void,
): { root: HTMLElement; send: HTMLButtonElement; input: HTMLTextAreaElement; chips: readonly HTMLButtonElement[] } {
  const composer = el("div", "ms-composer");
  const chipsWrap = el("div", "ms-composer__chips");
  const chips: HTMLButtonElement[] = [];
  for (const suggestion of SUGGESTIONS) {
    const chip = el("button", "ms-composer__chip", suggestion) as HTMLButtonElement;
    chip.type = "button";
    chip.disabled = !enabled;
    chip.addEventListener("click", () => {
      if (chip.disabled) return;
      onSend(suggestion);
    });
    chips.push(chip);
    chipsWrap.append(chip);
  }
  const inputRow = el("div", "ms-composer__row");
  const input = el("textarea", "ms-composer__input") as HTMLTextAreaElement;
  input.rows = 1;
  input.placeholder = "Hỏi trợ lý về Microsoft 365…";
  input.setAttribute("aria-label", "Soạn yêu cầu Microsoft 365");
  input.disabled = !enabled;
  const send = el("button", "ms-composer__send") as HTMLButtonElement;
  send.type = "button";
  send.setAttribute("aria-label", "Gửi yêu cầu");
  send.textContent = "➤";
  send.disabled = !enabled;
  const submit = (): void => {
    if (send.disabled) return;
    const text = input.value.trim();
    if (text.length === 0) return;
    input.value = "";
    onSend(text);
  };
  send.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  inputRow.append(input, send);
  const hint = el(
    "p",
    "ms-composer__hint",
    "Hành động ghi (gửi mail, đăng Teams…) luôn cần phê duyệt trước khi thực thi qua Microsoft Graph.",
  );
  composer.append(chipsWrap, inputRow, hint);
  return { root: composer, send, input, chips };
}
