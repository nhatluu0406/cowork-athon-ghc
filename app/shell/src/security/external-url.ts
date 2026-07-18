/**
 * External-URL allowlist for the shell's `openExternal` bridge (PHASE 3, MS365 external link).
 *
 * The renderer cannot open `window.open`/`<a target=_blank>` (navigation is denied and no
 * generic bridge exists), so a "guide" link like Microsoft Graph Explorer was a dead no-op.
 * This gives the shell a NARROW, fail-closed capability: only `https://` URLs whose host is an
 * exact match or a subdomain of a small Microsoft-owned allowlist are ever handed to
 * `shell.openExternal`. Everything else (http, other schemes, arbitrary hosts, malformed URLs)
 * is refused — the renderer can never coerce the OS into opening an attacker-chosen link.
 */

/** Hosts (and their subdomains) the shell will open externally. Microsoft sign-in / docs only. */
const ALLOWED_HOST_SUFFIXES: readonly string[] = [
  "microsoft.com",
  "microsoftonline.com",
  "office.com",
  "office365.com",
  "sharepoint.com",
  "live.com",
  "azure.com",
];

export interface ExternalUrlDecision {
  readonly allowed: boolean;
  /** Non-secret reason when refused (for logging / an honest UI message). */
  readonly reason?: "not_https" | "invalid_url" | "host_not_allowed";
}

/** Normalize a host: strip a single trailing dot and surrounding brackets (IPv6 literal). */
function bareHost(host: string): string {
  let h = host.toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h;
}

/** True when `host` equals or is a subdomain of one of the allowlisted suffixes. */
function hostIsAllowed(host: string): boolean {
  const h = bareHost(host);
  return ALLOWED_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

/** Fail-closed decision: only https + an allowlisted Microsoft host may be opened externally. */
export function evaluateExternalUrl(raw: unknown): ExternalUrlDecision {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { allowed: false, reason: "invalid_url" };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { allowed: false, reason: "not_https" };
  if (!hostIsAllowed(url.hostname)) return { allowed: false, reason: "host_not_allowed" };
  return { allowed: true };
}
