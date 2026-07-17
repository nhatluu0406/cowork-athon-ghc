/**
 * IP address classification for the outbound SSRF policy (CGHC-010, ADR 0005 §"Custom
 * endpoint SSRF policy"). Pure, dependency-light: given a numeric IP literal it returns
 * a category the policy uses to allow or block a custom `base_url` connect target.
 *
 * The categories map 1:1 to the ADR block list: loopback (127/8, ::1), link-local
 * (169.254/16, fe80::/10), RFC-1918 private (10/8, 172.16/12, 192.168/16, IPv6 ULA
 * fc00::/7) and cloud-metadata (169.254.169.254, fd00:ec2::254 → ULA). Anything else is
 * `public`. Unspecified/broadcast/CGNAT are treated as `private` (defense in depth).
 *
 * IPv6 is FAIL-SAFE (security review F1): every IPv4-embedding representation is decoded
 * and re-classified through the IPv4 classifier — IPv4-mapped `::ffff:a.b.c.d`,
 * IPv4-translated `::ffff:0:a.b.c.d`, deprecated IPv4-compat `::a.b.c.d` / `::x`, and NAT64
 * `64:ff9b::/96` — so `::a9fe:a9fe` (metadata) or `::a01:203` (RFC-1918) can never slip
 * through as `public`. A backstop also blocks any address whose low-32 bits fall in a
 * hostile IPv4 range (excluding 0.0.0.0/8, which collides with common global-unicast
 * addresses ending in `::x`). This module never resolves DNS.
 */

import net from "node:net";

/** Category of a resolved IP address, ordered from most to least sensitive. */
export type IpClass = "loopback" | "cloud_metadata" | "link_local" | "private" | "public";

/** IPv4 cloud-metadata address (AWS/GCP/Azure IMDS). */
const IPV4_METADATA = "169.254.169.254";

type V6 = [number, number, number, number, number, number, number, number];

function ipv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/** Classify a dotted-quad IPv4 literal. */
export function classifyIpv4(ip: string): IpClass {
  if (ip === IPV4_METADATA) return "cloud_metadata";
  const octets = ipv4Octets(ip);
  if (octets === null) return "private"; // unparseable → fail safe (block)
  const [a, b] = octets;
  if (a === 127) return "loopback"; // 127.0.0.0/8
  if (a === 169 && b === 254) return "link_local"; // 169.254.0.0/16
  if (a === 10) return "private"; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return "private"; // 172.16.0.0/12
  if (a === 192 && b === 168) return "private"; // 192.168.0.0/16
  if (a === 0) return "private"; // 0.0.0.0/8 "this host"
  if (a === 100 && b >= 64 && b <= 127) return "private"; // 100.64.0.0/10 CGNAT
  return "public";
}

/** Expand any IPv6 literal (incl. `::`, zone id, trailing dotted quad) to 8 hextets. */
function expandIpv6(input: string): V6 | null {
  let s = input.split("%")[0] ?? ""; // drop any zone id
  // Fold a trailing embedded dotted quad (e.g. `::ffff:1.2.3.4`) into two hextets.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const oct = ipv4Octets(tail);
    if (oct === null) return null;
    const hi = (oct[0] << 8) | oct[1];
    const lo = (oct[2] << 8) | oct[3];
    s = `${s.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = (halves[0] ?? "") === "" ? [] : (halves[0] as string).split(":");
  const hasGap = halves.length === 2;
  const tailGroups = hasGap ? ((halves[1] ?? "") === "" ? [] : (halves[1] as string).split(":")) : [];
  let groups: string[];
  if (!hasGap) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - tailGroups.length;
    if (missing < 1) return null; // `::` must stand for at least one zero group
    groups = [...head, ...Array<string>(missing).fill("0"), ...tailGroups];
  }
  if (groups.length !== 8) return null;
  const nums: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    nums.push(Number.parseInt(g, 16));
  }
  return nums as V6;
}

/** The low-32 bits of an expanded IPv6 rendered as a dotted-quad IPv4. */
function low32AsIpv4(h: V6): string {
  return `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
}

/** Extract the embedded IPv4 from a recognized IPv4-in-IPv6 form, else null. */
function embeddedIpv4(h: V6): string | null {
  const zeroHi = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0;
  // IPv4-mapped `::ffff:a.b.c.d` (h5 = 0xffff).
  if (zeroHi && h[4] === 0 && h[5] === 0xffff) return low32AsIpv4(h);
  // IPv4-translated `::ffff:0:a.b.c.d` (h4 = 0xffff, h5 = 0).
  if (zeroHi && h[4] === 0xffff && h[5] === 0) return low32AsIpv4(h);
  // Deprecated IPv4-compatible `::a.b.c.d` / `::x` (all high groups zero, not ::/::1).
  if (zeroHi && h[4] === 0 && h[5] === 0 && !(h[6] === 0 && (h[7] === 0 || h[7] === 1))) {
    return low32AsIpv4(h);
  }
  // NAT64 well-known prefix `64:ff9b::/96`.
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return low32AsIpv4(h);
  }
  return null;
}

/** Classify an IPv6 literal (fail-safe against every IPv4-embedding form). */
export function classifyIpv6(ip: string): IpClass {
  const h = expandIpv6(ip.toLowerCase());
  if (h === null) return "private"; // unparseable → fail safe
  if (h.every((x) => x === 0)) return "private"; // :: unspecified
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return "loopback"; // ::1
  // 1) Any recognized IPv4-embedding form → re-classify the embedded IPv4.
  const embedded = embeddedIpv4(h);
  if (embedded !== null) return classifyIpv4(embedded);
  // 2) Native IPv6 special prefixes.
  if ((h[0] & 0xffc0) === 0xfe80) return "link_local"; // fe80::/10
  if ((h[0] & 0xfe00) === 0xfc00) return "private"; // fc00::/7 ULA (incl. fd00:ec2::254)
  // 3) Backstop: low-32 bits in a hostile IPv4 range (skip 0.0.0.0/8 — it collides with
  //    ordinary global-unicast addresses ending in `::x`).
  if ((h[6] >> 8) !== 0) {
    const low = classifyIpv4(low32AsIpv4(h));
    if (low !== "public") return low;
  }
  return "public";
}

/** Classify any IP literal. A non-IP input is treated as `private` (fail safe). */
export function classifyIp(ip: string): IpClass {
  const family = net.isIP(ip);
  if (family === 4) return classifyIpv4(ip);
  if (family === 6) return classifyIpv6(ip);
  return "private";
}

/** True when a class must never be reached over the network in production. */
export function isBlockedClass(cls: IpClass): boolean {
  return cls !== "public";
}
