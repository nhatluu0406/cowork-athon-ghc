import type { Ms365ViewData } from "../../service-client.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";
import type { MsChatController, MsChatMessage } from "./ms-chat-controller.js";

const SUGGESTIONS = [
  "Task trễ trên Planner",
  "Mail chưa đọc hôm nay",
  "Tìm tệp trên SharePoint",
  "Đăng thông báo lên Teams",
] as const;

export interface MsAssistantHandlers {
  readonly onOpenConnect: () => void;
  /** Render đọc chat.state() — nguồn sự thật duy nhất cho transcript (không state trong DOM). */
  readonly chat: MsChatController;
  readonly onSend: (prompt: string) => void;
  readonly onCancel: () => void;
  /** Root của pill write-mode (Task 3 truyền vào); Task 2 chỉ mount vào composer row. */
  readonly writeModePill?: HTMLElement;
}

export function renderMsAssistant(
  container: HTMLElement,
  view: Ms365ViewData,
  handlers: MsAssistantHandlers,
): void {
  container.replaceChildren();
  const connected = view.connectionState === "connected";
  const state = handlers.chat.state();
  const column = el("div", "ms-assistant");
  const transcript = el("div", "ms-assistant__transcript");

  if (!connected) {
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
    transcript.classList.add("ms-assistant__transcript--empty");
    transcript.append(card);
  } else if (state.messages.length === 0) {
    transcript.classList.add("ms-assistant__transcript--empty");
    transcript.append(
      el("p", "ms-assistant__placeholder", "Bắt đầu bằng cách hỏi trợ lý hoặc chọn một gợi ý bên dưới."),
    );
  } else {
    transcript.classList.add("ms-assistant__transcript--list");
    for (const message of state.messages) {
      transcript.append(renderBubble(message));
    }
  }

  if (state.errorMessage) {
    transcript.append(el("p", "ms-assistant__error-banner", state.errorMessage));
  }

  column.append(transcript, renderComposer(connected, state.phase, handlers));
  container.append(column);
}

function renderBubble(message: MsChatMessage): HTMLElement {
  const classes = ["ms-bubble", `ms-bubble--${message.role}`];
  if (message.pending) classes.push("ms-bubble--pending");
  if (message.error) classes.push("ms-bubble--error");
  const bubble = el("div", classes.join(" "));
  const text = message.error ? message.error : message.content;
  bubble.textContent = text;
  if (message.pending) {
    bubble.append(el("span", "ms-bubble__pending-marker", " (đang xử lý…)"));
  }
  return bubble;
}

function renderComposer(
  enabled: boolean,
  phase: "idle" | "running" | "error",
  handlers: MsAssistantHandlers,
): HTMLElement {
  const composer = el("div", "ms-composer");
  const chips = el("div", "ms-composer__chips");
  const running = phase === "running";
  for (const suggestion of SUGGESTIONS) {
    const chip = el("button", "ms-composer__chip", suggestion) as HTMLButtonElement;
    chip.type = "button";
    chip.disabled = !enabled || running;
    chip.addEventListener("click", () => handlers.onSend(suggestion));
    chips.append(chip);
  }

  const inputRow = el("div", "ms-composer__row");
  const input = el("textarea", "ms-composer__input") as HTMLTextAreaElement;
  input.rows = 1;
  input.placeholder = "Hỏi trợ lý về Microsoft 365…";
  input.setAttribute("aria-label", "Soạn yêu cầu Microsoft 365");
  input.disabled = !enabled || running;

  const submit = (): void => {
    const value = input.value.trim();
    if (value.length === 0) return;
    handlers.onSend(value);
    input.value = "";
  };

  input.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  const send = el("button", "ms-composer__send") as HTMLButtonElement;
  send.type = "button";
  send.setAttribute("aria-label", "Gửi yêu cầu");
  send.textContent = "➤";
  send.disabled = !enabled;
  send.hidden = running;
  send.addEventListener("click", submit);

  const cancel = el("button", "ms-composer__cancel", "Hủy") as HTMLButtonElement;
  cancel.type = "button";
  cancel.setAttribute("aria-label", "Hủy yêu cầu đang xử lý");
  cancel.hidden = !running;
  cancel.addEventListener("click", handlers.onCancel);

  inputRow.append(input, send, cancel);
  if (handlers.writeModePill) inputRow.append(handlers.writeModePill);

  const hint = el(
    "p",
    "ms-composer__hint",
    "Hành động ghi (gửi mail, đăng Teams…) luôn cần phê duyệt trước khi thực thi qua Microsoft Graph.",
  );
  composer.append(chips, inputRow, hint);
  return composer;
}
