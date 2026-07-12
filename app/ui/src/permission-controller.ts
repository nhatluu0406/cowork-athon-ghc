/**
 * Permission controller (CGHC-017) — owns transport + lifecycle for the Allow/Deny modal.
 *
 * The modal ({@link ./permission-modal}) is a pure render + callbacks; THIS module is the only
 * place that talks to the loopback service (via the typed {@link ServiceClient}). It keeps
 * business logic OUT of the view (frontend.md) and renders execution visibility honestly:
 *  - It reflects ONLY real pending requests. When the list is empty (the normal pre-Tier-2
 *    state, no live session), it shows NOTHING — never fabricated activity.
 *  - It surfaces the HEAD pending request as a modal, de-duped by `requestId` so a refresh that
 *    returns the same head does not tear down and re-open the open modal.
 *  - On Allow/Deny it POSTs the decision, then refreshes. A Deny maps to a REAL server-side
 *    block (P3, enforced at the execution boundary — not here).
 *  - An `unknown` / `already_resolved` outcome closes the modal with a TRUTHFUL note, never a
 *    fabricated success.
 */

import type { EvEvent, PermissionDecision, PermissionScope } from "@cowork-ghc/contracts";
import { sanitizeErrorMessage } from "@cowork-ghc/service/execution";
import { openPermissionModal, type PermissionModalHandle } from "./permission-modal.js";
import type {
  PendingPermissionView,
  PermissionDecisionResponse,
  ServiceClient,
} from "./service-client.js";

/**
 * Injectable timer seam so tests can drive the polling lifecycle deterministically (no real
 * waits). Defaults to the host `setInterval`/`clearInterval`. The handle is opaque (`unknown`)
 * so a fake can return any token.
 */
export interface PermissionControllerTimer {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/**
 * Injectable visibility seam (CGHC-017 Info) so tests drive the tab-hidden lifecycle without a
 * real `visibilitychange` event. Defaults to the `document` visibility API. While the tab is
 * hidden the controller PAUSES polling (no wasted loopback calls); on return to visible it
 * resumes the bounded interval and refreshes once.
 */
export interface PermissionControllerVisibility {
  isHidden(): boolean;
  addVisibilityListener(handler: () => void): void;
  removeVisibilityListener(handler: () => void): void;
}

export interface PermissionControllerDeps {
  readonly client: Pick<ServiceClient, "listPendingPermissions" | "decidePermission">;
  /** Where the modal + status note mount (usually the app root). */
  readonly container: HTMLElement;
  /** Poll cadence for `start()`; defaults to 2s. Tests drive `refresh()` directly instead. */
  readonly pollIntervalMs?: number;
  /** Timer seam; defaults to host `setInterval`/`clearInterval`. Tests inject a fake. */
  readonly timer?: PermissionControllerTimer;
  /** Visibility seam; defaults to the `document` visibility API. Tests inject a fake. */
  readonly visibility?: PermissionControllerVisibility;
  /** Fired when a pending permission is shown (read-only history seed). */
  readonly onPending?: (request: PendingPermissionView) => void;
  /** Fired after a decision POST returns (resolved / already_resolved). */
  readonly onDecision?: (input: {
    readonly request: PendingPermissionView;
    readonly outcome: PermissionDecisionResponse;
    readonly requestedDecision: PermissionDecision;
  }) => void;
}

export interface PermissionControllerHandle {
  /** Fetch pending requests once and reconcile the modal against them. */
  refresh(): Promise<void>;
  /** Begin periodic polling. */
  start(): void;
  /** Stop polling and close any open modal. */
  stop(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createPermissionController(
  deps: PermissionControllerDeps,
): PermissionControllerHandle {
  const intervalMs = deps.pollIntervalMs ?? 2000;
  const setIntervalFn = deps.timer?.setInterval.bind(deps.timer) ?? ((h: () => void, ms: number) => setInterval(h, ms));
  const clearIntervalFn =
    deps.timer?.clearInterval.bind(deps.timer) ??
    ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const visibility: PermissionControllerVisibility = deps.visibility ?? {
    isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    addVisibilityListener: (h) => document.addEventListener("visibilitychange", h),
    removeVisibilityListener: (h) => document.removeEventListener("visibilitychange", h),
  };

  // A polite, honest status line for post-decision notes (already_resolved / unknown / errors).
  // It carries only non-secret, user-facing text.
  const note = el("p", "permission-note");
  note.setAttribute("role", "status");
  note.setAttribute("aria-live", "polite");
  note.hidden = true;
  deps.container.append(note);

  let modal: PermissionModalHandle | null = null;
  let timerHandle: unknown = null;
  let polling = false;
  // Guards against interleaving: a decision in flight must not be clobbered by a poll.
  let deciding = false;
  let lastPending: PendingPermissionView | null = null;
  // The last failed-decision error, kept so a re-opened modal for the SAME request still shows
  // WHY it failed (recovery). Cleared when the user attempts a fresh decision for that request.
  let lastError: { readonly requestId: string; readonly message: string } | null = null;

  const setNote = (text: string): void => {
    note.textContent = text;
    note.hidden = false;
  };
  const clearNote = (): void => {
    note.textContent = "";
    note.hidden = true;
  };

  const closeModal = (): void => {
    modal?.close();
    modal = null;
  };

  const applyOutcome = (
    outcome: PermissionDecisionResponse,
    requestedDecision: PermissionDecision,
  ): void => {
    // Honest reflection of the gate's outcome — never a fabricated success.
    if (outcome.status === "already_resolved") {
      setNote("Yêu cầu này đã được xử lý trước đó.");
    } else if (outcome.status === "unknown") {
      setNote("Yêu cầu không còn tồn tại (đã hết hạn hoặc bị thu hồi).");
    } else if (outcome.decision !== requestedDecision) {
      // Resolved, but the gate recorded a DIFFERENT decision than the user chose — say so plainly
      // instead of silently pretending the user's choice was applied.
      setNote("Cổng quyền đã ghi nhận quyết định khác với lựa chọn của bạn.");
    } else {
      clearNote();
    }
  };

  const decide = async (requestId: string, allow: boolean, scope?: PermissionScope): Promise<void> => {
    if (deciding) return;
    deciding = true;
    lastError = null; // a fresh attempt supersedes any prior error for this request
    closeModal();
    const requestedDecision: PermissionDecision = allow ? "allow" : "deny";
    try {
      const outcome = await deps.client.decidePermission(
        allow
          ? { requestId, decision: "allow", scope: scope ?? "once" }
          : { requestId, decision: "deny" },
      );
      applyOutcome(outcome, requestedDecision);
      if (lastPending !== null) {
        deps.onDecision?.({ request: lastPending, outcome, requestedDecision });
      }
    } catch (error) {
      // Never leak a raw stack/secret; show a scrubbed, recovery-oriented note AND remember it so
      // the follow-up refresh (which re-opens the still-pending modal) does not erase it.
      const message = error instanceof Error ? sanitizeErrorMessage(error.message) : "Không gửi được quyết định.";
      lastError = { requestId, message };
      setNote(message);
    } finally {
      deciding = false;
      await refresh();
    }
  };

  const showHead = (head: PendingPermissionView, waiting: number): void => {
    if (modal !== null && modal.requestId === head.requestId) {
      modal.setQueueCount(waiting); // same head: keep it open, just refresh the live queue count
      return;
    }
    closeModal();
    // Preserve a failed-decision error for the SAME request across the re-open (recovery);
    // otherwise start the re-opened modal with a clean note.
    if (lastError !== null && lastError.requestId === head.requestId) {
      setNote(lastError.message);
    } else {
      clearNote();
    }
    modal = openPermissionModal(
      deps.container,
      head,
      {
        onAllow: (scope) => void decide(head.requestId, true, scope),
        onDeny: () => void decide(head.requestId, false),
      },
      { queueCount: waiting },
    );
    lastPending = head;
    deps.onPending?.(head);
  };

  async function refresh(): Promise<void> {
    if (deciding) return; // a decision + its follow-up refresh is already reconciling
    let pending: readonly PendingPermissionView[];
    try {
      pending = await deps.client.listPendingPermissions();
    } catch {
      // A transient poll failure must not fabricate or drop state; keep the current modal.
      return;
    }
    const head = pending[0];
    if (head === undefined) {
      closeModal(); // nothing pending → show nothing (honest idle)
      return;
    }
    showHead(head, pending.length - 1);
  }

  // The bounded poll interval — only running while polling AND the tab is visible.
  const startInterval = (): void => {
    if (timerHandle !== null) return; // already ticking
    timerHandle = setIntervalFn(() => void refresh(), intervalMs);
  };
  const stopInterval = (): void => {
    if (timerHandle !== null) {
      clearIntervalFn(timerHandle);
      timerHandle = null;
    }
  };

  // Pause polling while the tab is hidden (no wasted loopback calls); resume + refresh once on
  // return to visible. Registered for the whole start()→stop() window.
  const onVisibility = (): void => {
    if (!polling) return;
    if (visibility.isHidden()) {
      stopInterval();
    } else {
      void refresh();
      startInterval();
    }
  };

  return {
    refresh,
    start: () => {
      if (polling) return; // idempotent: a second start() must not create a second interval
      polling = true;
      visibility.addVisibilityListener(onVisibility);
      // Honest gating: if the tab is already hidden, do NOT poll until it becomes visible.
      if (visibility.isHidden()) return;
      void refresh();
      startInterval();
    },
    stop: () => {
      polling = false;
      visibility.removeVisibilityListener(onVisibility);
      stopInterval();
      closeModal();
    },
  };
}
