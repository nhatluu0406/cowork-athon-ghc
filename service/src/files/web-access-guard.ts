/**
 * Synchronous pre-gate guard for agent web FETCH targets (OpenCode webfetch, #29).
 *
 * The real defense for arbitrary agent web access is the permission card: `web_access` is
 * classified `elevated`, so every request surfaces its target for explicit human approval even in
 * workspace-auto mode. This guard is defense-in-depth for a `webfetch` URL: it refuses
 * obviously-internal targets (loopback/private/link-local/cloud-metadata literal IPs, plus
 * `localhost`/metadata hostnames) BEFORE the request reaches the gate, so a user can never be
 * tricked into approving an SSRF probe and the card only shows a plausibly-public https URL.
 *
 * This function is FETCH-STRICT and fail-closed: a missing, schemeless, non-https, or unparseable
 * target is REFUSED (never defaulted to allowed). A `websearch` query is NOT a fetch target (no
 * host to probe) and is handled by the caller, not here.
 *
 * Full DNS-rebinding protection is out of scope: the OpenCode child performs the actual fetch, so
 * the service cannot pin the resolved IP. We block what is statically knowable and require https;
 * anything else is surfaced to the human.
 */

import net from "node:net";
import { classifyIp } from "../provider/ip-classify.js";

export type WebAccessBlockReason =
  | "missing_target"
  | "invalid_url"
  | "scheme_not_https"
  | "loopback"
  | "private"
  | "link_local"
  | "cloud_metadata"
  | "internal_hostname";

export type WebAccessDecision =
  | { readonly allowed: true; readonly url: URL }
  | { readonly allowed: false; readonly reason: WebAccessBlockReason };

/** Hostnames that always resolve to an internal/loopback address — refused without DNS. */
const INTERNAL_HOSTNAMES = new Set<string>([
  "localhost",
  "metadata.google.internal", // GCP IMDS
  "metadata", // common short alias
]);

function bareHost(hostname: string): string {
  let host = hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  // Strip a single trailing FQDN dot ("localhost." resolves like "localhost") so it cannot bypass
  // the static internal-hostname blocklist. IP literals are already canonicalized by the URL parser.
  return host.replace(/\.$/u, "");
}

/**
 * Evaluate a `webfetch` URL target. Fail-closed: empty/schemeless/non-https/unparseable → blocked.
 */
export function evaluateWebAccess(raw: string): WebAccessDecision {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { allowed: false, reason: "missing_target" };
  // A fetch target MUST carry an explicit scheme. A schemeless string ("127.0.0.1/x", free text)
  // is refused rather than guessed — guessing risks bypassing the IP/host classification below.
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
    return { allowed: false, reason: "scheme_not_https" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") {
    // http is only ever internal-plaintext; require https for real web fetches.
    return { allowed: false, reason: "scheme_not_https" };
  }
  const host = bareHost(url.hostname).toLowerCase();
  if (host.length === 0) return { allowed: false, reason: "invalid_url" };
  if (INTERNAL_HOSTNAMES.has(host)) {
    return { allowed: false, reason: "internal_hostname" };
  }
  if (net.isIP(host) !== 0) {
    const cls = classifyIp(host);
    switch (cls) {
      case "loopback":
        return { allowed: false, reason: "loopback" };
      case "private":
        return { allowed: false, reason: "private" };
      case "link_local":
        return { allowed: false, reason: "link_local" };
      case "cloud_metadata":
        return { allowed: false, reason: "cloud_metadata" };
      case "public":
        return { allowed: true, url };
    }
  }
  return { allowed: true, url };
}
