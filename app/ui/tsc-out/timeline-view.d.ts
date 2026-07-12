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
import { type SessionView } from "@cowork-ghc/service/execution";
/** Handle returned by {@link createTimelineView}; the stream client drives `update`. */
export interface TimelineHandle {
    /** The mounted root element (already appended to the container). */
    readonly root: HTMLElement;
    /** Render the given authoritative view honestly (incremental). */
    update(view: SessionView): void;
    /** Remove the timeline from the DOM. */
    destroy(): void;
}
/** Create the timeline DOM once and return an incremental updater. */
export declare function createTimelineView(container: HTMLElement, onRecovery?: (kind: string) => void): TimelineHandle;
//# sourceMappingURL=timeline-view.d.ts.map