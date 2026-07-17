/**
 * Typed boundary contract for the Cowork GHC local application service (ADR 0003).
 *
 * This is the load-bearing HTTP surface: a versioned request/response envelope, a
 * typed route/router shape that downstream tasks mount onto the boundary, and a typed
 * client interface. It deliberately avoids a generic IPC passthrough or an untyped
 * catch-all route — every route is a declared {@link RouteDefinition} with a typed
 * result wrapped in a versioned envelope.
 *
 * The wire envelope itself (`BOUNDARY_PROTOCOL_VERSION`, `BoundaryProtocolVersion`,
 * `BoundaryErrorCode`, `BoundaryError`, `SuccessEnvelope`, `ErrorEnvelope`,
 * `ResponseEnvelope`, `SERVICE_NAME`, `HealthData`) is the SINGLE source of truth in the
 * shell-neutral `@cowork-ghc/contracts` barrel so the renderer/web bundle shares the exact
 * same shapes. It is re-exported here under the same names so every existing service
 * consumer/import keeps working unchanged.
 */

export {
  BOUNDARY_PROTOCOL_VERSION,
  SERVICE_NAME,
  type BoundaryProtocolVersion,
  type BoundaryErrorCode,
  type BoundaryError,
  type SuccessEnvelope,
  type ErrorEnvelope,
  type ResponseEnvelope,
  type HealthData,
} from "@cowork-ghc/contracts";

import type { BoundaryErrorCode, HealthData } from "@cowork-ghc/contracts";

/** HTTP methods the boundary router accepts. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Parsed, validated request context handed to a route handler. */
export interface RouteContext {
  readonly method: HttpMethod;
  readonly url: URL;
  /** Reserved for path params once pattern routing is added; empty for exact routes. */
  readonly params: Readonly<Record<string, string>>;
  /** Parsed JSON body (or `undefined` for bodyless requests); validate before use. */
  readonly body: unknown;
}

/** What a route handler returns; `data` is wrapped into a {@link SuccessEnvelope}. */
export interface RouteResult<T = unknown> {
  readonly status: number;
  readonly data: T;
}

export type RouteHandler = (ctx: RouteContext) => Promise<RouteResult> | RouteResult;

/**
 * A single declared route. The token guard is ON by default (fail-closed): omit
 * `publicUnauthenticated` for a normal, token-guarded route. A route may ONLY skip the
 * per-launch token guard by explicitly setting `publicUnauthenticated: true` — the bare
 * `requiresToken:false` opt-out is deliberately not supported so an unauthenticated route
 * is always an explicit, reviewable decision. Mounting one emits a {@link BoundaryAuditEvent}.
 */
export interface RouteDefinition {
  readonly method: HttpMethod;
  /** Exact path with a leading slash, e.g. `/v1/health`. */
  readonly path: string;
  readonly handler: RouteHandler;
  /** Explicit, audited opt-out of the token guard. Use ONLY for deliberately public routes. */
  readonly publicUnauthenticated?: true;
}

// ---- Streaming (SSE) route seam (CGHC-015) -----------------------------------

/**
 * A thin, typed handle a STREAMING route uses to OWN the long-lived `ServerResponse`.
 *
 * The dispatcher hands this to a streaming handler ONLY AFTER the token guard passes
 * (fail-closed, exactly like a normal route) and NEVER wraps the streamed body in a JSON
 * envelope — the handler writes the SSE headers, EV frames, and periodic heartbeats itself
 * and registers teardown via {@link onClose}. Pre-stream client/routing errors may still be
 * reported with the normal envelope via {@link fail} (before {@link open}).
 */
export interface SseWriter {
  /** Send the SSE response headers (200 `text/event-stream`, no-store). Call once, first. */
  open(): void;
  /** Write one pre-encoded SSE frame (an EV frame or a heartbeat). No-op once closed. */
  write(frame: string): void;
  /**
   * Report a pre-stream error with the standard versioned envelope (e.g. unknown session).
   * Valid ONLY before {@link open}; after the stream is open the response is committed.
   */
  fail(status: number, code: BoundaryErrorCode, message: string): void;
  /** Register a teardown callback fired on client disconnect or {@link end}. */
  onClose(listener: () => void): void;
  /** End the response and fire teardown. Idempotent. */
  end(): void;
  /** True once the socket closed (client gone) or {@link end}/{@link fail} ran. */
  readonly closed: boolean;
}

/**
 * A streaming route handler. Instead of returning a {@link RouteResult}, it OWNS the
 * response through {@link SseWriter}. It must return promptly after wiring its subscription
 * + heartbeat (the socket stays open via those, not by blocking the event loop).
 */
export type StreamRouteHandler = (ctx: RouteContext, sse: SseWriter) => void | Promise<void>;

/**
 * A declared STREAMING route, discriminated from a normal {@link RouteDefinition} by the
 * presence of `stream`. Token-guarded by default like any route; the dispatcher does NOT
 * envelope-wrap its response.
 */
export interface StreamingRouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly stream: StreamRouteHandler;
  /** Explicit, audited opt-out of the token guard. Use ONLY for deliberately public routes. */
  readonly publicUnauthenticated?: true;
}

/** Either a normal request/response route or a streaming route. */
export type AnyRouteDefinition = RouteDefinition | StreamingRouteDefinition;

/** Discriminate a streaming route from a normal one (presence of the `stream` handler). */
export function isStreamingRoute(def: AnyRouteDefinition): def is StreamingRouteDefinition {
  return "stream" in def;
}

/**
 * A named group of routes. Downstream tasks (workspace, session, permission, files,
 * provider, credential, diagnostics, execution) each expose a `BoundaryRouter` and
 * mount it onto the service via {@link LocalService.mount} — this is the extension seam.
 * Routes may be normal or streaming ({@link AnyRouteDefinition}).
 */
export interface BoundaryRouter {
  readonly name: string;
  readonly routes: readonly AnyRouteDefinition[];
}

// ---- Boundary audit ---------------------------------------------------------

/** Emitted when a route that opts out of the token guard is mounted (security-visible). */
export interface UnauthenticatedRouteMounted {
  readonly type: "unauthenticated_route_mounted";
  readonly method: HttpMethod;
  readonly path: string;
  readonly router: string;
}

export type BoundaryAuditEvent = UnauthenticatedRouteMounted;

/** Sink for local boundary audit events (no secret values ever pass through). */
export type BoundaryAuditSink = (event: BoundaryAuditEvent) => void;

// ---- Typed boundary client --------------------------------------------------

/**
 * Typed client contract. The renderer, the shell, and integration tests are all equal
 * HTTP clients of the loopback service (ADR 0003) and reach it only through a typed
 * client like this — never a generic passthrough. Later tasks widen this interface with
 * their own typed methods (workspace/session/…), each mapping to a declared route.
 */
export interface BoundaryClient {
  readonly baseUrl: string;
  health(): Promise<HealthData>;
  close(): void;
}
