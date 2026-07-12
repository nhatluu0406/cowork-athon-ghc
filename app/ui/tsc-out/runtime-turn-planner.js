/**
 * Runtime-turn decision logic — reuse live OpenCode session or start a linked new turn.
 */
const TERMINAL_STATUSES = [
    "completed",
    "cancelled",
    "errored",
    "interrupted",
];
export function conversationNeedsNewRuntimeTurn(record) {
    if (record === null)
        return false;
    if (record.runtimeSessionId === null)
        return record.messages.length > 0;
    return TERMINAL_STATUSES.includes(record.status);
}
/**
 * Decide whether to reuse the current runtime session or create a new linked turn.
 */
export async function planRuntimeTurn(client, record) {
    const priorMessages = record.messages;
    const runtimeId = record.runtimeSessionId;
    if (runtimeId === null) {
        return {
            action: "new_turn",
            priorMessages,
            reason: priorMessages.length > 0 ? "terminal" : "no_runtime",
        };
    }
    if (TERMINAL_STATUSES.includes(record.status)) {
        return { action: "new_turn", priorMessages, reason: "terminal" };
    }
    try {
        const refreshed = await client.getRuntimeSession(runtimeId);
        if (refreshed.canPrompt && refreshed.view.terminal === null) {
            return { action: "reuse", runtimeSessionId: runtimeId };
        }
        return { action: "new_turn", priorMessages, reason: "terminal" };
    }
    catch {
        return { action: "new_turn", priorMessages, reason: "unavailable" };
    }
}
//# sourceMappingURL=runtime-turn-planner.js.map