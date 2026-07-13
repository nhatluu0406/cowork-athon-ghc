/**
 * Conversation-level provider display.
 *
 * Multi-provider profiles are not implemented yet, so this opens the production Settings modal
 * instead of pretending to be a profile dropdown.
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