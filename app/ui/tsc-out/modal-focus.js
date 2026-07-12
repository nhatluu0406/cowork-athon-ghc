/**
 * Minimal modal focus trap for settings dialog accessibility.
 */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function createModalKeyHandler(options) {
    const { panel, closeButton, onClose } = options;
    const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled"));
    return (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== "Tab")
            return;
        const nodes = focusables();
        if (nodes.length === 0) {
            event.preventDefault();
            closeButton.focus();
            return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (event.shiftKey) {
            if (active === first || !panel.contains(active)) {
                event.preventDefault();
                last.focus();
            }
        }
        else if (active === last || !panel.contains(active)) {
            event.preventDefault();
            first.focus();
        }
    };
}
export function openModalWithFocus(modal, initialFocus, onKeyDownHandler) {
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKeyDownHandler);
    initialFocus.focus();
}
export function closeModalWithFocus(modal, opener, onKeyDownHandler) {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", onKeyDownHandler);
    opener?.focus();
}
//# sourceMappingURL=modal-focus.js.map