/**
 * Typed accessor for the preload bridge.
 *
 * The renderer sees the shell only through `window.coworkShell`, whose shape is the
 * shared {@link CoworkShellBridge} contract from `@cowork-ghc/contracts`. This module
 * declares that global and returns it with a clear error when absent (e.g. running the
 * renderer in a plain browser during dev). It NEVER imports `app/shell` (CGHC-003).
 */
import { COWORK_SHELL_BRIDGE_KEY } from "@cowork-ghc/contracts";
/** Raised when the renderer is not running inside the Electron shell. */
export class ShellBridgeUnavailableError extends Error {
    constructor() {
        super(`Shell bridge "${COWORK_SHELL_BRIDGE_KEY}" is unavailable — the renderer is not ` +
            `running inside the Cowork GHC Electron shell.`);
        this.name = "ShellBridgeUnavailableError";
    }
}
/** Return the preload bridge, or throw {@link ShellBridgeUnavailableError} if missing. */
export function getShellBridge() {
    const bridge = window[COWORK_SHELL_BRIDGE_KEY];
    if (!bridge) {
        throw new ShellBridgeUnavailableError();
    }
    return bridge;
}
//# sourceMappingURL=bridge.js.map