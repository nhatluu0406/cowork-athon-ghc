import { el } from "./dom-utils.js";

export interface ConfirmModalOptions {
  readonly title: string;
  readonly message: string;
  /** Primary (confirm) button label. */
  readonly confirmLabel: string;
  /** Secondary (cancel) button label. Defaults to "Hủy". */
  readonly cancelLabel?: string;
  /** When true the confirm button uses the danger accent. */
  readonly danger?: boolean;
}

/**
 * Shared commercial confirm modal — a DOM dialog that replaces native `window.confirm`.
 *
 * Native `confirm()` blocks the renderer and, on Electron/Chromium, leaves `contentEditable`
 * surfaces unfocusable after it returns (issue #27: the chat composer went dead after "Tạo cuộc
 * trò chuyện mới"). A plain DOM modal has no such side effect, so the caller's follow-up
 * `.focus()` works normally.
 *
 * Resolves `true` on confirm, `false` on cancel / Escape / backdrop click. Focus starts on the
 * primary button, Enter confirms, and focus is restored to the previously-focused element on close.
 * One instance at a time (callers await before opening another). Light/dark come from `--cghc-*`.
 */
export function confirmModal(options: ConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = el("div", "cghc-modal__overlay");
    const dialog = el("div", "cghc-modal");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "cghc-modal-title");
    dialog.setAttribute("aria-describedby", "cghc-modal-message");

    const title = el("h2", "cghc-modal__title", options.title);
    title.id = "cghc-modal-title";
    const message = el("p", "cghc-modal__message", options.message);
    message.id = "cghc-modal-message";

    const actions = el("div", "cghc-modal__actions");
    const cancelBtn = el("button", "cghc-modal__btn", options.cancelLabel ?? "Hủy") as HTMLButtonElement;
    cancelBtn.type = "button";
    const confirmBtn = el(
      "button",
      `cghc-modal__btn cghc-modal__btn--primary${options.danger === true ? " cghc-modal__btn--danger" : ""}`,
      options.confirmLabel,
    ) as HTMLButtonElement;
    confirmBtn.type = "button";
    // Cancel first (safe default on the left), primary on the right — commercial convention.
    actions.append(cancelBtn, confirmBtn);
    dialog.append(title, message, actions);
    overlay.append(dialog);
    document.body.append(overlay);

    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      opener?.focus();
      resolve(result);
    };
    function onKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }
    }

    confirmBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener("keydown", onKeydown, true);
    confirmBtn.focus();
  });
}
