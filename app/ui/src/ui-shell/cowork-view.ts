import { createConversationProviderControl, type ConversationProviderControl } from "./conversation-provider-control.js";
import { createPermissionModeControl, type PermissionModeControl } from "./permission-mode-control.js";
import { el, icon } from "./dom-utils.js";

export interface CoworkViewDom {
  readonly root: HTMLElement;
  readonly chatTitle: HTMLElement;
  readonly chatSub: HTMLElement;
  readonly transcript: HTMLElement;
  readonly continuationBanner: HTMLElement;
  readonly continuationButton: HTMLButtonElement;
  readonly transcriptInner: HTMLElement;
  readonly emptyState: HTMLElement;
  readonly emptyStateCta: HTMLButtonElement;
  readonly thinking: HTMLElement;
  readonly composer: HTMLElement;
  readonly composerInput: HTMLElement;
  readonly composerHint: HTMLElement;
  readonly composerPreflight: HTMLElement;
  readonly composerPreflightMessage: HTMLElement;
  readonly composerPreflightCta: HTMLButtonElement;
  readonly attachButton: HTMLButtonElement;
  readonly attachmentChips: HTMLElement;
  readonly sendButton: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
  readonly providerControl: ConversationProviderControl;
  readonly permissionModeControl: PermissionModeControl;
  readonly skillsButton: HTMLButtonElement;
}

export function createCoworkView(defaultTitle: string): CoworkViewDom {
  const root = el("section", "view view--cowork cowork-view");
  root.dataset["view"] = "cowork";

  const header = el("header", "conv-header chat-header");
  const info = el("div", "conv-header__text chat-header__info");
  const chatTitle = el("h1", "conv-header__title chat-header__title", defaultTitle);
  const chatSub = el("p", "conv-header__meta chat-header__sub", "Cowork GHC sử dụng workspace và provider đã cấu hình.");
  info.append(chatTitle, chatSub);
  header.append(info);

  const continuationBanner = el("div", "continuation-banner banner");
  continuationBanner.hidden = true;
  continuationBanner.append(el("span", "continuation-banner__text", "Lịch sử đã lưu. Bật tiếp nối khi bạn muốn gửi lượt mới."));
  const continuationButton = el("button", "icon-btn icon-btn--sm continuation-banner__button") as HTMLButtonElement;
  continuationButton.type = "button";
  continuationButton.dataset["tooltip"] = "Tiếp tục cuộc trò chuyện";
  continuationButton.setAttribute("aria-label", "Tiếp tục cuộc trò chuyện");
  continuationButton.append(icon("conversation", "Tiếp tục"));
  continuationBanner.append(continuationButton);

  const transcript = el("div", "transcript");
  const transcriptInner = el("div", "transcript__inner");
  const emptyState = el("div", "empty-state");
  const emptyStateCta = el("button", "text-cta empty-state__cta", "Mở Settings") as HTMLButtonElement;
  emptyStateCta.type = "button";
  emptyStateCta.hidden = true;
  emptyState.append(
    el("h2", "empty-state__title", "Bạn muốn Cowork GHC làm gì?"),
    el("p", "empty-state__copy", "Gửi yêu cầu đầu tiên để bắt đầu phiên làm việc với workspace hiện tại."),
    emptyStateCta,
  );
  const thinking = el("div", "thinking");
  thinking.hidden = true;
  thinking.append(el("span", "thinking__dots", "..."), el("span", "thinking__label", "Đang xử lý"));
  transcriptInner.append(emptyState, thinking);
  transcript.append(transcriptInner);

  const composer = el("footer", "composer");
  const composerBox = el("div", "composer__box");
  const composerInput = el("div", "composer__input");
  composerInput.contentEditable = "true";
  composerInput.setAttribute("role", "textbox");
  composerInput.setAttribute("aria-multiline", "true");
  composerInput.setAttribute("aria-label", "Nhập yêu cầu");
  composerInput.setAttribute("data-placeholder", "Nhập yêu cầu cho Cowork GHC...");
  const attachmentChips = el("div", "composer__attachments");
  attachmentChips.hidden = true;
  const composerPreflight = el("div", "composer-preflight");
  composerPreflight.hidden = true;
  composerPreflight.setAttribute("role", "status");
  const composerPreflightMessage = el("p", "composer-preflight__message");
  const composerPreflightCta = el("button", "text-cta composer-preflight__cta", "Mở cài đặt provider") as HTMLButtonElement;
  composerPreflightCta.type = "button";
  composerPreflight.append(composerPreflightMessage, composerPreflightCta);

  const composerBar = el("div", "composer__bar");
  const attachButton = el("button", "icon-btn icon-btn--sm attach-btn") as HTMLButtonElement;
  attachButton.type = "button";
  attachButton.dataset["tooltip"] = "Đính kèm tệp";
  attachButton.setAttribute("aria-label", "Đính kèm tệp");
  attachButton.append(icon("attachment", "Đính kèm"));

  const permissionModeControl = createPermissionModeControl();

  const skillsButton = el("button", "skills-btn composer-skills-btn") as HTMLButtonElement;
  skillsButton.type = "button";
  skillsButton.textContent = "Kỹ năng: 0";
  skillsButton.dataset["tooltip"] = "Quản lý kỹ năng cho lượt chat";
  skillsButton.setAttribute("aria-label", "Mở Kỹ năng");

  const providerControl = createConversationProviderControl();

  const cancelButton = el("button", "text-cta text-cta--ghost stop-btn", "Dừng") as HTMLButtonElement;
  cancelButton.type = "button";
  cancelButton.hidden = true;

  const sendButton = el("button", "icon-btn icon-btn--sm icon-btn--accent send-btn") as HTMLButtonElement;
  sendButton.type = "button";
  sendButton.dataset["tooltip"] = "Gửi";
  sendButton.setAttribute("aria-label", "Gửi");
  sendButton.append(icon("paper-plane", "Gửi"));

  composerBar.append(attachButton, permissionModeControl.root, skillsButton, providerControl.root, el("span", "composer__spacer"), cancelButton, sendButton);
  composerBox.append(composerInput, attachmentChips, composerPreflight, composerBar);
  const composerHint = el("div", "composer__hint", "Enter để gửi, Shift+Enter xuống dòng");
  composer.append(composerBox, composerHint);

  root.append(header, transcript, composer);

  return {
    root,
    chatTitle,
    chatSub,
    transcript,
    continuationBanner,
    continuationButton,
    transcriptInner,
    emptyState,
    emptyStateCta,
    thinking,
    composer,
    composerInput,
    composerHint,
    composerPreflight,
    composerPreflightMessage,
    composerPreflightCta,
    attachButton,
    attachmentChips,
    sendButton,
    cancelButton,
    providerControl,
    permissionModeControl,
    skillsButton,
  };
}
