/**
 * Typed failures for the OpenCode child supervisor (CGHC-028 Wave A1).
 *
 * Every failure the supervisor can hit maps to ONE of these so the caller never has to
 * pattern-match on a raw Error string. Messages are secret-free by construction (they carry
 * only ports, roles, pins, and OS error codes — never a key value). `cause` may hold a raw
 * OS error; callers MUST NOT log it verbatim without the shared scrubber.
 */

/** A live OpenCode child could not be spawned (e.g. binary missing → ENOENT). */
export class RuntimeSpawnError extends Error {
  readonly code = "runtime_spawn_failed" as const;
  /** The OS error code when known (e.g. "ENOENT"). */
  readonly osCode: string | undefined;
  constructor(message: string, osCode?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RuntimeSpawnError";
    this.osCode = osCode;
  }
}

/** The child never reported a pinned-and-healthy `/global/health` within the bound. */
export class RuntimeHealthTimeoutError extends Error {
  readonly code = "runtime_health_timeout" as const;
  readonly timeoutMs: number;
  constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`OpenCode child did not become healthy within ${timeoutMs}ms`, options);
    this.name = "RuntimeHealthTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** The requested loopback port is already in use before spawn. */
export class RuntimePortInUseError extends Error {
  readonly code = "runtime_port_in_use" as const;
  readonly host: string;
  readonly port: number;
  constructor(host: string, port: number) {
    super(`Runtime port ${host}:${port} is already in use`);
    this.name = "RuntimePortInUseError";
    this.host = host;
    this.port = port;
  }
}

/**
 * The child was healthy but its OS identity (start-time + exePath) could not be captured, so
 * a `.runtime/` record can never be written unverifiably. We fail closed rather than persist
 * an identity we cannot re-verify before a later kill (ADR 0004 LC3).
 */
export class RuntimeIdentityCaptureError extends Error {
  readonly code = "runtime_identity_capture_failed" as const;
  constructor(pid: number, options?: { cause?: unknown }) {
    super(`Could not capture OS identity for OpenCode child pid ${pid}`, options);
    this.name = "RuntimeIdentityCaptureError";
  }
}

/** `start()` was called while a child is already starting or ready (one owner per child). */
export class RuntimeAlreadyStartedError extends Error {
  readonly code = "runtime_already_started" as const;
  constructor() {
    super("The supervisor already owns a running OpenCode child; stop() it before starting another");
    this.name = "RuntimeAlreadyStartedError";
  }
}
