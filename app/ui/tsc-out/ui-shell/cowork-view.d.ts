import { type ConversationProviderControl } from "./conversation-provider-control.js";
export interface CoworkViewDom {
    readonly root: HTMLElement;
    readonly chatTitle: HTMLElement;
    readonly chatSub: HTMLElement;
    readonly transcript: HTMLElement;
    readonly continuationBanner: HTMLElement;
    readonly continuationButton: HTMLButtonElement;
    readonly transcriptInner: HTMLElement;
    readonly emptyState: HTMLElement;
    readonly emptyStateCta: HTMLButtonElement;
    readonly thinking: HTMLElement;
    readonly composer: HTMLElement;
    readonly composerInput: HTMLElement;
    readonly composerHint: HTMLElement;
    readonly composerPreflight: HTMLElement;
    readonly composerPreflightMessage: HTMLElement;
    readonly composerPreflightCta: HTMLButtonElement;
    readonly attachButton: HTMLButtonElement;
    readonly attachmentChips: HTMLElement;
    readonly sendButton: HTMLButtonElement;
    readonly cancelButton: HTMLButtonElement;
    readonly providerControl: ConversationProviderControl;
    readonly skillsButton: HTMLButtonElement;
}
export declare function createCoworkView(defaultTitle: string): CoworkViewDom;
//# sourceMappingURL=cowork-view.d.ts.map