/**
 * Permission Allow/Deny modal (CGHC-017, P2 + F5) — a PURE render + callbacks surface.
 *
 * It holds NO transport and NO business logic: it is handed one authoritative
 * {@link PendingPermissionView} and two callbacks, and it only renders + reports the user's
 * intent. The controller ({@link ./permission-controller}) owns the HTTP client, so a Deny
 * here maps — through the client — to a REAL server-side block at the execution boundary
 * (frontend.md: "Deny must actually prevent the action"; enforcement is server-side, P3).
 *
 * Honesty / accessibility guarantees this component is responsible for:
 *  - P2: the action kind (in human terms) + description + targetPath are all rendered, so the
 *    user sees exactly what is being asked and its target.
 *  - F5 (SHOULD): before a mutation the human-readable `description` is shown, plus a LABELLED
 *    diff slot. The current pending projection carries description/targetPath, NOT full diff
 *    content, so the slot stays hidden — this component never FABRICATES a diff. Full diff
 *    content is a Tier-2/runtime enrichment (carry-forward): when the projection later carries
 *    diff text, populate `#permission-diff` from it.
 *  - Fail-safe: ESC and a backdrop click map to DENY, never to Allow. There is no code path
 *    from a dismissal to `onAllow`.
 *  - Focus is trapped inside the dialog while open and RESTORED to the previously-focused
 *    element on close. Focus lands on Deny first (so Enter/Space is fail-safe).
 *  - role="dialog" aria-modal="true" with a labelled title; every control is labelled; no
 *    secret is ever written into the DOM (the projection carries none).
 */

import type { PendingPermissionView } from "./service-client.js";
import type { PermissionActionKind, PermissionScope } from "@cowork-ghc/contracts";

/** Callbacks the modal reports intent through. A dismissal (ESC/backdrop) routes to `onDeny`. */
export interface PermissionModalCallbacks {
  /** User approved; `scope` is the chosen once/always (default `once`). */
  onAllow(scope: PermissionScope): void;
  /** User denied OR dismissed (ESC/backdrop). Fail-safe: this NEVER allows. */
  onDeny(): void;
}

/** Handle to the open modal; `close()` tears it down and restores focus. */
export interface PermissionModalHandle {
  readonly root: HTMLElement;
  /** For the currently-shown head request (controller de-dupes by requestId). */
  readonly requestId: string;
  /**
   * Update the "other requests waiting behind this one" count while the modal stays open
   * (controller keeps the same head modal across refreshes). `0` hides the indicator. The
   * controller feeds this from the REAL pending list — the modal never invents a number.
   */
  setQueueCount(waiting: number): void;
  close(): void;
}

/** Open-time options for {@link openPermissionModal}. */
export interface PermissionModalOptions {
  /** Number of OTHER pending requests waiting behind this head; `>0` shows a queue indicator. */
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

const APPROVAL_LABEL: Record<"standard" | "elevated", string> = {
  standard: "Mức tiêu chuẩn",
  elevated: "Mức nâng cao — cần xác nhận cẩn trọng",
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

/** Build the labelled scope radio group (once/always); default `once`. */
function buildScopeControl(): { readonly root: HTMLElement; value(): PermissionScope } {
  const group = el("fieldset", "permission-scope");
  const legend = el("legend", "permission-scope-legend", "Phạm vi cho phép");
  group.append(legend);

  const options: readonly { readonly scope: PermissionScope; readonly label: string }[] = [
    { scope: "once", label: "Chỉ lần này" },
    { scope: "always", label: "Luôn cho phép" },
  ];
  const inputs: HTMLInputElement[] = [];
  for (const opt of options) {
    const wrap = el("label", "permission-scope-option");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "permission-scope";
    input.value = opt.scope;
    input.className = "permission-scope-input";
    if (opt.scope === "once") input.checked = true;
    inputs.push(input);
    wrap.append(input, document.createTextNode(` ${opt.label}`));
    group.append(wrap);
  }
  return {
    root: group,
    value: () => (inputs.find((i) => i.checked)?.value as PermissionScope | undefined) ?? "once",
  };
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Open the permission modal for one pending request. Returns a handle to close it. */
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
  const dialog = el("div", "permission-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);
  // Announce the action description in dialog mode (screen readers read aria-describedby).
  dialog.setAttribute("aria-describedby", descId);

  const title = el("h2", "permission-title", "Yêu cầu quyền thực thi");
  title.id = titleId;

  // Truthful queue indicator: how many OTHER requests are waiting behind this one. Hidden at 0,
  // updated live by the controller as the real queue drains. Never a fabricated number.
  const queue = el("p", "permission-queue");
  queue.setAttribute("role", "status");
  queue.setAttribute("aria-live", "polite");
  const setQueueCount = (waiting: number): void => {
    if (waiting > 0) {
      queue.textContent = `Còn ${waiting} yêu cầu đang chờ`;
      queue.hidden = false;
    } else {
      queue.textContent = "";
      queue.hidden = true;
    }
  };
  setQueueCount(options?.queueCount ?? 0);

  // P2: action kind (human) + target path.
  const actionRow = el("p", "permission-action");
  actionRow.append(el("span", "permission-action-kind", ACTION_LABEL[pending.action.kind]));
  if (pending.action.targetPath !== undefined) {
    const target = el("span", "permission-action-target", pending.action.targetPath);
    target.setAttribute("aria-label", "Đối tượng bị tác động");
    actionRow.append(document.createTextNode(" · "), target);
  }

  // P2/F5: human-readable description of what will happen. `id` links it to the dialog's
  // aria-describedby so it is announced when the modal opens.
  const description = el("p", "permission-description", pending.action.description);
  description.id = descId;
  description.setAttribute("aria-label", "Mô tả thay đổi");

  // F5: labelled diff slot. Stays hidden — the projection carries no diff content today
  // (Tier-2 runtime enrichment). NEVER fabricate a diff from data we do not have.
  const diff = el("pre", "permission-diff");
  diff.id = "permission-diff";
  diff.setAttribute("aria-label", "Nội dung thay đổi (diff)");
  diff.hidden = true;

  // P4: approval level, with a distinct warning treatment for `elevated`.
  const approval = el("p", "permission-approval", APPROVAL_LABEL[pending.approvalLevel]);
  approval.dataset["level"] = pending.approvalLevel;
  approval.setAttribute("role", "note");

  const scope = buildScopeControl();

  const actions = el("div", "permission-actions");
  const denyBtn = el("button", "permission-deny", "Từ chối");
  denyBtn.type = "button";
  const allowBtn = el("button", "permission-allow", "Cho phép");
  allowBtn.type = "button";
  actions.append(denyBtn, allowBtn);

  dialog.append(title, queue, actionRow, description, diff, approval, scope.root, actions);
  backdrop.append(dialog);
  container.append(backdrop);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    // Restore focus to whatever the user was on before the modal opened.
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
  };

  const allow = (): void => {
    if (closed) return;
    callbacks.onAllow(scope.value());
  };
  const deny = (): void => {
    if (closed) return;
    callbacks.onDeny();
  };

  function onKeydown(event: KeyboardEvent): void {
    if (closed) return;
    if (event.key === "Escape") {
      event.preventDefault();
      deny(); // Fail-safe: ESC denies, never allows.
      return;
    }
    if (event.key !== "Tab") return;
    // Focus trap: keep Tab / Shift+Tab cycling within the dialog.
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => !n.hasAttribute("disabled"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  denyBtn.addEventListener("click", deny);
  allowBtn.addEventListener("click", allow);
  // A backdrop click (outside the dialog) is a dismissal → fail-safe Deny.
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) deny();
  });
  document.addEventListener("keydown", onKeydown, true);

  // Move focus INTO the dialog on open, onto Deny (so Enter/Space is fail-safe).
  denyBtn.focus();

  return { root: backdrop, requestId: pending.requestId, setQueueCount, close };
}
