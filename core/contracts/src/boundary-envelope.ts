/**
 * Boundary envelope — the canonical, shell-neutral wire contract for the loopback
 * service (ADR 0003).
 *
 * This is the SINGLE source of truth for the versioned request/response envelope that
 * every HTTP client of the local application service shares (the renderer, the shell,
 * the integration tests) and that the service itself produces. It lives in the pure-TS
 * contracts barrel so both the Node-only service and the browser renderer bundle import
 * the exact same shapes — no re-declared, drift-prone copy on either side.
 *
 * Pure TypeScript: no Node/Electron imports, so the renderer/web bundle can import it
 * safely. The service re-exports these under the same names from
 * `service/src/boundary/contract.ts`, so existing service consumers are unchanged.
 */

/** Protocol version tag carried on every envelope; bump only via a superseding ADR. */
export const BOUNDARY_PROTOCOL_VERSION = "cghc.boundary.v1";
export type BoundaryProtocolVersion = typeof BOUNDARY_PROTOCOL_VERSION;

/** Canonical, closed set of boundary error codes. */
export type BoundaryErrorCode =
  | "unauthorized" // no client token presented
  | "forbidden" // client token present but invalid
  | "invalid_host" // Host header not an allowed loopback authority (rebinding defense)
  | "not_found" // no route matched method + path
  | "bad_request" // malformed request body / payload
  | "payload_too_large" // body exceeded the configured cap
  | "internal"; // unexpected failure at the boundary

export interface BoundaryError {
  readonly code: BoundaryErrorCode;
  readonly message: string;
}

/** Successful response envelope carrying typed `data`. */
export interface SuccessEnvelope<T> {
  readonly protocol: BoundaryProtocolVersion;
  readonly ok: true;
  readonly data: T;
}

/** Failure response envelope carrying a typed `error`. */
export interface ErrorEnvelope {
  readonly protocol: BoundaryProtocolVersion;
  readonly ok: false;
  readonly error: BoundaryError;
}

export type ResponseEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

// ---- Built-in health/ready contract -----------------------------------------

export const SERVICE_NAME = "cowork-ghc-local-service";

/** Payload of the built-in `GET /v1/health` route (cold-start readiness, design §11). */
export interface HealthData {
  readonly status: "ok";
  readonly service: typeof SERVICE_NAME;
  readonly startedAt: string; // ISO-8601
  readonly uptimeMs: number;
  /**
   * Whether the supervised OpenCode runtime is attached + alive (Tier 2). Absent/`false` means the
   * live runtime is not ready to serve a prompt yet (settings-only tier, or the child is still
   * starting) — the renderer uses this to gate the first send and to time a single safe retry rather
   * than sleeping blindly. The socket answering `/v1/health` at all only proves the LOCAL service is
   * up, not the runtime.
   */
  readonly runtimeReady?: boolean;
}
