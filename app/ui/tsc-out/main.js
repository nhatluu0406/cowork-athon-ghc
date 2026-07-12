/**
 * Renderer entry.
 *
 * Mounts the HuyTT12-inspired Cowork GHC presentation shell as a thin client of the verified
 * shell bridge + local service. The renderer still owns no filesystem, credential, provider, or
 * runtime business logic.
 */
import { mountCoworkApp } from "./app-shell.js";
function main() {
    const root = document.getElementById("app");
    if (!(root instanceof HTMLElement)) {
        return;
    }
    mountCoworkApp(root);
}
main();
//# sourceMappingURL=main.js.map