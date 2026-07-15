/**
 * Turn / processing UI ownership helpers — keep "Đang xử lý" bound to the active conversation turn.
 */

import type { RuntimePhase } from "./conversation-controller.js";

export interface ProcessingVisibilityInput {
  readonly activeConversationId: string | null;
  readonly processingConversationId: string | null;
  readonly runtimePhase: RuntimePhase;
}

/** True only when the visible conversation owns a live starting/running/cancelling turn. */
export function shouldShowProcessing(input: ProcessingVisibilityInput): boolean {
  if (input.activeConversationId === null) return false;
  if (input.processingConversationId !== input.activeConversationId) return false;
  return (
    input.runtimePhase === "running" ||
    input.runtimePhase === "starting" ||
    input.runtimePhase === "cancelling"
  );
}

export function isTerminalRuntimePhase(phase: RuntimePhase): boolean {
  return (
    phase === "idle" ||
    phase === "ready" ||
    phase === "completed" ||
    phase === "completed_without_final_message" ||
    phase === "failed" ||
    phase === "cancelled" ||
    phase === "denied"
  );
}
