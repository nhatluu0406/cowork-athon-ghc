import type { MicrosoftIntegrationView } from "../../integration-slots.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";

const SUGGESTIONS = [
  "Task trễ trên Planner",
  "Mail chưa đọc hôm nay",
  "Tìm tệp trên SharePoint",
  "Đăng thông báo lên Teams",
] as const;

export function renderMsAssistant(
  container: HTMLElement,
  view: MicrosoftIntegrationView,
  handlers: { readonly onOpenConnect: () => void },
): void {
  container.replaceChildren();
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
  }
  column.append(transcript, renderComposer(view.connectionState === "connected"));
  container.append(column);
}

function renderComposer(enabled: boolean): HTMLElement {
  const composer = el("div", "ms-composer");
  const chips = el("div", "ms-composer__chips");
  for (const suggestion of SUGGESTIONS) {
    const chip = el("button", "ms-composer__chip", suggestion) as HTMLButtonElement;
    chip.type = "button";
    chip.disabled = !enabled;
    chips.append(chip);
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
  inputRow.append(input, send);
  const hint = el(
    "p",
    "ms-composer__hint",
    "Hành động ghi (gửi mail, đăng Teams…) luôn cần phê duyệt trước khi thực thi qua Microsoft Graph.",
  );
  composer.append(chips, inputRow, hint);
  return composer;
}
