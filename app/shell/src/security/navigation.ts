/**
 * Navigation lockdown (renderer-hardening baseline).
 *
 * The renderer is a local, single-origin host served from {@link APP_ORIGIN}. It must
 * never navigate the top-level document off that origin, follow an off-origin redirect,
 * open a native popup / new window, or attach a `<webview>`. {@link hardenWebContents}
 * registers all four denials and is applied to the main window's contents AND to every
 * future `web-contents-created`, so the lockdown cannot be bypassed by a newly created
 * contents.
 *
 * Same-origin navigation to {@link APP_ORIGIN} is allowed (client-side routing, reloads);
 * anything else is denied. The comparison is by URL scheme + host, so a look-alike host
 * or a different scheme is rejected.
 */

import type { WebContents } from "electron";

import { APP_ORIGIN } from "./app-protocol.js";

function isSameOrigin(url: string, allowedOrigin: string): boolean {
  try {
    const target = new URL(url);
    const allowed = new URL(allowedOrigin);
    // Compare scheme + host (a custom, non-"special" scheme like `app:` reports its
    // `.origin` as the opaque string "null", so an origin-string compare is unusable).
    return target.protocol === allowed.protocol && target.host === allowed.host;
  } catch {
    return false;
  }
}

/**
 * Register the four navigation denials on `contents`:
 *   1. `will-navigate`        — allow same-origin, deny off-origin
 *   2. `will-redirect`        — allow same-origin, deny off-origin
 *   3. `setWindowOpenHandler` — always deny (`{ action: 'deny' }`)
 *   4. `will-attach-webview`  — always deny
 */
export function hardenWebContents(
  contents: WebContents,
  allowedOrigin: string = APP_ORIGIN,
): void {
  contents.on("will-navigate", (event, url) => {
    if (!isSameOrigin(url, allowedOrigin)) {
      event.preventDefault();
    }
  });
  contents.on("will-redirect", (event, url) => {
    if (!isSameOrigin(url, allowedOrigin)) {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}
