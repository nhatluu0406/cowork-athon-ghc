import { el } from "../dom-utils.js";

export type CloseDirtyChoice = "save" | "discard" | "cancel";

/**
 * Bounded modal that guards closing a tab with unsaved edits. Returns the user's choice; it never
 * silently discards. Escape / backdrop / "Huỷ" resolve to `cancel`. Focus starts on the safe
 * default (Lưu) and is restored to the previously-focused element on close.
 *
 * A single instance runs at a time (the caller awaits before opening another). Tests inject a fake
 * via the editor's `confirmDirtyClose` callback and never reach this DOM.
 */
export function confirmDirtyClose(fileName: string): Promise<CloseDirtyChoice> {
  return new Promise((resolve) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = el("div", "code-confirm__overlay");
    const dialog = el("div", "code-confirm");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "code-confirm-title");

    const title = el("h2", "code-confirm__title", "Lưu thay đổi?");
    title.id = "code-confirm-title";
    const message = el(
      "p",
      "code-confirm__message",
      `"${fileName}" có thay đổi chưa lưu. Bạn muốn làm gì trước khi đóng?`,
    );
    const actions = el("div", "code-confirm__actions");
    const saveBtn = el("button", "code-confirm__btn code-confirm__btn--primary", "Lưu") as HTMLButtonElement;
    saveBtn.type = "button";
    const discardBtn = el("button", "code-confirm__btn code-confirm__btn--danger", "Không lưu") as HTMLButtonElement;
    discardBtn.type = "button";
    const cancelBtn = el("button", "code-confirm__btn", "Huỷ") as HTMLButtonElement;
    cancelBtn.type = "button";
    actions.append(saveBtn, discardBtn, cancelBtn);
    dialog.append(title, message, actions);
    overlay.append(dialog);
    document.body.append(overlay);

    let settled = false;
    const finish = (choice: CloseDirtyChoice): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      opener?.focus();
      resolve(choice);
    };
    function onKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        finish("cancel");
      }
    }

    saveBtn.addEventListener("click", () => finish("save"));
    discardBtn.addEventListener("click", () => finish("discard"));
    cancelBtn.addEventListener("click", () => finish("cancel"));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish("cancel");
    });
    document.addEventListener("keydown", onKeydown, true);
    saveBtn.focus();
  });
}
