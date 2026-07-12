/**
 * Typed failures for the LIVE OpenCode HTTP data adapters (CGHC-028 Wave A2).
 *
 * The SessionStore / RuntimeReply / ProviderConnector adapters talk to the supervised child
 * over loopback HTTP. Every failure maps to ONE of these typed errors so a caller never has to
 * pattern-match a raw string, and so a non-2xx surfaces as a rejection rather than a throw that
 * strands the boundary. Messages are secret-free by construction (they carry only the operation
 * name + numeric status — never a URL query, body, or key). A raw network `cause` may be
 * attached, but callers MUST route any log/error text through the shared scrubber first.
 */

/** A non-2xx HTTP response from the OpenCode child (the request reached the runtime). */
export class OpencodeHttpError extends Error {
  readonly code = "opencode_http_error" as const;
  readonly status: number;
  readonly operation: string;
  constructor(operation: string, status: number, options?: { cause?: unknown }) {
    super(`OpenCode ${operation} failed: HTTP ${status}`, options);
    this.name = "OpencodeHttpError";
    this.status = status;
    this.operation = operation;
  }
}

/** The OpenCode child could not be reached at all (socket refused, DNS, timeout/abort). */
export class OpencodeUnreachableError extends Error {
  readonly code = "opencode_unreachable" as const;
  readonly operation: string;
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`OpenCode ${operation} could not reach the runtime`, options);
    this.name = "OpencodeUnreachableError";
    this.operation = operation;
  }
}

/**
 * The adapter was called before the supervisor produced a `baseUrl` (not started, or already
 * stopped). Distinct from {@link OpencodeUnreachableError}: no request was even attempted.
 */
export class RuntimeNotReadyError extends Error {
  readonly code = "runtime_not_ready" as const;
  readonly operation: string;
  constructor(operation: string) {
    super(`OpenCode runtime is not ready; "${operation}" needs a started supervisor.`);
    this.name = "RuntimeNotReadyError";
    this.operation = operation;
  }
}
