/**
 * The Gateway's real HTTP proxy — the ONE piece that makes "Gateway" true to the term rather
 * than a permission check bolted onto the existing direct path. OpenCode's `opencode.json`
 * `baseURL` points HERE (see `gateway-service.ts`'s baseUrl swap) instead of the real provider
 * endpoint. Every actual chat-completion call physically flows through this process:
 * request in → gate check → forward to the REAL upstream with the SAME credential OpenCode
 * already holds → stream the REAL response back untouched → record REAL metrics.
 *
 * Deliberately NOT the@ai-sdk/openai-compatible request/response shape parsed and rebuilt —
 * this is a byte-transparent reverse proxy. OpenCode never notices anything different about
 * the wire format; only the destination host changed.
 */

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { resetGatewayProxyBaseUrl, setGatewayProxyBaseUrl } from "./gateway-proxy-url.js";
import { parseChatCompletionRequest } from "./prompt-extract.js";

/** Stop accumulating request bytes for parsing beyond this — metrics keep counting regardless. */
const MAX_BODY_CAPTURE_BYTES = 2 * 1024 * 1024;

/**
 * The path segment this proxy always presents itself under (see `boundBaseUrl` in `start()`).
 * OpenCode's client resolves `chat/completions` against the configured baseURL, so every
 * incoming request arrives as `${PROXY_BASE_PATH}/<rest>` regardless of what path the REAL
 * upstream actually needs — that real path is preserved by stripping this fixed prefix and
 * re-joining the remainder onto `upstream.baseUrl`'s own path (not by naively resolving
 * `req.url` as an absolute path against the upstream, which would silently discard it).
 */
const PROXY_BASE_PATH = "/v1";

export interface ProxyUpstream {
  /** The REAL provider base URL this request should actually be forwarded to. */
  readonly baseUrl: string;
}

export interface ProxyRequestOutcome {
  readonly httpStatus: number;
  readonly ttfbMs: number;
  readonly totalMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly errorMessage?: string;
  /** Parsed straight from the REAL request body this proxy received — not inferred/guessed. */
  readonly modelId?: string;
}

export interface GatewayProxyServerOptions {
  /** Resolve which real upstream to forward to for the request in flight right now. */
  readonly resolveUpstream: () => ProxyUpstream | undefined;
  /** Called once the proxied request finishes (success or failure) with REAL measurements. */
  readonly onRequestComplete: (outcome: ProxyRequestOutcome) => void;
  /**
   * Port to bind. Default: an ephemeral OS-assigned port (0) — the composition root passes the
   * fixed `DEFAULT_GATEWAY_PROXY_PORT` (gateway-proxy-url.ts) for production so a persisted,
   * gateway-swapped profile baseUrl keeps resolving across restarts/tier transitions; tests keep
   * the ephemeral default to avoid port collisions across parallel workers.
   */
  readonly port?: number;
}

export interface GatewayProxyServer {
  start(): Promise<{ readonly baseUrl: string }>;
  stop(): Promise<void>;
  /** The bound base URL (e.g. `http://127.0.0.1:54321/v1`) — undefined before `start()`. */
  getBaseUrl(): string | undefined;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function forwardableRequestHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function forwardableResponseHeaders(headers: IncomingMessage["headers"]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Build the whole `service/src/gateway` proxy as a standalone `node:http` server (raw HTTP,
 * matching this codebase's convention — see `server/http-service.ts`), bound to loopback only.
 */
export function createGatewayProxyServer(options: GatewayProxyServerOptions): GatewayProxyServer {
  const port = options.port ?? 0; // 0 = OS-assigned ephemeral port (see gateway-proxy-url.ts)
  let server: ReturnType<typeof createServer> | null = null;
  let boundBaseUrl: string | undefined;

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const startedAt = Date.now();
    let firstByteAt: number | null = null;
    let requestBytes = 0;
    let responseBytes = 0;
    const bodyChunks: Buffer[] = [];

    function parsedRequestBody(): { modelId?: string } {
      if (bodyChunks.length === 0) return {};
      try {
        return parseChatCompletionRequest(Buffer.concat(bodyChunks).toString("utf8"));
      } catch {
        return {};
      }
    }

    const upstream = options.resolveUpstream();
    if (upstream === undefined) {
      const body = JSON.stringify({
        error: { message: "Gateway: no active account for the current provider.", type: "gateway_blocked" },
      });
      res.writeHead(503, { "content-type": "application/json" });
      res.end(body);
      options.onRequestComplete({
        httpStatus: 503,
        ttfbMs: Date.now() - startedAt,
        totalMs: Date.now() - startedAt,
        requestBytes: 0,
        responseBytes: body.length,
        errorMessage: "no_active_account",
      });
      return;
    }

    let upstreamUrl: URL;
    try {
      const upstreamBase = new URL(upstream.baseUrl);
      const incomingPath = req.url ?? "/";
      const suffix = incomingPath.startsWith(PROXY_BASE_PATH)
        ? incomingPath.slice(PROXY_BASE_PATH.length)
        : incomingPath;
      const basePath = upstreamBase.pathname.replace(/\/+$/u, "");
      const suffixPath = suffix.startsWith("/") ? suffix : `/${suffix}`;
      upstreamUrl = new URL(`${basePath}${suffixPath}`, upstreamBase.origin);
    } catch {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Gateway: invalid upstream URL." } }));
      return;
    }

    const isHttps = upstreamUrl.protocol === "https:";
    const dial = isHttps ? httpsRequest : httpRequest;
    const upstreamReq = dial(
      {
        protocol: upstreamUrl.protocol,
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port !== "" ? upstreamUrl.port : isHttps ? 443 : 80,
        path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
        method: req.method,
        headers: { ...forwardableRequestHeaders(req.headers), host: upstreamUrl.host },
      },
      (upstreamRes) => {
        firstByteAt = Date.now();
        res.writeHead(upstreamRes.statusCode ?? 502, forwardableResponseHeaders(upstreamRes.headers));
        upstreamRes.on("data", (chunk: Buffer) => {
          responseBytes += chunk.length;
        });
        upstreamRes.pipe(res);
        upstreamRes.on("end", () => {
          options.onRequestComplete({
            httpStatus: upstreamRes.statusCode ?? 502,
            ttfbMs: (firstByteAt ?? Date.now()) - startedAt,
            totalMs: Date.now() - startedAt,
            requestBytes,
            responseBytes,
            ...parsedRequestBody(),
          });
        });
      },
    );

    upstreamReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Gateway: upstream unreachable." } }));
      } else {
        res.end();
      }
      options.onRequestComplete({
        httpStatus: 502,
        ttfbMs: (firstByteAt ?? Date.now()) - startedAt,
        totalMs: Date.now() - startedAt,
        requestBytes,
        responseBytes,
        errorMessage: err.message,
        ...parsedRequestBody(),
      });
    });

    req.on("data", (chunk: Buffer) => {
      requestBytes += chunk.length;
      if (requestBytes <= MAX_BODY_CAPTURE_BYTES) bodyChunks.push(chunk);
    });
    req.pipe(upstreamReq);
  }

  return {
    start(): Promise<{ baseUrl: string }> {
      return new Promise((resolve, reject) => {
        const s = createServer(handle);
        s.on("error", reject);
        // Never the sole reason the process stays alive — a composed-but-never-started instance
        // (some tests only inspect `deps` without starting the service) must not hang on exit.
        s.unref();
        // Loopback-only bind — the proxy is never reachable from outside this machine, matching
        // every other Cowork GHC service boundary (M1 loopback-only bind).
        s.listen(port, "127.0.0.1", () => {
          server = s;
          const address = s.address();
          const boundPort = typeof address === "object" && address !== null ? address.port : port;
          boundBaseUrl = `http://127.0.0.1:${boundPort}${PROXY_BASE_PATH}`;
          setGatewayProxyBaseUrl(boundBaseUrl);
          resolve({ baseUrl: boundBaseUrl });
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        if (server === null) {
          resolve();
          return;
        }
        server.close(() => {
          server = null;
          boundBaseUrl = undefined;
          resetGatewayProxyBaseUrl();
          resolve();
        });
      });
    },
    getBaseUrl(): string | undefined {
      return boundBaseUrl;
    },
  };
}
