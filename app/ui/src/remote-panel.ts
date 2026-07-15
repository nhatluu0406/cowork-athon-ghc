/**
 * The `/remote` control panel (agent-harness-plan.md Task 2.4) — a small desktop overlay the
 * composer command `/remote` opens. The pairing content itself (URLs, one-time code + QR,
 * paired devices) lives in remote-pairing-view.ts, which the Dispatch surface renders too;
 * this module owns only the overlay chrome.
 */

import { renderRemotePairing, type RemotePairingClient } from "./remote-pairing-view.js";
import { el } from "./ui-shell/dom-utils.js";

/** The minimal client surface the panel needs (a subset of the full ServiceClient). */
export type RemotePanelClient = RemotePairingClient;

const OVERLAY_ID = "remote-panel-overlay";

/** Open (or re-open) the `/remote` panel. Idempotent: a second call replaces the overlay. */
export function openRemotePanel(client: RemotePanelClient): void {
  closeRemotePanel();

  const overlay = el("div", "remote-overlay");
  overlay.id = OVERLAY_ID;
  const dialog = el("div", "remote-dialog");
  overlay.appendChild(dialog);

  const header = el("div", "remote-dialog__header");
  header.appendChild(el("h2", "remote-dialog__title", "Điều khiển từ điện thoại"));
  const closeBtn = el("button", "remote-dialog__close", "✕");
  closeBtn.setAttribute("aria-label", "Đóng");
  closeBtn.addEventListener("click", closeRemotePanel);
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const body = el("div", "remote-dialog__body");
  dialog.appendChild(body);
  body.textContent = "Đang tải trạng thái remote…";

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeRemotePanel();
  });
  document.body.appendChild(overlay);

  void renderRemotePairing(client, body, {
    // Revoking removes every device, so re-open to render the emptied list.
    onRevoked: () => openRemotePanel(client),
  });
}

export function closeRemotePanel(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
