/**
 * The `/remote` control panel (agent-harness-plan.md Task 2.4) — a small desktop overlay the
 * composer command `/remote` opens. It renders the gateway URL(s), issues a one-time pairing
 * code + scannable QR, lists paired devices, and can revoke everything (`/remote off`).
 *
 * It is a THIN client of `/v1/remote`: it holds no state of its own beyond what it just fetched,
 * renders no secret (the QR encodes only a one-time pairing URL), and enforces nothing — the
 * service owns the pairing registry and the gateway. When remote is disabled it says so honestly
 * instead of pretending a gateway exists.
 */

import type {
  RemoteStatus,
  RemotePairingCode,
} from "./service-client.js";

/** The minimal client surface the panel needs (a subset of the full ServiceClient). */
export interface RemotePanelClient {
  remoteStatus(): Promise<RemoteStatus>;
  remoteIssuePairingCode(): Promise<RemotePairingCode>;
  remoteRevokeAll(): Promise<void>;
}

const OVERLAY_ID = "remote-panel-overlay";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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

  void render(client, body);
}

export function closeRemotePanel(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

async function render(client: RemotePanelClient, body: HTMLElement): Promise<void> {
  let status: RemoteStatus;
  try {
    status = await client.remoteStatus();
  } catch {
    body.textContent = "";
    body.appendChild(
      el(
        "p",
        "remote-note",
        "Remote chưa bật. Khởi động lại với CGHC_REMOTE_ENABLED=1 (và CGHC_REMOTE_LAN=1 để dùng cùng Wi-Fi).",
      ),
    );
    return;
  }

  body.textContent = "";

  if (!status.enabled) {
    body.appendChild(
      el("p", "remote-note", "Gateway remote chưa chạy trong phiên này."),
    );
    return;
  }

  // Reachable URLs (LAN first — those are phone-typable).
  const urls = [...status.lanUrls, ...(status.url !== null ? [status.url] : [])];
  const urlSection = el("div", "remote-section");
  urlSection.appendChild(el("div", "remote-section__label", "Địa chỉ mở trên điện thoại"));
  for (const url of urls) {
    urlSection.appendChild(el("div", "remote-url", url));
  }
  if (urls.length === 0) {
    urlSection.appendChild(
      el("p", "remote-note", "Chỉ loopback — mở qua Tailscale/VPN của bạn."),
    );
  }
  body.appendChild(urlSection);

  // Pairing code + QR.
  const pairSection = el("div", "remote-section");
  pairSection.appendChild(el("div", "remote-section__label", "Ghép nối thiết bị"));
  const codeRow = el("div", "remote-code-row");
  const codeValue = el("div", "remote-code", "········");
  const issueBtn = el("button", "remote-btn", "Tạo mã ghép nối");
  const qrHolder = el("div", "remote-qr");
  const note = el("p", "remote-note", "");
  issueBtn.addEventListener("click", () => {
    issueBtn.disabled = true;
    note.textContent = "";
    void client
      .remoteIssuePairingCode()
      .then((issued: RemotePairingCode) => {
        codeValue.textContent = issued.code;
        qrHolder.textContent = "";
        if (issued.qrSvg !== null) {
          // The SVG comes from our own service (qrcode lib) and encodes only a pairing URL.
          qrHolder.innerHTML = issued.qrSvg;
        }
        note.textContent = "Mã dùng 1 lần, hết hạn sau 2 phút. Quét QR hoặc nhập mã trên điện thoại.";
      })
      .catch(() => {
        note.textContent = "Không tạo được mã — thử lại.";
      })
      .finally(() => {
        issueBtn.disabled = false;
      });
  });
  codeRow.appendChild(codeValue);
  codeRow.appendChild(issueBtn);
  pairSection.appendChild(codeRow);
  pairSection.appendChild(qrHolder);
  pairSection.appendChild(note);
  body.appendChild(pairSection);

  // Paired devices + revoke-all.
  const devSection = el("div", "remote-section");
  devSection.appendChild(el("div", "remote-section__label", "Thiết bị đã ghép nối"));
  if (status.devices.length === 0) {
    devSection.appendChild(el("p", "remote-note", "Chưa có thiết bị nào."));
  } else {
    for (const device of status.devices) {
      const row = el("div", "remote-device");
      row.appendChild(el("span", "remote-device__name", device.name));
      row.appendChild(el("span", "remote-device__meta", device.deviceId));
      devSection.appendChild(row);
    }
    const revokeBtn = el("button", "remote-btn remote-btn--danger", "Thu hồi tất cả (/remote off)");
    revokeBtn.addEventListener("click", () => {
      revokeBtn.disabled = true;
      void client
        .remoteRevokeAll()
        .then(() => openRemotePanel(client))
        .catch(() => {
          revokeBtn.disabled = false;
        });
    });
    devSection.appendChild(revokeBtn);
  }
  body.appendChild(devSection);
}
