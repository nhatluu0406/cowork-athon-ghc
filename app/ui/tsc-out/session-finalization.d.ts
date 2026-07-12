/**
 * Conversation turn finalization — assistant text resolution, terminal mapping, fallbacks.
 */
import type { TerminalState } from "@cowork-ghc/contracts";
import type { SessionView } from "@cowork-ghc/service/execution";
import type { RuntimePhase } from "./conversation-controller.js";
export declare const MISSING_FINAL_FALLBACK_VI = "T\u00E1c v\u1EE5 \u0111\u00E3 ho\u00E0n t\u1EA5t nh\u01B0ng runtime kh\u00F4ng tr\u1EA3 v\u1EC1 ph\u1EA3n h\u1ED3i cu\u1ED1i.";
export type FinalizationOutcome = "completed_with_response" | "completed_without_final_message" | "denied" | "cancelled" | "failed";
export interface ResolvedFinalText {
    readonly text: string;
    readonly outcome: FinalizationOutcome;
}
export declare function resolveFinalAssistantText(streamedText: string, fetchedText?: string | null): ResolvedFinalText;
export declare function mapTerminalToRuntimePhase(terminal: TerminalState): RuntimePhase;
export declare function runtimePhaseForCompleted(resolved: ResolvedFinalText, terminal: TerminalState): RuntimePhase;
export declare function shouldPollSessionView(view: SessionView): boolean;
export declare const TERMINAL_GRACE_MS = 200;
export declare const STREAM_WATCHDOG_MS = 90000;
export declare const STREAM_POLL_INTERVAL_MS = 2000;
export declare const STREAM_STALL_AFTER_ACTIVITY_MS = 12000;
//# sourceMappingURL=session-finalization.d.ts.map