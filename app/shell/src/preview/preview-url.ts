/**
 * Pure loopback-URL policy for the embedded preview surface. Kept electron-free so it can be
 * unit-tested without launching electron, and imported by {@link ./preview-view.ts}.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True only for an `http(s)` URL whose host is a loopback address. */
export function isLoopbackHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}
