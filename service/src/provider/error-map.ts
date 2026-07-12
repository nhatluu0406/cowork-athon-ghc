/**
 * PR7 provider-error taxonomy, enforced at the execution boundary (CGHC-010/CGHC-020,
 * ADR 0005 §"PR7 error taxonomy"). This is the canonical status/code→kind mapping the port
 * exposes. CGHC-020 REFINES it additively: HTTP status mapping is unchanged, and Node socket
 * failures + fetch("TypeError: fetch failed") are now folded into the SAME five kinds (no new
 * {@link ProviderErrorKind} is added — network loss maps to `unavailable`, ETIMEDOUT to
 * `timeout`). The UI only FORMATS the returned {@link ProviderError}; it never invents error
 * semantics.
 *
 * Secret discipline (load-bearing, SEC-2): no secret value is EVER read from `raw` into the
 * mapped `message`/`recovery`. Only a status code / a well-known error `code` string are
 * inspected to pick a taxon; the returned strings are STATIC, non-secret constants. A raw
 * error whose body/headers embed a key never contributes any character to the mapped error.
 *
 * Retries are always BOUNDED — `retryable` here is only a HINT. The hard cap lives in
 * {@link import("./retry-policy.js").retryDecision}, not in this table.
 */

import type { ProviderError, ProviderErrorKind } from "@cowork-ghc/contracts";

interface Taxon {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly message: string;
  readonly recovery: string;
}

const AUTH: Taxon = {
  kind: "auth_invalid",
  retryable: false,
  message: "Authentication was rejected by the provider.",
  recovery: "Re-enter or replace the credential.",
};
const RATE: Taxon = {
  kind: "rate_limited",
  retryable: true,
  message: "The provider is rate-limiting requests.",
  recovery: "Wait and retry, reduce the request rate, or switch model.",
};
const TIMEOUT: Taxon = {
  kind: "timeout",
  retryable: true,
  message: "The provider did not respond within the time bound.",
  recovery: "Retry or cancel.",
};
const UNAVAILABLE: Taxon = {
  kind: "unavailable",
  retryable: true,
  message: "The provider is temporarily unavailable.",
  recovery: "Retry later or switch provider.",
};
// Same kind as UNAVAILABLE (no new taxonomy), but a distinct, more actionable recovery for a
// local network failure so the user checks connectivity rather than the provider status page.
const NETWORK: Taxon = {
  kind: "unavailable",
  retryable: true,
  message: "The request could not reach the provider (network error).",
  recovery: "Check your network connection and retry.",
};
const UNKNOWN: Taxon = {
  kind: "unknown",
  retryable: false,
  message: "The request failed for an unrecognized reason.",
  recovery: "Review the mapped message and cancel.",
};

/** Node socket/DNS failures that mean "could not reach the provider" → `unavailable`. */
const NETWORK_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ECONNRESET",
  "EAI_AGAIN",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);
/** Socket-level timeout → the `timeout` kind (not `unavailable`). */
const NETWORK_TIMEOUT_CODES: ReadonlySet<string> = new Set(["ETIMEDOUT"]);

/** Extract an HTTP-ish status from a mapped/raw error shape without reading secrets. */
function statusOf(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  for (const key of ["status", "statusCode"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  // `code` is only a status when numeric; a string `code` is a socket code (see codeOf).
  const code = record["code"];
  if (typeof code === "number" && Number.isInteger(code)) return code;
  return undefined;
}

/** Read a well-known STRING error code from `raw` or its `cause` (fetch wraps the real one). */
function codeOf(raw: unknown): string | undefined {
  const direct = stringCodeOf(raw);
  if (direct !== undefined) return direct;
  if (typeof raw === "object" && raw !== null && "cause" in raw) {
    return stringCodeOf((raw as { cause: unknown }).cause);
  }
  return undefined;
}

function stringCodeOf(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const code = (raw as Record<string, unknown>)["code"];
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function isTimeoutLike(raw: unknown): boolean {
  if (raw instanceof Error) {
    const name = raw.name.toLowerCase();
    return name.includes("abort") || name.includes("timeout");
  }
  return false;
}

/** `fetch()` surfaces a low-level socket failure as `TypeError: fetch failed`. */
function isFetchFailed(raw: unknown): boolean {
  return raw instanceof Error && raw.message.toLowerCase().includes("fetch failed");
}

/** Map any raw runtime/provider failure to the canonical taxonomy (PR7). */
export function mapProviderError(raw: unknown): ProviderError {
  const taxon = selectTaxon(raw);
  return {
    kind: taxon.kind,
    message: taxon.message,
    retryable: taxon.retryable,
    recovery: taxon.recovery,
  };
}

function selectTaxon(raw: unknown): Taxon {
  const status = statusOf(raw);
  if (status === 401 || status === 403) return AUTH;
  if (status === 429) return RATE;
  if (status === 408) return TIMEOUT;
  if (typeof status === "number" && status >= 500 && status <= 599) return UNAVAILABLE;

  const code = codeOf(raw);
  if (code !== undefined) {
    if (NETWORK_TIMEOUT_CODES.has(code)) return TIMEOUT;
    if (NETWORK_UNAVAILABLE_CODES.has(code)) return NETWORK;
  }

  if (isTimeoutLike(raw)) return TIMEOUT;
  // A bare `fetch failed` with no recognizable cause code still means unreachable.
  if (isFetchFailed(raw)) return NETWORK;
  return UNKNOWN;
}
