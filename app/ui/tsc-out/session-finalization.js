/**
 * Conversation turn finalization — assistant text resolution, terminal mapping, fallbacks.
 */
export const MISSING_FINAL_FALLBACK_VI = "Tác vụ đã hoàn tất nhưng runtime không trả về phản hồi cuối.";
export function resolveFinalAssistantText(streamedText, fetchedText = null) {
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
export function mapTerminalToRuntimePhase(terminal) {
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
export function runtimePhaseForCompleted(resolved, terminal) {
    if (terminal === "completed" && resolved.outcome === "completed_without_final_message") {
        return "completed_without_final_message";
    }
    return mapTerminalToRuntimePhase(terminal);
}
export function shouldPollSessionView(view) {
    return view.terminal === "completed" && view.text.trim().length === 0;
}
export const TERMINAL_GRACE_MS = 200;
export const STREAM_WATCHDOG_MS = 90_000;
export const STREAM_POLL_INTERVAL_MS = 2_000;
export const STREAM_STALL_AFTER_ACTIVITY_MS = 12_000;
//# sourceMappingURL=session-finalization.js.map