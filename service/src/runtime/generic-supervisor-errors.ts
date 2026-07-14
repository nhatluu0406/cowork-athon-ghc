/**
 * Typed failures for {@link GenericChildSupervisor} (ADR 0010 — M365KG stack bundling).
 *
 * Mirrors `errors.ts` (the OpenCode-specific supervisor's error set) exactly in shape, but
 * parameterized by `role` so a Postgres/Neo4j/backend/llm-svc failure never reads as an
 * "OpenCode" failure in a log line. Deliberately a SEPARATE file rather than reusing
 * `errors.ts`'s classes — those hardcode "OpenCode" in their messages.
 */

export class GenericChildSpawnError extends Error {
  readonly code = "child_spawn_failed" as const;
  readonly role: string;
  readonly osCode: string | undefined;
  constructor(role: string, message: string, osCode?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GenericChildSpawnError";
    this.role = role;
    this.osCode = osCode;
  }
}

export class GenericChildHealthTimeoutError extends Error {
  readonly code = "child_health_timeout" as const;
  readonly role: string;
  readonly timeoutMs: number;
  constructor(role: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(`"${role}" child did not become ready within ${timeoutMs}ms`, options);
    this.name = "GenericChildHealthTimeoutError";
    this.role = role;
    this.timeoutMs = timeoutMs;
  }
}

export class GenericChildPortInUseError extends Error {
  readonly code = "child_port_in_use" as const;
  readonly role: string;
  readonly host: string;
  readonly port: number;
  constructor(role: string, host: string, port: number) {
    super(`"${role}" port ${host}:${port} is already in use`);
    this.name = "GenericChildPortInUseError";
    this.role = role;
    this.host = host;
    this.port = port;
  }
}

export class GenericChildIdentityCaptureError extends Error {
  readonly code = "child_identity_capture_failed" as const;
  readonly role: string;
  constructor(role: string, pid: number, options?: { cause?: unknown }) {
    super(`Could not capture OS identity for "${role}" child pid ${pid}`, options);
    this.name = "GenericChildIdentityCaptureError";
    this.role = role;
  }
}

export class GenericChildAlreadyStartedError extends Error {
  readonly code = "child_already_started" as const;
  readonly role: string;
  constructor(role: string) {
    super(`The supervisor already owns a running "${role}" child; stop() it before starting another`);
    this.name = "GenericChildAlreadyStartedError";
    this.role = role;
  }
}
