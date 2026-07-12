/**
 * Conversation list + persistence controller (session management slice).
 *
 * Owns Cowork conversation identity separate from the OpenCode runtime session id.
 * The UI calls this module; it talks to the loopback conversation + session routes only.
 */
import type { SessionView } from "@cowork-ghc/service/execution";
import type { AttachmentMetadata, ConversationRecord, ConversationStatus, ConversationSummary, RuntimeTurnRecord, ServiceClient } from "./service-client.js";
export type RuntimePhase = "idle" | "starting" | "ready" | "running" | "cancelling" | "completed" | "completed_without_final_message" | "denied" | "failed" | "cancelled";
export interface ConversationManagerState {
    summaries: readonly ConversationSummary[];
    activeConversationId: string | null;
    activeRecord: ConversationRecord | null;
    runtimeSessionId: string | null;
    runtimePhase: RuntimePhase;
    searchQuery: string;
    loading: boolean;
    listError: string | null;
    continuationAvailable: boolean;
}
export interface ConversationManager {
    readonly state: ConversationManagerState;
    refreshList(): Promise<void>;
    setSearch(query: string): Promise<void>;
    createNew(workspacePath: string, providerId?: string, modelId?: string): Promise<ConversationRecord>;
    select(id: string): Promise<void>;
    rename(id: string, title: string): Promise<void>;
    deleteConversation(id: string): Promise<void>;
    /** Clear runtime binding so a new OpenCode session can be created for the same conversation. */
    startContinuation(): Promise<string>;
    linkRuntimeSession(runtimeSessionId: string, startedAt?: string): Promise<void>;
    completeRuntimeTurn(runtimeSessionId: string, status: RuntimeTurnRecord["status"]): Promise<void>;
    markLastActive(): Promise<void>;
    recordUserMessage(text: string, attachments?: readonly AttachmentMetadata[]): Promise<void>;
    recordAssistantMessage(text: string): Promise<void>;
    setRuntimePhase(phase: RuntimePhase): Promise<void>;
    markInterrupted(): Promise<void>;
    shouldApplyStreamView(sessionId: string): boolean;
    mapTerminalToStatus(terminal: SessionView["terminal"]): ConversationStatus | null;
}
export declare function formatConversationMeta(summary: ConversationSummary): string;
export declare function needsContinuation(record: ConversationRecord | null): boolean;
export declare function createConversationManager(getClient: () => ServiceClient | null): ConversationManager;
//# sourceMappingURL=conversation-controller.d.ts.map