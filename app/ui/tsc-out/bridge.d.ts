/**
 * Typed accessor for the preload bridge.
 *
 * The renderer sees the shell only through `window.coworkShell`, whose shape is the
 * shared {@link CoworkShellBridge} contract from `@cowork-ghc/contracts`. This module
 * declares that global and returns it with a clear error when absent (e.g. running the
 * renderer in a plain browser during dev). It NEVER imports `app/shell` (CGHC-003).
 */
import { type CoworkShellBridge } from "@cowork-ghc/contracts";
declare global {
    interface Window {
        /** Injected by the Electron preload (see COWORK_SHELL_BRIDGE_KEY). */
        readonly coworkShell?: CoworkShellBridge;
    }
}
/** Raised when the renderer is not running inside the Electron shell. */
export declare class ShellBridgeUnavailableError extends Error {
    constructor();
}
/** Return the preload bridge, or throw {@link ShellBridgeUnavailableError} if missing. */
export declare function getShellBridge(): CoworkShellBridge;
//# sourceMappingURL=bridge.d.ts.map