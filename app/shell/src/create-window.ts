/**
 * Main BrowserWindow factory (renderer-hardening baseline).
 *
 * The hardened `webPreferences` come from {@link buildMainWindowWebPreferences} (a pure,
 * separately-tested builder). Navigation is locked down via {@link hardenWebContents}.
 * The renderer is loaded from the custom `app://` origin (see `app-protocol.ts`) — never
 * `file://` — so it has a real origin and receives the CSP as a real response header; it
 * reaches business logic only through the loopback service (ADR 0003).
 */

import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_INDEX_URL } from "./security/app-protocol.js";
import { buildMainWindowWebPreferences } from "./security/window-preferences.js";
import { hardenWebContents } from "./security/navigation.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the compiled preload bundle (emitted next to the main bundle). It is a `.cjs`
 * file — the sandboxed preload is loaded as CommonJS and the shell package is `"type": "module"`,
 * so a `.js` preload would be parsed as ESM and fail to load.
 */
export const PRELOAD_PATH = join(here, "preload.cjs");

/**
 * Create the hardened main window and load the packaged renderer over `app://`.
 * `loadUrl` defaults to the served renderer index and is injectable for tests/tools.
 */
export function createMainWindow(loadUrl: string = APP_INDEX_URL): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: buildMainWindowWebPreferences(PRELOAD_PATH),
  });

  hardenWebContents(window.webContents);
  window.once("ready-to-show", () => window.show());
  void window.loadURL(loadUrl);
  return window;
}
