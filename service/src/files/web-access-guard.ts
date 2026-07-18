/**
 * Synchronous pre-gate guard for agent web access (OpenCode webfetch/websearch, #29).
 *
 * The real defense for arbitrary agent web access is the permission card: `web_access` is
 * classified `elevated`, so every fetch surfaces the target URL for explicit human approval even
 * in workspace-auto mode. This guard is defense-in-depth: it refuses obviously-internal targets
 * (loopback/private/link-local/cloud-metadata literal IPs, plus `localhost` and the well-known
 * metadata hostnames) BEFORE the request ever reaches the gate, so a user cannot be tricked into
 * approving an SSRF probe of an internal address and the card only ever shows a plausibly-public
 * URL.
 *
 * Full DNS-rebinding protection is out of scope here: the OpenCode child performs the actual
 * fetch, so the service cannot pin the resolved IP. We block what is statically knowable (literal
 * IPs + known internal hostnames) and require https; anything else is surfaced to the human.
 */

import net from "node:net";
import { classifyIp } from "../provider/ip-classify.js";

export type WebAccessBlockReason =
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
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1);
  return hostname;
}

/**
 * Evaluate an agent-supplied URL. `websearch` may pass a bare query rather than a URL; a query
 * with no scheme is treated as `allowed` (there is no host to probe — the card still gates it).
 */
export function evaluateWebAccess(raw: string): WebAccessDecision {
  const trimmed = raw.trim();
  // A bare search query (no scheme/host) is not a fetch target — allow it through to the card.
  if (trimmed.length === 0 || !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    // Not a URL: nothing to SSRF-probe. Represent it as a harmless https URL for the card.
    return { allowed: true, url: new URL("https://websearch.query/") };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { allowed: false, reason: "scheme_not_https" };
  }
  // http is only ever internal-plaintext; require https for real web fetches.
  if (url.protocol !== "https:") {
    return { allowed: false, reason: "scheme_not_https" };
  }
  const host = bareHost(url.hostname).toLowerCase();
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
