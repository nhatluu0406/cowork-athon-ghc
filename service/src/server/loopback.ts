/**
 * Loopback-only bind enforcement (P7, ADR 0003).
 *
 * The service binds explicitly to `127.0.0.1` and/or `::1`, NEVER `0.0.0.0` (or any
 * other interface). This module is the single place that decides what counts as a
 * loopback address, used both to validate the configured bind host and to refuse a
 * connection that somehow arrives from a non-loopback peer (defense in depth).
 */

export const LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;
export type LoopbackHost = (typeof LOOPBACK_HOSTS)[number];

/** Raised when a non-loopback bind host is configured (never bind `0.0.0.0`). */
export class LoopbackBindError extends Error {
  readonly code = "non_loopback_bind";
  constructor(host: string) {
    super(
      `Refusing to bind non-loopback host "${host}"; the local service binds ` +
        `${LOOPBACK_HOSTS.join(" or ")} only (P7, ADR 0003).`,
    );
    this.name = "LoopbackBindError";
  }
}

/**
 * True iff `address` is an IPv4 (127.0.0.0/8) or IPv6 (`::1`) loopback address,
 * including IPv4-mapped IPv6 forms (`::ffff:127.0.0.1`).
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  let addr = address.trim().toLowerCase();
  // Strip zone id (e.g. "::1%lo0") and IPv4-mapped IPv6 prefix.
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  if (addr.startsWith("::ffff:")) addr = addr.slice("::ffff:".length);
  if (addr === "::1" || addr === "0:0:0:0:0:0:0:1") return true;
  const parts = addr.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return parts[0] === "127";
}

/**
 * Validate a configured bind host. Returns the canonical loopback host on success and
 * throws {@link LoopbackBindError} for `0.0.0.0`, `::`, a LAN IP, or anything else.
 * `0.0.0.0`/`::` are wildcard binds and are explicitly rejected here.
 */
export function assertLoopbackHost(host: string): LoopbackHost {
  const normalized = host.trim().toLowerCase();
  if (normalized === "127.0.0.1" || normalized === "localhost") return "127.0.0.1";
  if (normalized === "::1") return "::1";
  throw new LoopbackBindError(host);
}

/**
 * Whether an inbound connection from `remoteAddress` should be accepted. Used by the
 * server's `connection` handler to destroy any socket that is not from loopback, even
 * though the OS-level bind already restricts the listening interface.
 */
export function shouldAcceptConnection(remoteAddress: string | undefined): boolean {
  return isLoopbackAddress(remoteAddress);
}

/** Host names accepted in the `Host` header (DNS-rebinding defense-in-depth). */
const ALLOWED_HOST_NAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Validate an incoming `Host` header against the bound loopback authority. Rejects any
 * foreign host name (blocking DNS-rebinding) and any mismatched port. A `Host` with no
 * explicit port is accepted iff the name is loopback (the port default is the bound one).
 */
export function isAllowedHostHeader(hostHeader: string | undefined, boundPort: number): boolean {
  if (hostHeader === undefined) return false;
  let host = hostHeader.trim().toLowerCase();
  let port: string | undefined;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return false;
    const rest = host.slice(end + 1);
    if (rest.startsWith(":")) port = rest.slice(1);
    else if (rest.length > 0) return false;
    host = host.slice(1, end);
  } else {
    const colon = host.lastIndexOf(":");
    if (colon !== -1) {
      port = host.slice(colon + 1);
      host = host.slice(0, colon);
    }
  }
  if (!ALLOWED_HOST_NAMES.has(host)) return false;
  if (port !== undefined && port !== String(boundPort)) return false;
  return true;
}
