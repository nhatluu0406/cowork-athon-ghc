/**
 * Conversation turn finalization — assistant text resolution, terminal mapping, fallbacks.
 */

import type { TerminalState } from "@cowork-ghc/contracts";
import type { SessionView } from "@cowork-ghc/service/execution";
import type { RuntimePhase } from "./conversation-controller.js";

export const MISSING_FINAL_FALLBACK_VI =
  "Tác vụ đã hoàn tất nhưng runtime không trả về phản hồi cuối.";

export type FinalizationOutcome =
  | "completed_with_response"
  | "completed_without_final_message"
  | "denied"
  | "cancelled"
  | "failed";

export interface ResolvedFinalText {
  readonly text: string;
  readonly outcome: FinalizationOutcome;
}

export function resolveFinalAssistantText(
  streamedText: string,
  fetchedText: string | null = null,
): ResolvedFinalText {
  const streamed = streamedText.trim();
  if (streamed.length > 0) {
    return { text: streamed, outcome: "completed_with_response" };
  }
  const fetched = fetchedText?.trim() ?? "";
  if (fetched.length > 0) {
    return { text: fetched, outcome: "completed_with_response" };
  }
  return { text: MISSING_FINAL_FALLBACK_VI, outcome: "completed_without_final_message" };
}

export function mapTerminalToRuntimePhase(terminal: TerminalState): RuntimePhase {
  switch (terminal) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "denied":
      return "denied";
    case "errored":
      return "failed";
  }
}

export function runtimePhaseForCompleted(
  resolved: ResolvedFinalText,
  terminal: TerminalState,
): RuntimePhase {
  if (terminal === "completed" && resolved.outcome === "completed_without_final_message") {
    return "completed_without_final_message";
  }
  return mapTerminalToRuntimePhase(terminal);
}

export function shouldPollSessionView(view: SessionView): boolean {
  return view.terminal === "completed" && view.text.trim().length === 0;
}

/**
 * Guard: a runtime session may finalize at most once.
 * Prevents streamed onView(terminal) + watchdog poll from both persisting assistant text.
 */
export function beginTurnFinalization(
  finalizedSessions: Set<string>,
  sessionId: string,
  currentlyFinalizing: boolean,
): boolean {
  if (currentlyFinalizing) return false;
  if (finalizedSessions.has(sessionId)) return false;
  finalizedSessions.add(sessionId);
  return true;
}

export const TERMINAL_GRACE_MS = 200;
export const STREAM_WATCHDOG_MS = 90_000;
export const STREAM_POLL_INTERVAL_MS = 2_000;
export const STREAM_STALL_AFTER_ACTIVITY_MS = 12_000;
