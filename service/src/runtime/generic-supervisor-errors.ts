/**
 * Typed failures for the generic bundled-child supervisor ({@link GenericChildSupervisor}), the
 * ADR 0010 sibling of the OpenCode supervisor's `errors.ts`. Each failure a generic child start
 * can hit maps to ONE typed error so callers never pattern-match on a raw string. Messages are
 * secret-free by construction — they carry only the role name, host/port, and an OS error code,
 * never a credential value (the M365KG launch specs put every secret in env, never argv).
 */

/** `start()` was called while a generic child is already starting or ready (one owner per role). */
export class GenericChildAlreadyStartedError extends Error {
  readonly code = "generic_child_already_started" as const;
  readonly role: string;
  constructor(role: string) {
    super(`A ${role} child is already owned by this supervisor; stop() it before starting another`);
    this.name = "GenericChildAlreadyStartedError";
    this.role = role;
  }
}

/** A generic child could not be spawned (e.g. binary missing → ENOENT) or exited before ready. */
export class GenericChildSpawnError extends Error {
  readonly code = "generic_child_spawn_failed" as const;
  readonly role: string;
  /** The OS error code when known (e.g. "ENOENT"). */
  readonly osCode: string | undefined;
  constructor(role: string, message: string, osCode?: string, options?: { cause?: unknown }) {
    super(`${role}: ${message}`, options);
    this.name = "GenericChildSpawnError";
    this.role = role;
    this.osCode = osCode;
  }
}

/** The child never reported readiness within the per-role bound. */
export class GenericChildReadinessTimeoutError extends Error {
  readonly code = "generic_child_readiness_timeout" as const;
  readonly role: string;
  readonly timeoutMs: number;
  constructor(role: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(`${role} child did not become ready within ${timeoutMs}ms`, options);
    this.name = "GenericChildReadinessTimeoutError";
    this.role = role;
    this.timeoutMs = timeoutMs;
  }
}

/** The requested loopback port is already in use before spawn. */
export class GenericChildPortInUseError extends Error {
  readonly code = "generic_child_port_in_use" as const;
  readonly role: string;
  readonly host: string;
  readonly port: number;
  constructor(role: string, host: string, port: number) {
    super(`${role} port ${host}:${port} is already in use`);
    this.name = "GenericChildPortInUseError";
    this.role = role;
    this.host = host;
    this.port = port;
  }
}

/**
 * The child was ready but its OS identity (start-time + exePath) could not be captured, so a
 * verifiable record can never be written. We fail closed rather than persist an identity we
 * cannot re-verify before a later kill (mirrors {@link RuntimeIdentityCaptureError}, ADR 0004 LC3).
 */
export class GenericChildIdentityCaptureError extends Error {
  readonly code = "generic_child_identity_capture_failed" as const;
  readonly role: string;
  constructor(role: string, pid: number, options?: { cause?: unknown }) {
    super(`Could not capture OS identity for ${role} child pid ${pid}`, options);
    this.name = "GenericChildIdentityCaptureError";
    this.role = role;
  }
}

/** Map a raw spawn 'error' into a typed {@link GenericChildSpawnError} (ENOENT etc.). */
export function genericSpawnErrorFrom(role: string, err: unknown): GenericChildSpawnError {
  const code =
    typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : undefined;
  const message = code === "ENOENT" ? "binary not found (ENOENT)" : "child failed to spawn";
  return new GenericChildSpawnError(role, message, code, { cause: err });
}
