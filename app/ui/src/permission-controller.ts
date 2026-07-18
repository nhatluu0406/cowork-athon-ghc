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
import type { PermissionMode } from "./ui-shell/permission-mode-control.js";
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
  /** Poll cadence for `start()`; defaults to 500ms while the app is active. */
  readonly pollIntervalMs?: number;
  /** Timer seam; defaults to host `setInterval`/`clearInterval`. Tests inject a fake. */
  readonly timer?: PermissionControllerTimer;
  /** Visibility seam; defaults to the `document` visibility API. Tests inject a fake. */
  readonly visibility?: PermissionControllerVisibility;
  /** Current product permission mode selected in the composer. */
  readonly getMode?: () => PermissionMode;
  /** Chỉ xử lý request có sessionId thỏa predicate. Không truyền = nhận tất cả (hành vi cũ). */
  readonly sessionFilter?: (sessionId: string) => boolean;
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
  /**
   * Pause the poll interval without tearing down the controller (settings→live restart gap).
   * Stops hammering a soon-to-die loopback port with `net::ERR_CONNECTION_REFUSED`.
   */
  pause(): void;
  /** Resume polling after {@link pause} once the live bootstrap is adopted. */
  resume(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createPermissionController(
  deps: PermissionControllerDeps,
): PermissionControllerHandle {
  const intervalMs = deps.pollIntervalMs ?? 500;
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
  let consecutivePollFailures = 0;
  let lastPollAttemptAt = 0;
  let transportErrorShown = false;
  let backoffTimer: unknown = null;
  const announced = new Set<string>();
  const TRANSPORT_ERROR_NOTE =
    "Không tải được yêu cầu quyền. Hãy kiểm tra local service rồi thử lại.";
  const BACKOFF_MS = 3_000;

  const setNote = (text: string): void => {
    note.textContent = text;
    note.hidden = false;
  };
  const clearNote = (): void => {
    note.textContent = "";
    note.hidden = true;
  };
  const clearTransportErrorNote = (): void => {
    if (!transportErrorShown) return;
    transportErrorShown = false;
    // Only clear when the toast is still the transport-error copy — do not wipe decision notes.
    if (note.textContent === TRANSPORT_ERROR_NOTE) clearNote();
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
    lastPending = head;
    if (!announced.has(head.requestId)) {
      announced.add(head.requestId);
      deps.onPending?.(head);
    }

    const mode = deps.getMode?.() ?? "ask";
    if (mode === "read_only") {
      closeModal();
      void decide(head.requestId, false);
      return;
    }
    if (mode === "workspace_auto" && head.approvalLevel === "standard") {
      closeModal();
      void decide(head.requestId, true, "once");
      return;
    }

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
  };

  async function refresh(): Promise<void> {
    if (deciding) return; // a decision + its follow-up refresh is already reconciling
    lastPollAttemptAt = Date.now();
    let pending: readonly PendingPermissionView[];
    try {
      pending = await deps.client.listPendingPermissions();
      // Poll succeeded again (e.g. after settings→live restart). Drop the sticky transport toast
      // that consecutive failures may have raised; otherwise chat can work while the note lingers.
      consecutivePollFailures = 0;
      clearTransportErrorNote();
      // Resume the fast interval after a backoff pause.
      if (polling && !visibility.isHidden() && timerHandle === null) {
        startInterval();
      }
    } catch {
      // Keep any current modal, but do not hide a broken permission transport indefinitely.
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= 3) {
        setNote(TRANSPORT_ERROR_NOTE);
        transportErrorShown = true;
        // Stop the 100ms hammer. One delayed retry only — avoids net::ERR_CONNECTION_REFUSED spam.
        stopInterval();
        if (polling && backoffTimer === null) {
          backoffTimer = setTimeout(() => {
            backoffTimer = null;
            if (!polling || visibility.isHidden()) return;
            void refresh();
          }, BACKOFF_MS);
        }
      }
      return;
    }
    const scoped = deps.sessionFilter
      ? pending.filter((p) => deps.sessionFilter!(p.sessionId))
      : pending;
    const head = scoped[0];
    if (head === undefined) {
      closeModal(); // nothing pending → show nothing (honest idle)
      announced.clear();
      lastPending = null;
      return;
    }
    showHead(head, scoped.length - 1);
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
  const clearBackoff = (): void => {
    if (backoffTimer !== null) {
      clearTimeout(backoffTimer as ReturnType<typeof setTimeout>);
      backoffTimer = null;
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
      clearBackoff();
      closeModal();
    },
    pause: () => {
      // Keep `polling === true` so resume() can restart; only silence the timer/backoff.
      stopInterval();
      clearBackoff();
    },
    resume: () => {
      if (!polling || visibility.isHidden()) return;
      clearBackoff();
      consecutivePollFailures = 0;
      clearTransportErrorNote();
      void refresh();
      startInterval();
    },
  };
}
