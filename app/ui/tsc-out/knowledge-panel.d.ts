/**
 * Knowledge panel — renders citations from M365 Knowledge Graph queries (T2.4).
 *
 * Contextual panel following activity-panel.ts pattern. Shows citations when a turn
 * includes a KnowledgeToolInvocation; renders nothing when no knowledge-tool call occurred (US-2).
 * Vietnamese-first copy per R5.
 */
import type { KnowledgeCitation } from "@cowork-ghc/service/knowledge/types";
export interface KnowledgeToolInvocation {
    readonly toolName: "m365_knowledge_search";
    readonly query: string;
    readonly outcome: "answered" | "unavailable" | "timeout" | "permission_denied";
    readonly answer: string | null;
    readonly citations: readonly KnowledgeCitation[];
    readonly syncedAt: string | null;
    readonly requestedAt: string;
    readonly respondedAt: string;
}
export interface KnowledgePanelDom {
    readonly root: HTMLElement;
    readonly citations: HTMLElement;
    readonly answerContainer: HTMLElement;
    readonly statusContainer: HTMLElement;
}
export declare function createKnowledgePanel(host: HTMLElement, config: {
    invocation: KnowledgeToolInvocation | null;
}): KnowledgePanelDom;
//# sourceMappingURL=knowledge-panel.d.ts.map