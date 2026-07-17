/**
 * OpenAI-compatible model discovery (Wave 3, feature/provider-model-discovery).
 *
 * All tests inject a FAKE {@link HttpDialer} — no live network, no live LLM call. They prove:
 *  1. standard list: `data[].id` is parsed, de-duplicated, and sorted;
 *  2. unsupported endpoint (404/405): a non-blocking mapped error, no models;
 *  3. timeout: a bounded timeout maps to a non-blocking error;
 *  4. malformed response: a non-list body maps to a non-blocking error;
 *  5. secret redaction: the key never surfaces in the result (only in the auth header);
 *  6. cache invalidation: results cache per (base_url · credential revision) and re-probe
 *     after an endpoint OR key change.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_OPENAI_COMPAT_ID,
  createModelDiscovery,
  createSsrfPolicy,
  parseModelList,
  ProbeTimeoutError,
  providerEnvSpec,
  SocketPinViolationError,
  type DnsResolver,
  type HttpDialer,
  type HttpProbeRequest,
  type HttpProbeResponse,
  type ResolvedAddress,
} from "../src/provider/index.js";
import { createProfileModelDiscovery } from "../src/provider-profiles/index.js";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";
import type { ProviderProfile } from "../src/provider-profiles/types.js";

const PUBLIC_IP = "93.184.216.34";
const one = (address: string, family: 4 | 6 = 4): readonly ResolvedAddress[] => [{ address, family }];
const staticResolver = (address: string): DnsResolver => async () => one(address);

const LIST_BODY = JSON.stringify({
  object: "list",
  data: [
    { id: "deepseek-reasoner" },
    { id: "deepseek-chat" },
    { id: "deepseek-chat" }, // duplicate → collapsed
    { id: "  " }, // blank → dropped
    { notId: true }, // non-id entry → skipped
  ],
});

function fakeDialer(
  respond: (req: HttpProbeRequest) => HttpProbeResponse | Promise<HttpProbeResponse>,
): HttpDialer & { calls: HttpProbeRequest[] } {
  const calls: HttpProbeRequest[] = [];
  const dialer = (async (req: HttpProbeRequest): Promise<HttpProbeResponse> => {
    calls.push(req);
    return respond(req);
  }) as HttpDialer & { calls: HttpProbeRequest[] };
  dialer.calls = calls;
  return dialer;
}

const respondWith =
  (status: number, bodyText?: string) =>
  (req: HttpProbeRequest): HttpProbeResponse => ({
    status,
    headers: {},
    dialedIp: req.ip,
    ...(bodyText !== undefined ? { bodyText } : {}),
  });

async function lowLevel(dialer: HttpDialer, secret = "sk-discovery-DO-NOT-LEAK-abc123def456") {
  const credentials = createCredentialService({ store: createMemoryStore() });
  const ref = await credentials.store({ providerId: CUSTOM_OPENAI_COMPAT_ID, secret, account: "profile:p1" });
  const ssrf = createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) });
  const discovery = createModelDiscovery({ ssrf, credentials, dialer });
  return {
    credentials,
    secret,
    discover: () =>
      discovery.discover({
        baseUrl: "https://api.deepseek.com/v1",
        credentialRef: ref,
        envSpec: providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, "CUSTOM_OPENAI_COMPAT_API_KEY"),
      }),
  };
}

// ---- 1. Standard list: parsed, de-duplicated, sorted ---------------------------------

test("standard model list → sorted, de-duplicated ids", async () => {
  const dialer = fakeDialer(respondWith(200, LIST_BODY));
  const h = await lowLevel(dialer);
  const result = await h.discover();
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ["deepseek-chat", "deepseek-reasoner"]);
  // The probe hit `{base}/models` with a bearer header (the ONLY place the key appears).
  assert.match(dialer.calls[0]!.url.pathname, /\/v1\/models$/u);
  assert.equal(dialer.calls[0]!.headers["authorization"], `Bearer ${h.secret}`);
});

test("parseModelList returns null for a non-list shape", () => {
  assert.equal(parseModelList(JSON.stringify({ foo: 1 })), null);
  assert.equal(parseModelList("not json"), null);
  assert.equal(parseModelList(undefined), null);
  assert.deepEqual(parseModelList(JSON.stringify({ data: [] })), []);
});

// ---- 2. Unsupported endpoint fallback (404 / 405) ------------------------------------

test("unsupported endpoint (404) → non-blocking error, no models", async () => {
  const h = await lowLevel(fakeDialer(respondWith(404, "not found")));
  const result = await h.discover();
  assert.equal(result.ok, false);
  assert.equal(result.models, undefined);
  assert.ok(result.error);
});

test("method-not-allowed (405) → non-blocking error", async () => {
  const h = await lowLevel(fakeDialer(respondWith(405)));
  const result = await h.discover();
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

// ---- 3. Timeout ----------------------------------------------------------------------

test("timeout → non-blocking timeout error", async () => {
  const dialer = fakeDialer(() => {
    throw new ProbeTimeoutError(8_000);
  });
  const h = await lowLevel(dialer);
  const result = await h.discover();
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "timeout");
});

// ---- 4. Malformed response -----------------------------------------------------------

test("malformed body (200 but not a list) → non-blocking error", async () => {
  const h = await lowLevel(fakeDialer(respondWith(200, "<html>not json</html>")));
  const result = await h.discover();
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

// ---- 5. Secret redaction -------------------------------------------------------------

test("the credential never appears in the result (only in the auth header)", async () => {
  const dialer = fakeDialer(respondWith(200, LIST_BODY));
  const h = await lowLevel(dialer);
  const result = await h.discover();
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(h.secret), false);
  assert.equal(h.credentials.scrubber.containsSecret(serialized), false);
});

// ---- 6. Cache invalidation after endpoint / key change ------------------------------

function profileFixture(partial?: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: "p1",
    displayName: "Local",
    providerType: "custom-openai-compat",
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    envVar: "CUSTOM_OPENAI_COMPAT_API_KEY",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    credentialRef: { store: "os", account: "profile:p1" },
    credentialRevision: 1,
    ...partial,
  };
}

test("profile discovery caches per target and re-probes after endpoint/key change", async () => {
  const dialer = fakeDialer(respondWith(200, LIST_BODY));
  const credentials = createCredentialService({ store: createMemoryStore() });
  await credentials.store({ providerId: CUSTOM_OPENAI_COMPAT_ID, secret: "sk-cache-abc123def456789", account: "profile:p1" });
  let clock = 1_000;
  const discovery = createProfileModelDiscovery({
    credentials,
    dnsResolver: staticResolver(PUBLIC_IP),
    dialer,
    now: () => clock,
    cacheTtlMs: 60_000,
  });
  const base = profileFixture();

  const first = await discovery.discoverForProfile(base);
  assert.equal(first.ok, true);
  assert.equal(dialer.calls.length, 1);

  // Same target within TTL → cache hit, no new dial.
  await discovery.discoverForProfile(base);
  assert.equal(dialer.calls.length, 1);

  // Endpoint change (in-form override) → cache miss.
  await discovery.discoverForProfile(base, { baseUrlOverride: "https://api.deepseek.com/v2" });
  assert.equal(dialer.calls.length, 2);

  // Key rotation (credentialRevision bump) → cache miss.
  await discovery.discoverForProfile(profileFixture({ credentialRevision: 2 }));
  assert.equal(dialer.calls.length, 3);

  // TTL expiry → cache miss for the original target.
  clock += 60_001;
  await discovery.discoverForProfile(base);
  assert.equal(dialer.calls.length, 4);
});

// ---- 7. Dual-stack IP-pinned Happy-Eyeballs fallback (the FPT Cloud symptom) ----------

const DUAL_STACK: DnsResolver = async () => [
  { address: "2606:4700:10::ac42:aa78", family: 6 }, // dead IPv6 (no egress on many machines)
  { address: "104.20.28.61", family: 4 }, // working IPv4
];

async function dualStackDiscover(dialer: HttpDialer) {
  const credentials = createCredentialService({ store: createMemoryStore() });
  const ref = await credentials.store({
    providerId: CUSTOM_OPENAI_COMPAT_ID,
    secret: "sk-dual-abc123456789012",
    account: "profile:p1",
  });
  const ssrf = createSsrfPolicy({ resolver: DUAL_STACK });
  return createModelDiscovery({ ssrf, credentials, dialer }).discover({
    baseUrl: "https://mkp-api.fptcloud.com/v1",
    credentialRef: ref,
    envSpec: providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, "CUSTOM_OPENAI_COMPAT_API_KEY"),
  });
}

test("dual-stack: a dead IPv6 pin falls back to the validated IPv4", async () => {
  const dialer = fakeDialer((req) => {
    if (req.family === 6) throw new ProbeTimeoutError(8_000);
    return { status: 200, headers: {}, dialedIp: req.ip, bodyText: LIST_BODY };
  });
  const result = await dualStackDiscover(dialer);
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ["deepseek-chat", "deepseek-reasoner"]);
  assert.equal(dialer.calls.length, 2);
  assert.equal(dialer.calls[0]!.family, 6);
  assert.equal(dialer.calls[1]!.family, 4);
});

test("F2 still holds: a socket reporting an unvalidated IP is refused even with fallback", async () => {
  // The socket reports a DIFFERENT, unvalidated IP than the pinned candidate.
  const dialer = fakeDialer(() => ({
    status: 200,
    headers: {},
    dialedIp: "203.0.113.9", // never in the validated set
  }));
  await assert.rejects(dualStackDiscover(dialer), SocketPinViolationError);
});

test("profile discovery without a stored credential is a non-blocking error (no dial)", async () => {
  const dialer = fakeDialer(respondWith(200, LIST_BODY));
  const credentials = createCredentialService({ store: createMemoryStore() });
  const discovery = createProfileModelDiscovery({
    credentials,
    dnsResolver: staticResolver(PUBLIC_IP),
    dialer,
  });
  const { credentialRef: _drop, ...noCred } = profileFixture();
  void _drop;
  const result = await discovery.discoverForProfile(noCred as ProviderProfile);
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "auth_invalid");
  assert.equal(dialer.calls.length, 0);
});
