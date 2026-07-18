/**
 * The local application service (ADR 0003): a standalone Node HTTP server bound to
 * loopback only, guarded by a per-launch client token, dispatching to typed routes
 * mounted on a {@link RouterRegistry}. This is the execution/permission boundary seam
 * that later tasks plug their routers into. SSE-ready: handlers own their own response
 * once streaming routes are added.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  isStreamingRoute,
  type BoundaryAuditSink,
  type BoundaryRouter,
  type HttpMethod,
  type RouteContext,
} from "../boundary/contract.js";
import { createSseWriter } from "./sse-writer.js";
import {
  assertLoopbackHost,
  isAllowedHostHeader,
  shouldAcceptConnection,
  type LoopbackHost,
} from "./loopback.js";
import {
  assertConfiguredToken,
  checkClientToken,
  extractClientToken,
  generateClientToken,
} from "./token.js";
import { RouterRegistry } from "./router-registry.js";
import { createHealthRouter } from "./health-router.js";
import {
  BadRequestError,
  errorEnvelope,
  InvalidJsonBodyError,
  PayloadTooLargeError,
  readJsonBody,
  successEnvelope,
  writeEnvelope,
} from "./http-util.js";

const DEFAULT_HOST: LoopbackHost = "127.0.0.1";
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
const HTTP_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
// Slow-client hardening: bound header/body receipt without breaking future SSE responses
// (these govern REQUEST receipt, not the long-lived response body).
const HEADERS_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
// Idle socket cutoff (streaming routes must send periodic heartbeats to keep the socket live).
const SOCKET_IDLE_TIMEOUT_MS = 120_000;

export interface ServiceOptions {
  /** Bind host; must be loopback (`127.0.0.1`/`::1`). Defaults to `127.0.0.1`. */
  readonly host?: string;
  /** Bind port; `0` (default) asks the OS for a free ephemeral loopback port. */
  readonly port?: number;
  /** Per-launch client token. Defaults to a fresh generated token (never persisted). */
  readonly clientToken?: string;
  /** Hard cap on request body size in bytes. */
  readonly maxBodyBytes?: number;
  /** Local audit sink; receives an event when an unauthenticated route is mounted. */
  readonly onAudit?: BoundaryAuditSink;
  /**
   * Exact-match allowlist of browser origins permitted to call this loopback service cross-origin
   * (e.g. the packaged renderer's `app://cowork`). EMPTY by default: no CORS header is emitted, so
   * Node/test clients (which send no `Origin`) work unchanged and no browser origin is trusted. A
   * listed origin gets a tightly-scoped `Access-Control-Allow-Origin: <that exact origin>` (never
   * `*`) plus a preflight answer — this is NOT permissive CORS, and the per-launch token guard +
   * the loopback Host-header check still apply on top.
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * Additional per-launch tokens that are valid ONLY for the exact paths they list (never the
   * whole boundary). Used so a lower-trust caller (e.g. the OpenCode child, via MS365 P5.5) can be
   * handed a narrower credential than {@link clientToken} — a leak of a scoped token exposes only
   * the routes it was scoped to. Default: none (baseline behavior unchanged).
   */
  readonly pathScopedTokens?: readonly PathScopedToken[];
  /**
   * Live getter for supervised-runtime liveness, surfaced as {@link HealthData.runtimeReady} on the
   * built-in `/v1/health` route. Read on every poll (not captured), so a service constructed before
   * the runtime is up reports the current value each time. Omitted → the field is absent (Tier 1).
   */
  readonly runtimeReady?: () => boolean;
}

/** A token that is valid only for the exact request paths listed in {@link paths}. */
export interface PathScopedToken {
  readonly token: string;
  readonly paths: readonly string[];
}

export interface ServiceAddress {
  readonly host: LoopbackHost;
  readonly port: number;
}

export interface LocalService {
  /** The per-launch client token clients must present. Secret; never log it. */
  readonly clientToken: string;
  /** Mount a downstream router onto the boundary (the extension seam). */
  mount(router: BoundaryRouter): void;
  /** Bind the loopback socket and begin serving. Resolves with the bound address. */
  start(): Promise<ServiceAddress>;
  /** Stop serving and release the socket. Idempotent. */
  stop(): Promise<void>;
  /** The bound address once started, else `undefined`. */
  address(): ServiceAddress | undefined;
}

class LocalServiceImpl implements LocalService {
  readonly clientToken: string;
  private readonly host: LoopbackHost;
  private readonly port: number;
  private readonly maxBodyBytes: number;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly pathScopedTokens: readonly PathScopedToken[];
  private readonly registry: RouterRegistry;
  private readonly server: Server;
  private readonly startedAt = new Date();
  private bound: ServiceAddress | undefined;

  constructor(options: ServiceOptions) {
    // Fail closed on a non-loopback configured host: never bind 0.0.0.0 (P7).
    this.host = assertLoopbackHost(options.host ?? DEFAULT_HOST);
    this.port = options.port ?? 0;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.pathScopedTokens = options.pathScopedTokens ?? [];
    // Reject an empty/too-short caller-supplied token rather than silently locking out clients.
    this.clientToken =
      options.clientToken !== undefined
        ? assertConfiguredToken(options.clientToken)
        : generateClientToken();
    this.registry = new RouterRegistry(options.onAudit);
    this.registry.mount(createHealthRouter(this.startedAt, options.runtimeReady));
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    // Slow-client hardening.
    this.server.headersTimeout = HEADERS_TIMEOUT_MS;
    this.server.requestTimeout = REQUEST_TIMEOUT_MS;
    this.server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    // Defense in depth: drop any socket that is not from a loopback peer, and cut idle sockets.
    this.server.on("connection", (socket) => {
      if (!shouldAcceptConnection(socket.remoteAddress)) {
        socket.destroy();
        return;
      }
      socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => socket.destroy());
    });
  }

  mount(router: BoundaryRouter): void {
    this.registry.mount(router);
  }

  start(): Promise<ServiceAddress> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => {
        this.server.off("listening", onListening);
        reject(err);
      };
      const onListening = (): void => {
        this.server.off("error", onError);
        const info = this.server.address() as AddressInfo;
        this.bound = { host: this.host, port: info.port };
        resolve(this.bound);
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen({ host: this.host, port: this.port });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
      this.server.closeAllConnections?.();
    });
  }

  address(): ServiceAddress | undefined {
    return this.bound;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!shouldAcceptConnection(req.socket.remoteAddress)) {
        req.socket.destroy();
        return;
      }
      // DNS-rebinding defense-in-depth: only a loopback Host at the bound port is served.
      if (!isAllowedHostHeader(req.headers.host, this.bound?.port ?? this.port)) {
        writeEnvelope(res, 403, errorEnvelope("invalid_host", "Host header not allowed."));
        return;
      }
      // Cross-origin access for the packaged renderer (`app://cowork`) ONLY: emit a tightly-scoped
      // CORS header for an allowlisted Origin (echoing that exact origin, never `*`) and answer the
      // browser preflight. A non-allowlisted / absent Origin gets NO CORS header (Node/test clients
      // are unaffected); the token guard + Host check still gate every real request below.
      if (this.applyCors(req, res)) return; // preflight fully handled → stop here
      const method = req.method as HttpMethod;
      if (!HTTP_METHODS.includes(method)) {
        writeEnvelope(res, 404, errorEnvelope("not_found", "Unsupported method."));
        return;
      }
      const url = new URL(req.url ?? "/", `http://${this.host}`);
      const matched = this.registry.match(method, url.pathname);
      if (!matched) {
        writeEnvelope(res, 404, errorEnvelope("not_found", "No route for this path."));
        return;
      }
      const route = matched.definition;
      const params = matched.params;
      if (route.publicUnauthenticated !== true) {
        const presented = extractClientToken({
          authorization: req.headers.authorization,
          xCoworkToken: singleHeader(req.headers["x-cowork-token"]),
        });
        const check = checkClientToken(this.clientToken, presented);
        if (check === "missing") {
          writeEnvelope(res, 401, errorEnvelope("unauthorized", "Client token required."));
          return;
        }
        if (check === "invalid" && !this.scopedTokenAllows(presented, url.pathname)) {
          writeEnvelope(res, 403, errorEnvelope("forbidden", "Invalid client token."));
          return;
        }
      }
      // A STREAMING route owns the response: after the (fail-closed) token guard, hand it the
      // SseWriter and let it write its own SSE headers + frames. It is NEVER envelope-wrapped,
      // and no JSON body is read (streaming routes are GET). Client disconnect + teardown are
      // handled by the SseWriter (subscription close + heartbeat clear).
      if (isStreamingRoute(route)) {
        const ctx: RouteContext = { method, url, params, body: undefined };
        await route.stream(ctx, createSseWriter(req, res));
        return;
      }
      const body = await readJsonBody(req, this.maxBodyBytes);
      const ctx: RouteContext = { method, url, params, body };
      const result = await route.handler(ctx);
      writeEnvelope(res, result.status, successEnvelope(result.data));
    } catch (err) {
      this.fail(res, err);
    }
  }

  /**
   * Apply tightly-scoped CORS for an allowlisted browser origin and answer preflight. Returns
   * `true` when the request was an OPTIONS preflight fully handled here (the caller must stop).
   *
   * Security: the origin is echoed back ONLY when it is an EXACT allowlist match — never `*`, never
   * reflected blindly. An absent Origin (Node/test clients, same-origin) yields no CORS header at
   * all. This does not weaken the token guard or the loopback Host check; it only lets the app's own
   * `app://cowork` renderer make the loopback fetch the CSP already permits.
   */
  private applyCors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = singleHeader(req.headers.origin);
    const allowed = origin !== undefined && this.allowedOrigins.has(origin);
    // Only ACAO + Vary belong on a REAL (non-preflight) response; the Allow-Methods/Headers/Max-Age
    // trio is preflight-only and is set in the OPTIONS branch below.
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      // Preflight: no body. 204 when the origin is allowed (with the request-permitting headers),
      // else 403 with no CORS header so a disallowed origin's real request is never made.
      if (allowed) {
        res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-cowork-token");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      res.statusCode = allowed ? 204 : 403;
      res.end();
      return true;
    }
    return false;
  }

  /** Token scoped to ONLY match on its registered paths (e.g. the child may only reach MS365 tool-call). */
  private scopedTokenAllows(presented: string | undefined, pathname: string): boolean {
    if (presented === undefined) return false;
    for (const scoped of this.pathScopedTokens) {
      if (!scoped.paths.includes(pathname)) continue;
      if (checkClientToken(scoped.token, presented) === "ok") return true;
    }
    return false;
  }

  private fail(res: ServerResponse, err: unknown): void {
    // Only boundary-owned error types may surface their own message. Any other thrown
    // value maps to a fixed generic message per code — a future handler must never leak
    // a path/secret through the envelope (the CGHC-021 scrubber wraps this later too).
    let code: "payload_too_large" | "bad_request" | "internal" = "internal";
    let status = 500;
    let message = "Internal boundary error.";
    if (err instanceof PayloadTooLargeError) {
      code = "payload_too_large";
      status = 413;
      message = err.message;
    } else if (err instanceof InvalidJsonBodyError || err instanceof BadRequestError) {
      // A handler that validates its own body (e.g. a missing required field) raises
      // BadRequestError; surface it as 400 bad_request, not a misleading 500.
      code = "bad_request";
      status = 400;
      message = err.message;
    }
    if (!res.headersSent) writeEnvelope(res, status, errorEnvelope(code, message));
    else res.end();
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Construct a service without starting it (useful for mounting routers first). */
export function createService(options: ServiceOptions = {}): LocalService {
  return new LocalServiceImpl(options);
}
