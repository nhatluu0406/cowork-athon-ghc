/**
 * The hardened `webPreferences` for the main window (renderer-hardening baseline).
 *
 * Kept as a pure builder, separate from the electron-dependent window factory, so the
 * exact security flags can be asserted in a unit test without constructing a real
 * `BrowserWindow`. Every hardening-relevant flag is set explicitly:
 *   - sandbox: true              → renderer runs in an OS sandbox, no Node
 *   - contextIsolation: true     → preload and page share no JS context
 *   - nodeIntegration: false     → no `require` / Node globals in the page
 *   - webSecurity: true          → same-origin + CSP enforced (never disabled)
 *   - allowRunningInsecureContent: false
 *   - experimentalFeatures: false
 */

import type { WebPreferences } from "electron";

/** Build the hardened `webPreferences`, wiring in the given preload path. */
export function buildMainWindowWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
  };
}
