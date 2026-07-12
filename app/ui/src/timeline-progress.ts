/**
 * EV5 progress row (CGHC-025) — an HONEST render of the reducer's `view.progress` slice.
 *
 * Owns its own DOM so {@link ./timeline-view} stays under the size budget. Honesty rules:
 *  - It renders NOTHING on a terminal view (the reducer clears `progress` on terminal) or when
 *    there is no progress marker — it never fabricates a bar from data it does not have.
 *  - Determinate (`ratio` in 0..1): `role="progressbar"` with `aria-valuenow`/min/max + a
 *    proportional fill.
 *  - Indeterminate (`ratio` absent): a labelled progressbar with NO `aria-valuenow` (the ratio
 *    is genuinely unknown), marked via `data-determinate="false"`.
 */

import type { SessionView } from "@cowork-ghc/service/execution";

export interface ProgressRow {
  /** The mounted row element; the timeline appends it once. */
  readonly root: HTMLElement;
  /** Reconcile the row against the authoritative view (honest, idempotent). */
  update(view: SessionView): void;
}

export function createProgressRow(): ProgressRow {
  const root = document.createElement("div");
  root.className = "ev-progress";
  root.hidden = true;

  const label = document.createElement("span");
  label.className = "ev-progress-label";

  const bar = document.createElement("div");
  bar.className = "ev-progress-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "1");

  const fill = document.createElement("div");
  fill.className = "ev-progress-fill";
  bar.append(fill);
  root.append(label, bar);

  const update = (view: SessionView): void => {
    const progress = view.terminal === null ? view.progress : undefined;
    if (progress === undefined) {
      root.hidden = true;
      bar.removeAttribute("aria-valuenow");
      bar.dataset["determinate"] = "false";
      return;
    }
    root.hidden = false;
    label.textContent = progress.label;
    bar.setAttribute("aria-label", progress.label);
    if (typeof progress.ratio === "number") {
      const clamped = Math.max(0, Math.min(1, progress.ratio));
      bar.dataset["determinate"] = "true";
      bar.setAttribute("aria-valuenow", String(clamped));
      fill.style.width = `${Math.round(clamped * 100)}%`;
      fill.hidden = false;
    } else {
      bar.dataset["determinate"] = "false";
      bar.removeAttribute("aria-valuenow");
      fill.style.width = "";
      fill.hidden = true;
    }
  };

  return { root, update };
}
