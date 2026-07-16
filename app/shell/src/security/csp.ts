/**
 * Content-Security-Policy for the renderer (renderer-hardening baseline).
 *
 * {@link RENDERER_CSP} is the single source of truth for the policy string. It is
 * delivered as a REAL response header on the document the renderer loads — the renderer
 * is served over the custom `app://` protocol (see `app-protocol.ts`) whose handler
 * attaches this header deterministically, so it never depends on `onHeadersReceived`
 * firing for `file://`. {@link installCsp} additionally stamps the header onto ordinary
 * session responses as defense-in-depth. A `<meta>` tag in `index.html`, if present, is
 * only a third layer — the header is the authoritative control.
 *
 * The policy is intentionally restrictive: no inline script, no `eval`, no remote
 * origins except the loopback service the renderer must reach as an HTTP/WebSocket
 * client (ADR 0003). `connect-src` is scoped to the IPv4 loopback authorities on any port
 * (`127.0.0.1` + `localhost`) because the service binds an ephemeral IPv4-loopback port
 * chosen at launch (`server.listen(0, "127.0.0.1")`). The IPv6 literal `[::1]:*` is NOT
 * listed: Chromium's CSP parser rejects a bracketed IPv6 host with a wildcard port as an
 * invalid source and drops it (a per-launch console error), and the service never binds
 * `::1`, so the entry was pure noise.
 */

import type { Session } from "electron";

/** The single source of truth for the renderer CSP string. */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // `'unsafe-inline'` is required ONLY for styles: Chromium's built-in PDF viewer (PDFium),
  // which renders a workspace `.pdf` inside the `blob:` iframe, applies inline styles to lay out
  // its own toolbar/page/thumbnail chrome. Under a strict `style-src 'self'` those inline styles
  // are refused, the viewer's layout collapses, and the PDF shows as a blank/cramped grey box.
  // The security-critical directive — `script-src 'self'` — stays strict (no inline scripts, the
  // real XSS lever), and `object-src 'none'` is unchanged. CSS-based exfiltration is further
  // constrained because `connect-src`/`img-src`/`font-src` still forbid arbitrary remote origins.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src blob:",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

/**
 * Stamp the CSP as a response header on the given session as defense-in-depth. Merges
 * with any existing headers so we never clobber other security headers. The caller
 * passes the session explicitly (usually `session.defaultSession`) so this module carries
 * no runtime dependency on the electron `session` singleton and stays unit-testable.
 */
export function installCsp(target: Session): void {
  target.webRequest.onHeadersReceived((details, callback) => {
    // Chromium's BUILT-IN PDF viewer (PDFium) is served from a `chrome-extension://` origin and
    // ships its own (Google-authored) CSP. Stamping the renderer policy over it breaks the viewer
    // — its own scripts/resources are refused and the PDF renders as a blank grey box. We never
    // load third-party extensions, so leaving `chrome-extension://` responses untouched is safe;
    // every piece of OUR content (app://, http loopback, etc.) still receives RENDERER_CSP.
    if (details.url.startsWith("chrome-extension://")) {
      callback({ responseHeaders: details.responseHeaders ?? {} });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [RENDERER_CSP],
      },
    });
  });
}
