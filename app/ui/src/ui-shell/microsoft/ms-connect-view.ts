import type { MicrosoftIntegrationView } from "../../integration-slots.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";

/** Scopes the connector will request once D2 lands — capability description, not data. */
export const MS365_REQUESTED_SCOPES: readonly { readonly scope: string; readonly note: string }[] = [
  { scope: "User.Read", note: "Đọc hồ sơ người dùng cơ bản" },
  { scope: "Mail.ReadWrite", note: "Đọc và soạn thư Outlook" },
  { scope: "Mail.Send", note: "Gửi thư (luôn qua thẻ phê duyệt)" },
  { scope: "Calendars.ReadWrite", note: "Xem và tạo sự kiện lịch" },
  { scope: "Files.Read.All", note: "Đọc tệp OneDrive/SharePoint" },
  { scope: "Sites.Read.All", note: "Đọc site SharePoint" },
  { scope: "Tasks.ReadWrite", note: "Đọc và cập nhật task Planner" },
  { scope: "ChannelMessage.Send", note: "Đăng tin nhắn Teams (cần phê duyệt)" },
  { scope: "offline_access", note: "Duy trì kết nối giữa các phiên" },
];

export function renderMsConnect(container: HTMLElement, view: MicrosoftIntegrationView): void {
  container.replaceChildren();
  const wrap = el("div", "ms-connect");
  if (view.connectionState !== "connected") {
    wrap.append(renderSignInCard());
  } else {
    wrap.append(renderConnectedSummary(view));
  }
  container.append(wrap);
}

function renderSignInCard(): HTMLElement {
  const card = el("section", "ms-card ms-connect__signin-card");
  const logoWrap = el("div", "ms-connect__logo");
  logoWrap.append(createMicrosoftLogo(34));
  const signIn = el("button", "ms-connect__signin", "Đăng nhập với Microsoft") as HTMLButtonElement;
  signIn.type = "button";
  signIn.disabled = true;
  const note = el(
    "p",
    "ms-connect__note",
    "Backend D2 (Microsoft Graph) chưa được tích hợp. Nút đăng nhập sẽ được kích hoạt khi backend được merge.",
  );
  const scopeTitle = el("h3", "ms-section-label", "Quyền sẽ xin khi kết nối");
  const scopeList = el("ul", "ms-scope-list");
  for (const item of MS365_REQUESTED_SCOPES) {
    const li = el("li", "ms-scope-list__item");
    li.append(el("code", "ms-scope-list__scope", item.scope), el("span", "ms-scope-list__note", item.note));
    scopeList.append(li);
  }
  const oauthNote = el(
    "p",
    "ms-connect__oauth-note",
    "Đăng nhập dùng OAuth loopback; token được lưu trong Windows Credential Manager, không nằm trong trạng thái UI.",
  );
  card.append(logoWrap, el("h2", "ms-card__title", "Kết nối Microsoft 365"), signIn, note, scopeTitle, scopeList, oauthNote);
  return card;
}

function renderConnectedSummary(view: MicrosoftIntegrationView): HTMLElement {
  const card = el("section", "ms-card ms-connect__summary");
  card.append(el("h2", "ms-card__title", "Microsoft 365"), el("span", "ms-pill ms-pill--ok", "Đã kết nối"));
  const services = el("div", "ms-service-grid");
  for (const service of view.services) {
    const item = el("div", "ms-service-card");
    item.append(
      el("div", "ms-service-card__name", service.label),
      el("div", "ms-service-card__state", service.connected ? "Đang bật" : "Chờ quyền"),
    );
    services.append(item);
  }
  const scopeList = el("div", "ms-granted-scopes");
  for (const scope of view.scopes) scopeList.append(el("code", "ms-scope-pill", scope));
  card.append(el("h3", "ms-section-label", "Dịch vụ khả dụng"), services, el("h3", "ms-section-label", "Quyền đã cấp"), scopeList);
  return card;
}
