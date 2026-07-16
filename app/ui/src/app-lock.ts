/**
 * Minimal first-run / unlock gate (ADR 0007). No unrelated UI redesign.
 */

import type { ServiceClient } from "./service-client.js";

export type AppLockStatus =
  | { readonly state: "needs_setup" }
  | { readonly state: "locked"; readonly username: string }
  | { readonly state: "unlocked"; readonly username: string; readonly userId: string };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Show a blocking lock/setup overlay. Resolves when the vault is unlocked.
 * Returns false when auth routes are unavailable (tests / legacy no-db mode).
 */
export async function ensureAppUnlocked(
  host: HTMLElement,
  client: Pick<ServiceClient, "authStatus" | "authSetup" | "authUnlock">,
): Promise<boolean> {
  let status: AppLockStatus;
  try {
    status = await client.authStatus();
  } catch {
    return false;
  }
  if (status.state === "unlocked") return true;

  return new Promise((resolve) => {
    const overlay = el("div", "app-lock");
    const card = el("div", "app-lock__card");
    const title = el(
      "h1",
      "app-lock__title",
      status.state === "needs_setup" ? "Tạo tài khoản cục bộ" : "Mở khoá Cowork GHC",
    );
    const copy = el(
      "p",
      "app-lock__copy",
      status.state === "needs_setup"
        ? "Thiết lập tên người dùng và mật khẩu cục bộ để bảo vệ cài đặt và khoá API trên máy này."
        : `Nhập mật khẩu cho tài khoản ${status.username}.`,
    );
    const form = el("form", "app-lock__form");
    const userLabel = el("label", "app-lock__label", "Tên người dùng");
    const userInput = el("input", "app-lock__input") as HTMLInputElement;
    userInput.type = "text";
    userInput.autocomplete = "username";
    userInput.required = true;
    if (status.state === "locked") {
      userInput.value = status.username;
      userInput.readOnly = true;
    }
    userLabel.append(userInput);

    const passLabel = el("label", "app-lock__label", "Mật khẩu");
    const passInput = el("input", "app-lock__input") as HTMLInputElement;
    passInput.type = "password";
    passInput.autocomplete =
      status.state === "needs_setup" ? "new-password" : "current-password";
    passInput.required = true;
    passInput.minLength = 8;
    passLabel.append(passInput);

    const error = el("p", "app-lock__error");
    error.hidden = true;
    const submit = el(
      "button",
      "app-lock__submit",
      status.state === "needs_setup" ? "Tạo và mở khoá" : "Mở khoá",
    ) as HTMLButtonElement;
    submit.type = "submit";

    form.append(userLabel, passLabel, error, submit);
    card.append(title, copy, form);
    overlay.append(card);
    host.append(overlay);
    passInput.focus();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      const username = userInput.value;
      const password = passInput.value;
      const action =
        status.state === "needs_setup"
          ? client.authSetup(username, password)
          : client.authUnlock(username, password);
      void action
        .then(() => {
          overlay.remove();
          resolve(true);
        })
        .catch((err: unknown) => {
          error.textContent = err instanceof Error ? err.message : "Không mở khoá được.";
          error.hidden = false;
          submit.disabled = false;
          passInput.focus();
        });
    });
  });
}
