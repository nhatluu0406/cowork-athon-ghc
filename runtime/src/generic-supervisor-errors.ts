/**
 * Error types for GenericChildSupervisor.
 *
 * NOTE: D3 Knowledge integration is PARTIAL (not merge-ready). This module
 * is a stub implementation for compilation; full functionality pending.
 */

/**
 * Error thrown when a child process that should already be started is attempted to be started again.
 */
export class GenericChildAlreadyStartedError extends Error {
  readonly code = "child_already_started" as const;

  constructor(childName: string, options?: { cause?: unknown }) {
    super(`Child process "${childName}" is already running`, options);
    this.name = "GenericChildAlreadyStartedError";
  }
}

/**
 * Error thrown when a child process fails to start.
 */
export class GenericChildStartError extends Error {
  readonly code = "child_start_failed" as const;

  constructor(childName: string, reason: string, options?: { cause?: unknown }) {
    super(`Failed to start child process "${childName}": ${reason}`, options);
    this.name = "GenericChildStartError";
  }
}

/**
 * Error thrown when a child process fails to stop gracefully and must be force-killed.
 */
export class GenericChildStopError extends Error {
  readonly code = "child_stop_failed" as const;

  constructor(childName: string, reason: string, options?: { cause?: unknown }) {
    super(`Failed to stop child process "${childName}": ${reason}`, options);
    this.name = "GenericChildStopError";
  }
}

/**
 * Error thrown when a readiness probe times out.
 */
export class GenericReadinessTimeoutError extends Error {
  readonly code = "readiness_timeout" as const;

  constructor(probeName: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(`Readiness probe "${probeName}" timed out after ${timeoutMs}ms`, options);
    this.name = "GenericReadinessTimeoutError";
  }
}
