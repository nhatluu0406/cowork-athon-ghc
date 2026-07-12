/**
 * EV timeline renderer (CGHC-015) — an HONEST, pure render of the authoritative
 * {@link SessionView} the reducer folds from the EV stream.
 *
 * Honesty guarantees this view is responsible for (frontend.md / EV1–EV7):
 *  - EV7: a terminal ("completed"/"errored"/"cancelled"/"denied") region is rendered ONLY
 *    when `view.terminal !== null`. While the run is live it shows a truthful in-progress
 *    status — never a fabricated "completed"/"ready".
 *  - EV6: an error renders a scrubbed, user-facing message ({@link sanitizeErrorMessage})
 *    plus a keyboard-reachable recovery affordance — never a raw stack, never a secret.
 *  - EV1–EV4: plan/todos, steps, tool calls, and file mutations.
 *  - EV5: while the run is live and the reducer exposes `view.progress`, an honest progress
 *    row renders the label plus a determinate bar (`ratio` in 0..1) or a labelled
 *    indeterminate indicator. It is never shown on a terminal view (the reducer clears it) so
 *    the timeline never fabricates a progress bar from data it does not have (CGHC-025).
 *  - streamed assistant text: the growing `text` slice is rendered live (token streaming),
 *    APPEND-ONLY on the delta so long output does not re-serialize on every flush (O(N) total).
 *
 * It holds NO business logic and NO transport: {@link EvStreamHandle} owns the socket +
 * reducer folding and calls {@link TimelineHandle.update} with each folded view. Rendering
 * is incremental — a section is rebuilt only when its slice changed by reference, so token
 * streaming (which only grows `text`) does not thrash the DOM tree.
 */

import { sanitizeErrorMessage, type SessionView } from "@cowork-ghc/service/execution";
import {
  FILE_OP_LABEL,
  RECOVERY_LABEL,
  STATUS_LABEL,
  STEP_LABEL,
  TERMINAL_LABEL,
} from "./timeline-labels.js";
import { createProgressRow } from "./timeline-progress.js";

/** Handle returned by {@link createTimelineView}; the stream client drives `update`. */
export interface TimelineHandle {
  /** The mounted root element (already appended to the container). */
  readonly root: HTMLElement;
  /** Render the given authoritative view honestly (incremental). */
  update(view: SessionView): void;
  /** Remove the timeline from the DOM. */
  destroy(): void;
}

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

function labelledList(className: string, ariaLabel: string): HTMLUListElement {
  const list = el("ul", className);
  list.setAttribute("aria-label", ariaLabel);
  return list;
}

/** Create the timeline DOM once and return an incremental updater. */
export function createTimelineView(
  container: HTMLElement,
  onRecovery?: (kind: string) => void,
): TimelineHandle {
  const root = el("section", "ev-timeline");
  root.setAttribute("aria-label", "Tiến trình thực thi");

  const statusEl = el("p", "ev-status");
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");

  const terminalEl = el("p", "ev-terminal");
  terminalEl.hidden = true;

  // EV5 progress row (label + determinate/indeterminate bar). Owns its own DOM + honesty rules.
  const progress = createProgressRow();

  const todosList = labelledList("ev-todos", "Kế hoạch");
  const stepsList = labelledList("ev-steps", "Các bước");
  const toolsList = labelledList("ev-tools", "Lời gọi công cụ");
  const filesList = labelledList("ev-files", "Thay đổi tệp");

  const textEl = el("pre", "ev-text");
  textEl.setAttribute("aria-label", "Phản hồi trợ lý");

  const errorRegion = el("div", "ev-error");
  errorRegion.setAttribute("role", "alert");
  errorRegion.hidden = true;

  root.append(statusEl, terminalEl, progress.root, todosList, stepsList, toolsList, filesList, textEl, errorRegion);
  container.append(root);

  let prev: SessionView | null = null;
  let hadError = false;
  // The single Text node under `textEl`; kept so token deltas APPEND rather than re-serialize.
  let textNode: Text | null = null;

  function renderStatus(view: SessionView): void {
    statusEl.textContent = STATUS_LABEL[view.status];
    statusEl.dataset["status"] = view.status;
    // EV7: the terminal marker exists ONLY for a real terminal event.
    if (view.terminal === null) {
      terminalEl.hidden = true;
      terminalEl.textContent = "";
      delete terminalEl.dataset["terminalState"];
    } else {
      terminalEl.hidden = false;
      terminalEl.textContent = TERMINAL_LABEL[view.terminal];
      terminalEl.dataset["terminalState"] = view.terminal;
    }
  }

  function renderText(view: SessionView): void {
    const next = view.text;
    if (textNode === null) {
      textNode = document.createTextNode(next);
      textEl.replaceChildren(textNode);
      return;
    }
    const current = textNode.data;
    if (next.length > current.length && next.startsWith(current)) {
      // Fast path: streamed tokens only EXTEND the text — append the delta, no re-serialize.
      textNode.appendData(next.slice(current.length));
    } else if (next !== current) {
      // A snapshot/resync REPLACED the view (shorter or diverged): full set, no stale prefix.
      textNode.data = next;
    }
  }

  function renderTodos(view: SessionView): void {
    todosList.replaceChildren();
    for (const todo of view.todos) {
      const item = el("li", "ev-todo");
      item.dataset["status"] = todo.status;
      item.append(el("span", "ev-todo-title", todo.title));
      item.append(el("span", "ev-todo-status", STEP_LABEL[todo.status]));
      todosList.append(item);
    }
  }

  function renderSteps(view: SessionView): void {
    stepsList.replaceChildren();
    for (const step of view.steps) {
      const item = el("li", "ev-step");
      item.dataset["status"] = step.status;
      item.append(el("span", "ev-step-label", step.label));
      item.append(el("span", "ev-step-status", STEP_LABEL[step.status]));
      stepsList.append(item);
    }
  }

  function renderTools(view: SessionView): void {
    toolsList.replaceChildren();
    for (const call of view.toolCalls) {
      const item = el("li", "ev-tool");
      item.dataset["status"] = call.status;
      item.append(el("span", "ev-tool-name", call.toolName));
      item.append(el("span", "ev-tool-status", STEP_LABEL[call.status]));
      if (call.summary !== undefined) item.append(el("span", "ev-tool-summary", call.summary));
      toolsList.append(item);
    }
  }

  function renderFiles(view: SessionView): void {
    filesList.replaceChildren();
    for (const mutation of view.fileMutations) {
      const item = el("li", "ev-file");
      item.dataset["op"] = mutation.operation;
      const label = mutation.previousPath
        ? `${mutation.previousPath} → ${mutation.path}`
        : mutation.path;
      item.append(el("span", "ev-file-op", FILE_OP_LABEL[mutation.operation]));
      item.append(el("span", "ev-file-path", label));
      filesList.append(item);
    }
  }

  function renderError(view: SessionView): void {
    const error = view.error;
    if (error === null) {
      errorRegion.hidden = true;
      errorRegion.replaceChildren();
      hadError = false;
      return;
    }
    errorRegion.hidden = false;
    errorRegion.replaceChildren();
    // EV6: scrub before it ever touches the DOM (no stack, no secret).
    errorRegion.append(el("p", "ev-error-message", sanitizeErrorMessage(error.message)));

    const kind = error.recovery ?? "retry";
    const button = el("button", "ev-error-recovery", RECOVERY_LABEL[kind] ?? "Thử lại");
    button.type = "button";
    button.dataset["recovery"] = kind;
    button.addEventListener("click", () => onRecovery?.(kind));
    errorRegion.append(button);

    // Focus management: move focus to the recovery action when an error first appears.
    if (!hadError) button.focus();
    hadError = true;
  }

  function update(view: SessionView): void {
    // Guard the live region too: rewriting a `role="status" aria-live="polite"` node on every
    // token spams the screen reader with re-announcements. Only touch it when the announced
    // state actually changed (status or the terminal marker).
    if (prev === null || prev.status !== view.status || prev.terminal !== view.terminal) {
      renderStatus(view);
    }
    // EV5: the reducer hands a NEW progress object on each progress event and clears it on
    // terminal — so guarding on reference (plus the terminal edge) keeps token-only updates
    // from touching the progress row.
    if (prev === null || prev.progress !== view.progress || prev.terminal !== view.terminal) {
      progress.update(view);
    }
    // Incremental: the reducer returns a NEW array reference only when a slice changed, so
    // a token-only update (which grows `text`) skips every list re-render below.
    if (prev === null || prev.todos !== view.todos) renderTodos(view);
    if (prev === null || prev.steps !== view.steps) renderSteps(view);
    if (prev === null || prev.toolCalls !== view.toolCalls) renderTools(view);
    if (prev === null || prev.fileMutations !== view.fileMutations) renderFiles(view);
    if (prev === null || prev.text !== view.text) renderText(view);
    if (prev === null || prev.error !== view.error) renderError(view);
    prev = view;
  }

  return {
    root,
    update,
    destroy: () => root.remove(),
  };
}
