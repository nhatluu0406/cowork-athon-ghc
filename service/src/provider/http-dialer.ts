/**
 * The bounded HTTP dial seam for the connection probe (CGHC-011, PR3). This is the ONLY
 * file in the provider unit that opens a socket; every test injects a fake {@link HttpDialer}
 * so the default suite never touches the live network (testing policy: no live LLM calls).
 *
 * SOCKET-IP PINNING (CGHC-010 review HIGH F2). The real dialer NEVER lets Node/undici
 * re-resolve the hostname at connect time — that would defeat the SSRF DNS-rebinding guard,
 * because the port validates the IP the policy resolved but the socket could dial a freshly
 * re-resolved (attacker-flipped) private IP. Instead it forces a custom `lookup` that returns
 * ONLY the already-validated IP the connector pins, while preserving TLS SNI + the `Host`
 * header as the ORIGINAL hostname. It reports back `dialedIp` (`socket.remoteAddress`) so the
 * connector can assert the socket used the exact validated IP.
 *
 * Redirects are NOT auto-followed here (`maxRedirects` is effectively 0): a 3xx is returned
 * verbatim so the connector can re-run the SSRF guard on the `Location` before following
 * (F3). The dialer times out a slow connection (bounded; no infinite wait, no retry).
 */

import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

/** A single bounded probe request. `ip`/`family` are the ALREADY-VALIDATED pin (F2). */
export interface HttpProbeRequest {
  /** The full probe URL (its hostname drives SNI + the `Host` header). */
  readonly url: URL;
  /** The exact validated IP the socket MUST dial (no re-resolution). */
  readonly ip: string;
  readonly family: 4 | 6;
  /** Request headers (auth header included). Never logged by the dialer. */
  readonly headers: Readonly<Record<string, string>>;
  /** Hard upper bound on the request; on expiry the dial fails with a timeout error. */
  readonly timeoutMs: number;
  /** HTTP method. Defaults to GET. */
  readonly method?: "GET" | "POST";
  /** Optional request body (POST probes). */
  readonly body?: string;
}

/** A probe response. Carries the status, headers, and the IP the socket ACTUALLY used. */
export interface HttpProbeResponse {
  readonly status: number;
  /** Lower-cased response headers (at least `location` on a 3xx). No request secret echoed. */
  readonly headers: Readonly<Record<string, string>>;
  /** `socket.remoteAddress` — the exact IP the socket connected to (F2 assertion input). */
  readonly dialedIp: string;
}

/** The injected dial seam. Production uses {@link createHttpsDialer}; tests inject a fake. */
export type HttpDialer = (req: HttpProbeRequest) => Promise<HttpProbeResponse>;

/** A bounded-timeout failure. Named so {@link mapProviderError} maps it to a PR7 timeout. */
export class ProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Connection probe timed out after ${timeoutMs}ms.`);
    this.name = "ProbeTimeoutError";
  }
}

/** Strip an IPv4-mapped IPv6 prefix so a dialed IP compares equal to the validated literal. */
function normalizeIp(address: string): string {
  const lower = address.toLowerCase();
  return lower.startsWith("::ffff:") && lower.includes(".") ? lower.slice("::ffff:".length) : lower;
}

function lowerCaseHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
    else if (Array.isArray(value)) out[key.toLowerCase()] = value.join(", ");
  }
  return out;
}

/**
 * The production dialer. Pins the socket to `req.ip` via a custom `lookup`, preserves SNI +
 * `Host` = the original hostname, refuses to auto-follow redirects, and bounds the request.
 */
export function createHttpsDialer(): HttpDialer {
  return (req: HttpProbeRequest): Promise<HttpProbeResponse> =>
    new Promise<HttpProbeResponse>((resolve, reject) => {
      const isHttps = req.url.protocol === "https:";
      const lib = isHttps ? https : http;
      // F2: ALWAYS return the pinned, validated IP — never let Node re-resolve via DNS.
      const lookup: LookupFunction = (_hostname, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        const opts = typeof options === "object" && options !== null ? options : {};
        if (opts.all === true) {
          cb(null, [{ address: req.ip, family: req.family }]);
          return;
        }
        cb(null, req.ip, req.family);
      };
      const method = req.method ?? "GET";
      const request = lib.request(
        {
          method,
          protocol: req.url.protocol,
          hostname: req.url.hostname,
          port: req.url.port || (isHttps ? 443 : 80),
          path: `${req.url.pathname}${req.url.search}`,
          headers: {
            ...req.headers,
            host: req.url.host,
            ...(req.body !== undefined ? { "content-length": String(Buffer.byteLength(req.body)) } : {}),
          },
          servername: isHttps ? req.url.hostname : undefined, // SNI = original hostname
          lookup,
          timeout: req.timeoutMs,
        },
        (res) => {
          const dialedIp = normalizeIp(res.socket.remoteAddress ?? "");
          res.resume(); // drain the body — the probe reads only status + headers
          resolve({ status: res.statusCode ?? 0, headers: lowerCaseHeaders(res.headers), dialedIp });
        },
      );
      request.on("timeout", () => request.destroy(new ProbeTimeoutError(req.timeoutMs)));
      request.on("error", reject);
      if (req.body !== undefined) request.write(req.body);
      request.end();
    });
}
