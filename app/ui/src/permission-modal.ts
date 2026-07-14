/**
 * Focused, fail-safe permission decision card.
 *
 * This component only renders a real pending request. It never fabricates a diff, never exposes a
 * runtime id, and never turns dismissal into approval. It supports a one-shot approval and an
 * explicit session-scoped approval; the latter is never selected implicitly.
 */

import type { PendingPermissionView } from "./service-client.js";
import type { PermissionActionKind, PermissionScope } from "@cowork-ghc/contracts";
import { createProductIcon } from "./product-icons.js";

export interface PermissionModalCallbacks {
  onAllow(scope: PermissionScope): void;
  onDeny(): void;
}

export interface PermissionModalHandle {
  readonly root: HTMLElement;
  readonly requestId: string;
  setQueueCount(waiting: number): void;
  close(): void;
}

export interface PermissionModalOptions {
  readonly queueCount?: number;
}

const ACTION_LABEL: Record<PermissionActionKind, string> = {
  file_create: "Tạo tệp",
  file_edit: "Sửa tệp",
  file_delete: "Xoá tệp",
  file_move: "Di chuyển tệp",
  command_exec: "Chạy lệnh",
  ms365_write: "Tải lên SharePoint",
};

const ACTION_LEAD: Record<PermissionActionKind, string> = {
  file_create: "Cowork muốn tạo một tệp trong workspace của bạn.",
  file_edit: "Cowork muốn thay đổi một tệp trong workspace của bạn.",
  file_delete: "Cowork muốn xoá một tệp khỏi workspace của bạn.",
  file_move: "Cowork muốn di chuyển một tệp trong workspace của bạn.",
  command_exec: "Cowork muốn chạy một lệnh trong workspace của bạn.",
  ms365_write: "Cowork muốn ghi dữ liệu lên Microsoft 365 (SharePoint).",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function openPermissionModal(
  container: HTMLElement,
  pending: PendingPermissionView,
  callbacks: PermissionModalCallbacks,
  options?: PermissionModalOptions,
): PermissionModalHandle {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const titleId = `permission-title-${pending.requestId}`;
  const descId = `permission-desc-${pending.requestId}`;

  const backdrop = el("div", "permission-backdrop");
  const dialog = el("section", "permission-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", descId);
  dialog.dataset["level"] = pending.approvalLevel;

  const header = el("header", "permission-header");
  const iconWrap = el("span", "permission-icon");
  iconWrap.append(createProductIcon("permission", "Yêu cầu quyền"));
  const heading = el("div", "permission-heading");
  const eyebrow = el("span", "permission-eyebrow", "Yêu cầu quyền");
  const title = el("h2", "permission-title", "Cho phép Cowork thực hiện hành động này?");
  title.id = titleId;
  heading.append(eyebrow, title);
  header.append(iconWrap, heading);

  const queue = el("p", "permission-queue");
  queue.setAttribute("role", "status");
  queue.setAttribute("aria-live", "polite");
  const setQueueCount = (waiting: number): void => {
    queue.textContent = waiting > 0 ? `Còn ${waiting} yêu cầu đang chờ` : "";
    queue.hidden = waiting <= 0;
  };
  setQueueCount(options?.queueCount ?? 0);

  const summary = el("div", "permission-summary-card");
  const summaryTop = el("div", "permission-summary-card__top");
  const actionKind = el("span", "permission-action-kind", ACTION_LABEL[pending.action.kind]);
  const impact = el(
    "span",
    "permission-approval",
    pending.approvalLevel === "elevated" ? "Tác động cao" : "Trong workspace",
  );
  impact.dataset["level"] = pending.approvalLevel;
  summaryTop.append(actionKind, impact);

  const description = el("p", "permission-description", pending.action.description || ACTION_LEAD[pending.action.kind]);
  description.id = descId;
  description.setAttribute("aria-label", "Mô tả thay đổi");
  summary.append(summaryTop, description);

  if (pending.action.targetPath !== undefined) {
    const targetRow = el("div", "permission-target-row");
    targetRow.append(createProductIcon("file", "Tệp"));
    const target = el("code", "permission-action-target", pending.action.targetPath);
    target.setAttribute("aria-label", "Đối tượng bị tác động");
    targetRow.append(target);
    summary.append(targetRow);
  }

  const diff = el("pre", "permission-diff");
  diff.id = "permission-diff";
  diff.setAttribute("aria-label", "Nội dung thay đổi (diff)");
  diff.hidden = true;

  const trust = el("p", "permission-trust");
  trust.append(
    createProductIcon("permission"),
    document.createTextNode(" Chọn một lần hoặc cho phép thao tác tương tự trong phiên hiện tại."),
  );

  const actions = el("footer", "permission-actions");
  const denyBtn = el("button", "permission-deny", "Từ chối") as HTMLButtonElement;
  denyBtn.type = "button";

  const allowGroup = el("div", "permission-allow-group");
  const allowBtn = el("button", "permission-allow permission-allow--primary") as HTMLButtonElement;
  allowBtn.type = "button";
  allowBtn.append(createProductIcon("permission"), document.createTextNode("Cho phép một lần"));
  const allowMenuBtn = el("button", "permission-allow-menu-button") as HTMLButtonElement;
  allowMenuBtn.type = "button";
  allowMenuBtn.setAttribute("aria-label", "Thêm lựa chọn cho phép");
  allowMenuBtn.setAttribute("aria-haspopup", "menu");
  allowMenuBtn.setAttribute("aria-expanded", "false");
  allowMenuBtn.append(createProductIcon("expand", "Mở lựa chọn"));

  const allowMenu = el("div", "permission-allow-menu");
  allowMenu.hidden = true;
  allowMenu.setAttribute("role", "menu");
  const allowAlwaysBtn = el("button", "permission-allow-menu__item") as HTMLButtonElement;
  allowAlwaysBtn.type = "button";
  allowAlwaysBtn.setAttribute("role", "menuitem");
  allowAlwaysBtn.append(
    el("span", "permission-allow-menu__title", "Cho phép trong phiên"),
    el("span", "permission-allow-menu__description", "Không hỏi lại với thao tác tương tự cho tới khi phiên kết thúc."),
  );
  allowMenu.append(allowAlwaysBtn);
  allowGroup.append(allowBtn, allowMenuBtn, allowMenu);
  actions.append(denyBtn, allowGroup);

  dialog.append(header, queue, summary, diff, trust, actions);
  backdrop.append(dialog);
  container.append(backdrop);

  let closed = false;
  let submitted = false;
  const setSubmitting = (): void => {
    submitted = true;
    denyBtn.disabled = true;
    allowBtn.disabled = true;
    allowMenuBtn.disabled = true;
    allowAlwaysBtn.disabled = true;
    allowMenu.hidden = true;
    allowMenuBtn.setAttribute("aria-expanded", "false");
    allowBtn.classList.add("is-pending");
    allowBtn.replaceChildren(el("span", "permission-spinner"), document.createTextNode("Đang gửi…"));
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
  };

  const allow = (scope: PermissionScope = "once"): void => {
    if (closed || submitted) return;
    setSubmitting();
    callbacks.onAllow(scope);
  };

  const setAllowMenuOpen = (open: boolean): void => {
    if (submitted) return;
    allowMenu.hidden = !open;
    allowMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) allowAlwaysBtn.focus();
  };
  const deny = (): void => {
    if (closed || submitted) return;
    setSubmitting();
    callbacks.onDeny();
  };

  function onKeydown(event: KeyboardEvent): void {
    if (closed) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!allowMenu.hidden) {
        setAllowMenuOpen(false);
        allowMenuBtn.focus();
      } else {
        deny();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => !node.hasAttribute("disabled"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  denyBtn.addEventListener("click", deny);
  allowBtn.addEventListener("click", () => allow("once"));
  allowMenuBtn.addEventListener("click", () => setAllowMenuOpen(allowMenu.hidden));
  allowAlwaysBtn.addEventListener("click", () => allow("always"));
  dialog.addEventListener("pointerdown", (event) => {
    if (!allowGroup.contains(event.target as Node)) setAllowMenuOpen(false);
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) deny();
  });
  document.addEventListener("keydown", onKeydown, true);
  denyBtn.focus();

  return { root: backdrop, requestId: pending.requestId, setQueueCount, close };
}
