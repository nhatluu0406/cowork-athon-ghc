/**
 * Conversation-level provider display (Phase 1: read-only until multi-profile registry exists).
 */
export interface ConversationProviderControl {
    readonly root: HTMLButtonElement;
    readonly dot: HTMLElement;
    readonly label: HTMLElement;
    readonly failText: HTMLElement;
}
export declare function createConversationProviderControl(): ConversationProviderControl;
export declare function renderConversationProviderControl(control: ConversationProviderControl, input: {
    readonly visible: boolean;
    readonly interactive: boolean;
    readonly label: string;
    readonly status: "ok" | "warn" | "danger" | "idle";
    readonly failed: boolean;
}): void;
//# sourceMappingURL=conversation-provider-control.d.ts.map