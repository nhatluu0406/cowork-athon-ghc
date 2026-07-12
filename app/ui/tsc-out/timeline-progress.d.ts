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
export declare function createProgressRow(): ProgressRow;
//# sourceMappingURL=timeline-progress.d.ts.map