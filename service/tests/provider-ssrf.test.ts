/**
 * SSRF release negative test (CGHC-010, ADR 0005 §"Custom endpoint SSRF policy";
 * security MED-2 / test HIGH-2). No real network call is made — an injected resolver and
 * connector are the only seams.
 *
 * Proves, in a simulated RELEASE build (loopbackEscape = false, the production default):
 *  - a custom base_url pointing at 169.254.169.254 / 10.x / 192.168.x / 127.x is REFUSED;
 *  - a hostname that RESOLVES to a private IP is refused (the resolved IP is validated, not
 *    the hostname) — and a rebinding from public→private between config and connect is
 *    caught by re-resolution at connect time (DNS-rebinding guard);
 *  - https is required (http is refused);
 *  - the test-mode escape CANNOT relax the production policy in a release build.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProviderPort,
  createSsrfPolicy,
  classifyIpv6,
  SsrfBlockedError,
  productionLoopbackEscape,
  resolveLoopbackEscape,
  ReleaseGuardrailError,
  CUSTOM_OPENAI_COMPAT_ID,
  type ConnectTarget,
  type DnsResolver,
  type IpClass,
  type ProviderConnector,
  type ResolvedAddress,
} from "../src/provider/index.js";

const one = (address: string, family: 4 | 6): readonly ResolvedAddress[] => [{ address, family }];
const staticResolver = (addr: string, family: 4 | 6 = 4): DnsResolver => async () => one(addr, family);

function connector(): ProviderConnector {
  return { probe: async (_id, _t: ConnectTarget | null) => ({ ok: true }), cancel: async () => {} };
}

function customPort(resolver: DnsResolver, loopbackEscape = false) {
  const ssrf = createSsrfPolicy({ resolver, loopbackEscape });
  return createProviderPort({ ssrf, connector: connector() });
}

// ---- Blocked vectors (production policy, loopbackEscape = false) ----------------

const BLOCKED_LITERALS: ReadonlyArray<[string, string]> = [
  ["cloud-metadata", "https://169.254.169.254/latest/meta-data/"],
  ["rfc1918 10/8", "https://10.0.0.5/v1"],
  ["rfc1918 172.16/12", "https://172.16.0.9/v1"],
  ["rfc1918 192.168/16", "https://192.168.1.1/v1"],
  ["loopback 127/8", "https://127.0.0.1/v1"],
  ["link-local 169.254/16", "https://169.254.10.20/v1"],
  ["ipv6 loopback ::1", "https://[::1]/v1"],
  ["ipv6 link-local", "https://[fe80::1]/v1"],
  ["ipv4-mapped loopback", "https://[::ffff:127.0.0.1]/v1"],
];

for (const [label, url] of BLOCKED_LITERALS) {
  test(`SSRF blocks ${label}: ${url}`, async () => {
    // Literal IPs need no DNS; resolver would not be called, but supply a safe one anyway.
    const port = customPort(staticResolver("93.184.216.34"));
    await assert.rejects(
      () => port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: url }),
      SsrfBlockedError,
    );
  });
}

// ---- F1: fail-safe IPv6-embedded-IPv4 forms (security review) ------------------

const EMBEDDED_IPV6: ReadonlyArray<[string, string, IpClass]> = [
  ["ipv4-compat metadata", "::a9fe:a9fe", "cloud_metadata"],
  ["NAT64 64:ff9b::/96 metadata", "64:ff9b::a9fe:a9fe", "cloud_metadata"],
  ["ipv4-translated metadata", "::ffff:0:a9fe:a9fe", "cloud_metadata"],
  ["ipv4-compat RFC-1918 10.1.2.3", "::a01:203", "private"],
];

for (const [label, ip, expected] of EMBEDDED_IPV6) {
  test(`F1 classifies ${label} (${ip}) as ${expected}, not public`, () => {
    assert.equal(classifyIpv6(ip), expected);
  });

  test(`F1 evaluate() REFUSES the embedded form ${ip}`, async () => {
    // Literal IP → resolver is never consulted; poison it to prove that.
    const port = customPort(async () => {
      throw new Error("resolver must not be called for an IP literal");
    });
    await assert.rejects(
      () => port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: `https://[${ip}]/v1` }),
      (err: unknown) => err instanceof SsrfBlockedError && err.reason === expected,
    );
  });
}

test("F1 control: a genuine public IPv6 (Cloudflare) is still allowed (no over-block)", () => {
  assert.equal(classifyIpv6("2606:4700:4700::1111"), "public");
});

test("SSRF blocks a hostname that RESOLVES to a private IP (resolved IP is validated)", async () => {
  const port = customPort(staticResolver("10.0.0.7")); // evil.example → 10.0.0.7
  await assert.rejects(
    () => port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://evil.example/v1" }),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "private",
  );
});

test("SSRF blocks a hostname resolving to cloud-metadata", async () => {
  const port = customPort(staticResolver("169.254.169.254"));
  await assert.rejects(
    () => port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://sneaky.example/v1" }),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "cloud_metadata",
  );
});

test("SSRF requires https — http to a public host is refused", async () => {
  const port = customPort(staticResolver("93.184.216.34"));
  await assert.rejects(
    () => port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "http://api.example.com/v1" }),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "scheme_not_https",
  );
});

test("SSRF allows a genuinely public https host", async () => {
  const port = customPort(staticResolver("93.184.216.34"));
  await port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://api.example.com/v1" });
  assert.equal(port.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID), "https://api.example.com/v1");
});

// ---- DNS-rebinding guard: re-resolve at CONNECT time ---------------------------

test("DNS-rebinding guard: a host that flips public→private after config is caught at connect", async () => {
  // First resolution (config time) returns public; later resolutions (connect time) flip
  // to a private IP — the classic rebinding attack.
  let calls = 0;
  const rebinding: DnsResolver = async () => {
    calls += 1;
    return calls <= 1 ? one("93.184.216.34", 4) : one("10.1.2.3", 4);
  };
  const port = customPort(rebinding);

  // Config passes (public answer).
  await port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://rebind.example/v1" });

  // Connect RE-RESOLVES and now sees the private IP → refused; `connect` never runs.
  let connectRan = false;
  await assert.rejects(
    () =>
      port.guardedConnect(CUSTOM_OPENAI_COMPAT_ID, async () => {
        connectRan = true;
      }),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "private",
  );
  assert.equal(connectRan, false, "connect must not run when the re-resolved IP is private");
  assert.ok(calls >= 2, "the resolver must be called again at connect time");
});

test("guardedConnect passes the validated target for a still-public custom endpoint", async () => {
  const port = customPort(staticResolver("93.184.216.34"));
  await port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://api.example.com/v1" });
  let target: ConnectTarget | null = null;
  await port.guardedConnect(CUSTOM_OPENAI_COMPAT_ID, async (t) => {
    target = t;
  });
  assert.ok(target, "a validated ConnectTarget is provided");
  assert.equal((target as ConnectTarget).url.hostname, "api.example.com");
});

// ---- Release guardrail: the test-mode escape can't relax prod policy ------------

test("RELEASE build: the loopback escape flag is refused (hard-assert, refuse to start)", () => {
  assert.throws(
    () => resolveLoopbackEscape({ buildProfile: "release", launchFlag: true }),
    ReleaseGuardrailError,
  );
});

test("RELEASE build: productionLoopbackEscape(true) throws — BUILD_PROFILE is 'release'", () => {
  // The build-time constant is 'release' here; forcing the flag on refuses to start.
  assert.throws(() => productionLoopbackEscape(true), ReleaseGuardrailError);
  // With the flag off it is simply inactive (no throw, returns false).
  assert.equal(productionLoopbackEscape(false), false);
});

test("RELEASE policy (escape off) still blocks loopback even if a caller wants it relaxed", async () => {
  // Simulate what a release build yields: loopbackEscape resolves to false, so the policy
  // refuses loopback. The renderer/body has no way to change this (router ignores such a field).
  const escape = resolveLoopbackEscape({ buildProfile: "release", launchFlag: false });
  assert.equal(escape, false);
  const port = customPort(staticResolver("127.0.0.1"), escape);
  await assert.rejects(
    () => port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://localhost.example/v1" }),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "loopback",
  );
});

test("TEST-MODE (development) escape relaxes ONLY loopback — private/metadata stay blocked", async () => {
  let warned = false;
  let audited = false;
  const escape = resolveLoopbackEscape({
    buildProfile: "development",
    launchFlag: true,
    warn: () => {
      warned = true;
    },
    audit: () => {
      audited = true;
    },
  });
  assert.equal(escape, true);
  assert.ok(warned, "a WARN banner is emitted when active");
  assert.ok(audited, "a local audit event is emitted when active");

  // Loopback over https is now allowed (a local mock endpoint).
  const loopPort = customPort(staticResolver("127.0.0.1"), escape);
  await loopPort.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://localhost.mock/v1" });
  assert.ok(loopPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID));

  // http is allowed ONLY on loopback under the escape.
  const httpPort = customPort(staticResolver("127.0.0.1"), escape);
  await httpPort.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "http://localhost.mock/v1" });

  // But RFC-1918 and cloud-metadata are STILL blocked even in test mode.
  const privPort = customPort(staticResolver("10.0.0.9"), escape);
  await assert.rejects(
    () => privPort.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://x.mock/v1" }),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "private",
  );
  const metaPort = customPort(staticResolver("169.254.169.254"), escape);
  await assert.rejects(
    () => metaPort.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://y.mock/v1" }),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "cloud_metadata",
  );
});
