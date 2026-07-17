/**
 * Renderer entry.
 *
 * Mounts the HuyTT12-inspired Cowork GHC presentation shell as a thin client of the verified
 * shell bridge + local service. The renderer still owns no filesystem, credential, provider, or
 * runtime business logic.
 */

import { mountCoworkApp } from "./app-shell.js";
import { applyThemePreference } from "./theme-manager.js";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";

function main(): void {
  applyThemePreference("system");
  const root = document.getElementById("app");
  if (!(root instanceof HTMLElement)) {
    return;
  }
  mountCoworkApp(root);
}

main();
