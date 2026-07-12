/**
 * Runtime-turn decision logic — reuse live OpenCode session or start a linked new turn.
 */
import type { ConversationRecord, ServiceClient } from "./service-client.js";
export type RuntimeTurnPlan = {
    readonly action: "reuse";
    readonly runtimeSessionId: string;
} | {
    readonly action: "new_turn";
    readonly priorMessages: readonly ConversationRecord["messages"][number][];
    readonly reason: "no_runtime" | "terminal" | "unavailable";
};
export declare function conversationNeedsNewRuntimeTurn(record: ConversationRecord | null): boolean;
/**
 * Decide whether to reuse the current runtime session or create a new linked turn.
 */
export declare function planRuntimeTurn(client: ServiceClient, record: ConversationRecord): Promise<RuntimeTurnPlan>;
//# sourceMappingURL=runtime-turn-planner.d.ts.map