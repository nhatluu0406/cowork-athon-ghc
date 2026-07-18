import { el } from "../dom-utils.js";
import { getShellBridge } from "../../bridge.js";

/** Renders the "device_pending" card: user code + open/copy-link + waiting note. */
export function renderDevicePendingCard(userCode: string, verificationUri: string): HTMLElement {
  const card = el("section", "ms-card ms-connect__device-code");
  card.append(el("h2", "ms-card__title", "Hoàn tất đăng nhập trên trình duyệt"));
  card.append(
    el(
      "p",
      "ms-connect__device-instructions",
      `Mở ${verificationUri} và nhập mã bên dưới để hoàn tất đăng nhập.`,
    ),
  );
  const codeEl = el("code", "ms-connect__device-code-value", userCode);
  card.append(codeEl);

  const actions = el("div", "ms-connect__device-actions");
  // Open directly via the shell's allowlisted openExternal (Microsoft sign-in host); on failure
  // fall back to copying the link (PHASE 3).
  const openLink = el("button", "ms-connect__open-link", "Mở liên kết") as HTMLButtonElement;
  openLink.type = "button";
  openLink.addEventListener("click", () => {
    void getShellBridge()
      .openExternal(verificationUri)
      .then((result) => {
        if (!result.ok) void copyToClipboard(verificationUri);
      })
      .catch(() => void copyToClipboard(verificationUri));
  });
  const copyLink = el("button", "ms-connect__copy-link", "Sao chép liên kết") as HTMLButtonElement;
  copyLink.type = "button";
  copyLink.addEventListener("click", () => {
    void copyToClipboard(verificationUri);
  });
  actions.append(openLink, copyLink);
  card.append(actions);

  card.append(el("p", "ms-connect__device-waiting", "Đang chờ xác nhận…"));
  return card;
}

/**
 * Copies text to the clipboard. There is no `shell.openExternal` bridge exposed to the
 * renderer, so this never attempts to open the verification URL directly — it only copies
 * the link for the user to paste into a browser themselves.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to legacy fallback below
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  } catch {
    // Best-effort only; clipboard access can be denied by the OS/browser sandbox.
  }
}
