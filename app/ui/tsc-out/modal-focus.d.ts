/**
 * Minimal modal focus trap for settings dialog accessibility.
 */
export declare function createModalKeyHandler(options: {
    readonly panel: HTMLElement;
    readonly closeButton: HTMLButtonElement;
    readonly onClose: () => void;
}): (event: KeyboardEvent) => void;
export declare function openModalWithFocus(modal: HTMLElement, initialFocus: HTMLElement, onKeyDownHandler: (event: KeyboardEvent) => void): void;
export declare function closeModalWithFocus(modal: HTMLElement, opener: HTMLElement | null, onKeyDownHandler: (event: KeyboardEvent) => void): void;
//# sourceMappingURL=modal-focus.d.ts.map