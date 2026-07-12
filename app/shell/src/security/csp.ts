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
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
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
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [RENDERER_CSP],
      },
    });
  });
}
