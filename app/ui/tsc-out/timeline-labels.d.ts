/**
 * EV timeline label vocabulary (CGHC-015 / CGHC-025) — the Vietnamese, user-facing strings
 * the {@link ./timeline-view} renders for each EV slice. Kept out of the renderer so that file
 * stays a cohesive DOM-building module under the size budget. These are pure display maps: no
 * logic, no secrets, no fabricated status text.
 */
import type { FileMutationOp, SessionStatus, StepStatus, TerminalState } from "@cowork-ghc/contracts";
export declare const STATUS_LABEL: Record<SessionStatus, string>;
export declare const TERMINAL_LABEL: Record<TerminalState, string>;
export declare const STEP_LABEL: Record<StepStatus, string>;
export declare const FILE_OP_LABEL: Record<FileMutationOp, string>;
/** Non-secret recovery-action labels; the reducer flattens recovery to its `kind` string. */
export declare const RECOVERY_LABEL: Record<string, string>;
//# sourceMappingURL=timeline-labels.d.ts.map