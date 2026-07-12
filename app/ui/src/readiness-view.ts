/**
 * Progressive readiness view (CGHC-025) — a pure render of {@link ReadinessState}.
 *
 * Honest boot surface: it shows the REAL phase the controller reports and never fabricates a
 * "ready"/"completed" state (frontend.md). It holds NO business logic and NO transport — the
 * {@link ReadinessControllerHandle} owns polling/backoff and calls {@link ReadinessViewHandle.update}.
 * The only interactive surface is recovery: a keyboard-reachable Retry button (calls back into
 * the controller) and a native `<details>` "View diagnostics" affordance that reveals the last
 * scrubbed, non-secret error detail. The token / base URL are NEVER written into the DOM.
 *
 * Built via `textContent` only, so no untrusted string is parsed as HTML. Accessibility: the
 * phase line is a `role="status"` `aria-live` region; entering an error phase moves focus to the
 * Retry action so a keyboard/screen-reader user is taken straight to the recovery path.
 */

import type { ReadinessState } from "./readiness-controller.js";

export interface ReadinessViewHandle {
  /** The mounted root element (already appended to the container). */
  readonly root: HTMLElement;
  /** Render the given readiness state honestly. */
  update(state: ReadinessState): void;
  /** Remove the surface from the DOM. */
  destroy(): void;
}

const PHASE_LABEL: Record<ReadinessState["phase"], string> = {
  starting: "Đang khởi động… (chờ handshake từ shell)",
  connecting: "Đang kết nối tới local service…",
  ready: "Đã kết nối local service",
  not_connected: "Chưa kết nối được (thiếu cấu hình từ shell)",
  unreachable: "Không kết nối được local service",
};

/** Phases that offer recovery (Retry + diagnostics). Ready/starting/connecting do not. */
const RECOVERABLE = new Set<ReadinessState["phase"]>(["not_connected", "unreachable"]);

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

export function createReadinessView(
  container: HTMLElement,
  opts: { onRetry: () => void },
): ReadinessViewHandle {
  const root = el("section", "readiness");
  root.setAttribute("aria-label", "Trạng thái khởi động");

  const statusRow = el("div", "status-row");
  const dot = el("span", "readiness-dot");
  const statusText = el("span", "readiness-status");
  statusText.setAttribute("role", "status");
  statusText.setAttribute("aria-live", "polite");
  statusRow.append(dot, statusText);

  const detail = el("p", "status-detail readiness-detail");

  // Tier-2 slot: runtime (OpenCode child) liveness is CGHC-028. Shown only when `ready`; it is
  // clearly labelled "unknown" rather than fabricating a runtime-up state.
  const runtime = el("p", "status-detail readiness-runtime");
  runtime.hidden = true;

  const recovery = el("div", "readiness-recovery");
  recovery.hidden = true;
  const retry = el("button", "readiness-retry", "Thử lại");
  retry.type = "button";
  retry.addEventListener("click", () => opts.onRetry());
  const diagnostics = el("details", "readiness-diagnostics");
  const summary = document.createElement("summary");
  summary.textContent = "Xem chẩn đoán";
  const diagDetail = el("p", "readiness-diag-detail");
  diagnostics.append(summary, diagDetail);
  recovery.append(retry, diagnostics);

  root.append(statusRow, detail, runtime, recovery);
  container.append(root);

  let prevPhase: ReadinessState["phase"] | null = null;

  function update(state: ReadinessState): void {
    dot.dataset["phase"] = state.phase;
    statusText.textContent = PHASE_LABEL[state.phase];

    // Detail line — non-secret health fields when ready; otherwise the phase message (if any).
    if (state.phase === "ready") {
      detail.hidden = false;
      detail.textContent = `service=${state.health.service} · status=${state.health.status} · uptime=${state.health.uptimeMs}ms`;
      runtime.hidden = false;
      runtime.textContent = "Runtime: chưa xác định (giám sát tiến trình ở CGHC-028).";
    } else if (state.phase === "not_connected" || state.phase === "unreachable") {
      detail.hidden = false;
      detail.textContent = state.message;
      runtime.hidden = true;
    } else {
      detail.hidden = true;
      detail.textContent = "";
      runtime.hidden = true;
    }

    // Recovery affordance — only in an honest error phase; carries the scrubbed diagnostics.
    const recoverable = RECOVERABLE.has(state.phase);
    recovery.hidden = !recoverable;
    if (state.phase === "not_connected" || state.phase === "unreachable") {
      diagDetail.textContent = state.detail;
    }

    // Focus management: on ENTERING an error phase, move focus to Retry (recovery path first).
    if (recoverable && prevPhase !== state.phase) retry.focus();
    prevPhase = state.phase;
  }

  return {
    root,
    update,
    destroy: () => root.remove(),
  };
}
