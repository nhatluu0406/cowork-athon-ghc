/**
 * Custom `app://` protocol that serves the packaged renderer (GATE 1).
 *
 * The renderer is NOT loaded over `file://`, because `onHeadersReceived` is not
 * guaranteed to fire for `file://` documents and so cannot be trusted to attach the CSP.
 * Instead the Vite-built renderer is served from disk over a registered, privileged
 * `app://cowork` origin whose handler builds every {@link Response} with the strict CSP
 * response header ({@link RENDERER_CSP}) attached deterministically. This gives the
 * document a real, stable origin and a real security header on every response.
 *
 * The handler is a pure function of the request + an injectable file reader, so the
 * header-attachment and the path-traversal guard are unit-testable without launching
 * Electron. The two registration functions take the `protocol` module by parameter
 * (the composition root passes electron's `protocol`), keeping this file free of any
 * runtime electron import.
 */

import type { Protocol } from "electron";
import { readFile as fsReadFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

import { RENDERER_CSP } from "./csp.js";

/** Scheme, host and canonical origin/URL the renderer is served from. */
export const APP_SCHEME = "app";
export const APP_HOST = "cowork";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

/** Minimal request shape the handler needs (a real `Request` satisfies this). */
export interface AppProtocolRequest {
  readonly url: string;
}

/** Injectable filesystem dependency so the handler is testable without disk access. */
export interface AppProtocolDeps {
  readonly readFile: (path: string) => Promise<Uint8Array>;
}

const defaultDeps: AppProtocolDeps = { readFile: (p) => fsReadFile(p) };

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Headers attached to every served document, including the authoritative CSP. */
function documentHeaders(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "content-security-policy": RENDERER_CSP,
    "x-content-type-options": "nosniff",
  };
}

function errorResponse(status: number): Response {
  return new Response(status === 404 ? "Not Found" : "Forbidden", {
    status,
    headers: documentHeaders("text/plain; charset=utf-8"),
  });
}

/**
 * Build the `app://` request handler. Maps a request path to a file under `rendererDir`,
 * refuses anything that escapes that directory, and returns a `Response` carrying the CSP
 * header on both success and error paths.
 */
export function createAppProtocolHandler(
  rendererDir: string,
  deps: AppProtocolDeps = defaultDeps,
): (request: AppProtocolRequest) => Promise<Response> {
  const root = normalize(rendererDir);
  return async (request) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return errorResponse(403);
    }
    if (pathname.includes("\0")) {
      return errorResponse(403);
    }
    if (pathname === "/" || pathname === "") {
      pathname = "/index.html";
    }

    const target = normalize(join(root, pathname));
    // Path-traversal guard: the resolved file must stay inside the renderer directory.
    if (target !== root && !target.startsWith(root + sep)) {
      return errorResponse(403);
    }

    try {
      const body = await deps.readFile(target);
      return new Response(body, { status: 200, headers: documentHeaders(contentTypeFor(target)) });
    } catch {
      return errorResponse(404);
    }
  };
}

/**
 * Register `app://` as a privileged, secure, standard origin. MUST be called before the
 * app `ready` event. `protocol` is electron's `protocol` module, passed by the caller.
 */
export function registerAppScheme(
  protocol: Pick<Protocol, "registerSchemesAsPrivileged">,
): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        allowServiceWorkers: false,
      },
    },
  ]);
}

/** Attach the `app://` handler that serves the renderer. Call after `app.whenReady()`. */
export function installAppProtocol(
  protocol: Pick<Protocol, "handle">,
  rendererDir: string,
  deps: AppProtocolDeps = defaultDeps,
): void {
  protocol.handle(APP_SCHEME, createAppProtocolHandler(rendererDir, deps));
}
