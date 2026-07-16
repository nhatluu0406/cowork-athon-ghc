/**
 * HTTP connection-probe contract + security tests (CGHC-011, PR3/PR7; ADR 0005).
 *
 * All tests inject a FAKE {@link HttpDialer} — no live network, no live LLM call (testing
 * policy). They prove:
 *  1. contract: probe success (2xx → ok) and auth-error (401 → mapped PR7 auth_invalid);
 *  2. credential no-echo: the secret never surfaces in a return value, log, or error;
 *  3. F2 socket-IP pin: a socket that reports a different IP than the validated pin is REFUSED;
 *  4. F3 redirect revalidation: a 3xx to a private/metadata host is refused (not followed);
 *  5. timeout: a bounded timeout maps to a PR7 timeout error (no infinite retry).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CredentialRef, ProviderId } from "@cowork-ghc/contracts";
import {
  createProviderPort,
  createSsrfPolicy,
  createHttpConnector,
  providerEnvSpec,
  SocketPinViolationError,
  SsrfBlockedError,
  CrossHostRedirectError,
  ProbeTimeoutError,
  CUSTOM_OPENAI_COMPAT_ID,
  type DnsResolver,
  type HttpDialer,
  type HttpProbeRequest,
  type HttpProbeResponse,
  type ResolvedAddress,
} from "../src/provider/index.js";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";

const PUBLIC_IP = "93.184.216.34";
const one = (address: string, family: 4 | 6 = 4): readonly ResolvedAddress[] => [{ address, family }];
const staticResolver = (address: string): DnsResolver => async () => one(address);

/** A recording fake dialer: captures every request and returns a scripted response. */
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

/** The IP the socket actually used equals the pin (the honest, F2-passing default). */
const echoPinned =
  (status: number, headers: Record<string, string> = {}) =>
  (req: HttpProbeRequest): HttpProbeResponse => ({ status, headers, dialedIp: req.ip });

interface Harness {
  readonly testConnection: (id: ProviderId) => Promise<import("@cowork-ghc/contracts").TestResult>;
  readonly logs: string[];
  readonly secret: string;
  readonly containsSecret: (text: string) => boolean;
}

/** Build a built-in-provider harness (openai) wired to the fake dialer + a real credential. */
async function harness(dialer: HttpDialer, secret = "sk-openai-DO-NOT-LEAK-abc123def456"): Promise<Harness> {
  const logs: string[] = [];
  const credentials = createCredentialService({ store: createMemoryStore(), log: (l) => logs.push(l) });
  const ref = await credentials.store({ providerId: "openai", secret });
  const ssrf = createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) });
  const connector = createHttpConnector({
    ssrf,
    credentials,
    credentialRefFor: () => ref,
    dialer,
    envSpecFor: () => providerEnvSpec("openai"),
  });
  const port = createProviderPort({ ssrf, connector });
  return {
    testConnection: (id) => port.testConnection(id),
    logs,
    secret,
    containsSecret: (text) => credentials.scrubber.containsSecret(text),
  };
}

// ---- 1. Contract: connect success + auth error --------------------------------------

test("probe success: a 2xx from the auth-gated endpoint → { ok: true }", async () => {
  const dialer = fakeDialer(echoPinned(200));
  const h = await harness(dialer);
  const result = await h.testConnection("openai");
  assert.deepEqual(result, { ok: true });
  assert.equal(dialer.calls.length, 1, "exactly one bounded request");
  // The key rode in the Authorization header (the ONLY place it is embedded).
  assert.equal(dialer.calls[0]?.headers["authorization"], `Bearer ${h.secret}`);
});

test("auth error: a 401 → mapped PR7 auth_invalid (non-retryable)", async () => {
  const h = await harness(fakeDialer(echoPinned(401)));
  const result = await h.testConnection("openai");
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "auth_invalid");
  assert.equal(result.error?.retryable, false);
});

test("a 403 also maps to auth_invalid", async () => {
  const h = await harness(fakeDialer(echoPinned(403)));
  const result = await h.testConnection("openai");
  assert.equal(result.error?.kind, "auth_invalid");
});

test("no credential configured → a clean auth failure (no crash, no secret)", async () => {
  const ssrf = createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) });
  const connector = createHttpConnector({
    ssrf,
    credentials: createCredentialService({ store: createMemoryStore() }),
    credentialRefFor: () => undefined,
    dialer: fakeDialer(echoPinned(200)),
  });
  const port = createProviderPort({ ssrf, connector });
  const result = await port.testConnection("openai");
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "auth_invalid");
});

// ---- 2. Credential no-echo ----------------------------------------------------------

test("no-echo: the secret never surfaces in a return value, log, or error", async () => {
  const secret = "sk-openai-DO-NOT-LEAK-superSecretValue-987654";
  // Exercise both a success and an error path; neither may echo the key.
  for (const status of [200, 401] as const) {
    const h = await harness(fakeDialer(echoPinned(status)), secret);
    const result = await h.testConnection("openai");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(secret), `TestResult must not contain the secret (status ${status})`);
    for (const line of h.logs) {
      assert.ok(!line.includes(secret), "audit log lines are scrubbed of the secret");
    }
    // The scrubber (shared) knows the value — proving it was registered at resolve time.
    assert.ok(h.containsSecret(`leak? ${secret}`), "resolved key is registered with the scrubber");
  }
});

// ---- 3. F2 socket-IP pin ------------------------------------------------------------

test("F2: a socket that dials a DIFFERENT IP than the validated pin is REFUSED", async () => {
  // The policy validates a PUBLIC IP; the (compromised) socket reports a PRIVATE IP at
  // connect time. The connector must catch this even though the pin was correct.
  const PRIVATE_IP = "10.0.0.5";
  const dialer = fakeDialer((req) => ({ status: 200, headers: {}, dialedIp: PRIVATE_IP }));
  const h = await harness(dialer);
  await assert.rejects(
    () => h.testConnection("openai"),
    (err: unknown) =>
      err instanceof SocketPinViolationError && err.expectedIp === PUBLIC_IP && err.actualIp === PRIVATE_IP,
  );
  // The connector pinned the socket to the VALIDATED public IP (F2 pin input).
  assert.equal(dialer.calls[0]?.ip, PUBLIC_IP, "the socket was pinned to the validated IP");
});

test("F2 control: dialing the exact validated pin passes", async () => {
  const dialer = fakeDialer(echoPinned(200));
  const h = await harness(dialer);
  assert.deepEqual(await h.testConnection("openai"), { ok: true });
  assert.equal(dialer.calls[0]?.ip, PUBLIC_IP);
});

// ---- 4. F3 redirect revalidation ----------------------------------------------------

async function customHarness(dialer: HttpDialer) {
  const logs: string[] = [];
  const credentials = createCredentialService({ store: createMemoryStore(), log: (l) => logs.push(l) });
  const ref: CredentialRef = await credentials.store({ providerId: "custom", secret: "cust-DO-NOT-LEAK-abcdef123" });
  // Config-time + connect-time resolution both return a public IP (rebinding is separate).
  const ssrf = createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) });
  const connector = createHttpConnector({
    ssrf,
    credentials,
    credentialRefFor: () => ref,
    dialer,
    envSpecFor: () => providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, "CUSTOM_API_KEY"),
  });
  const port = createProviderPort({ ssrf, connector });
  await port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://api.example.com/v1" });
  return port;
}

test("F3: a 3xx Location pointing at cloud-metadata is refused (not followed)", async () => {
  const dialer = fakeDialer(echoPinned(302, { location: "https://169.254.169.254/latest/meta-data/" }));
  const port = await customHarness(dialer);
  await assert.rejects(
    () => port.testConnection(CUSTOM_OPENAI_COMPAT_ID),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "cloud_metadata",
  );
  assert.equal(dialer.calls.length, 1, "the redirect was NOT followed (dialer called once)");
});

test("F3: a 3xx Location pointing at an RFC-1918 private host is refused", async () => {
  const dialer = fakeDialer(echoPinned(301, { location: "https://10.1.2.3/v1/models" }));
  const port = await customHarness(dialer);
  await assert.rejects(
    () => port.testConnection(CUSTOM_OPENAI_COMPAT_ID),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "private",
  );
  assert.equal(dialer.calls.length, 1);
});

test("F3 (M1): a 3xx to a DIFFERENT public host is refused and the credential is NOT resent", async () => {
  // The redirect target resolves public (SSRF would pass), so the ONLY thing stopping a
  // credential leak to another host is the cross-host guard. Prove it fires and the dialer
  // is never called a second time (the Authorization header never reaches the new host).
  const dialer = fakeDialer(echoPinned(302, { location: "https://attacker.example.net/v1/models" }));
  const port = await customHarness(dialer);
  await assert.rejects(
    () => port.testConnection(CUSTOM_OPENAI_COMPAT_ID),
    (err: unknown) => err instanceof CrossHostRedirectError,
  );
  assert.equal(dialer.calls.length, 1, "credential is dialed to the original host only, never resent");
});

test("F3: exceeding the bounded redirect hops is refused (no infinite follow)", async () => {
  // Every hop is a same-host, public redirect → passes SSRF + cross-host, so only the hop
  // bound stops it. maxRedirects defaults to 3; the 4th dial must not happen.
  const dialer = fakeDialer(echoPinned(302, { location: "https://api.example.com/next" }));
  const ssrf = createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) });
  const credentials = createCredentialService({ store: createMemoryStore() });
  const ref = await credentials.store({ providerId: "custom", secret: "cust-DO-NOT-LEAK" });
  const connector = createHttpConnector({
    ssrf, credentials, credentialRefFor: () => ref, dialer,
    envSpecFor: () => providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, "CUSTOM_API_KEY"),
  });
  const port = createProviderPort({ ssrf, connector });
  await port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://api.example.com/v1" });
  const result = await port.testConnection(CUSTOM_OPENAI_COMPAT_ID);
  assert.equal(result.ok, false, "a redirect loop terminates as an error, not an infinite follow");
  assert.ok(dialer.calls.length <= 4, "the follow is bounded by maxRedirects");
});

test("F3: a 3xx with no Location header is a clean mapped error, not a crash", async () => {
  const dialer = fakeDialer(echoPinned(302, {})); // redirect, but no location
  const port = await customHarness(dialer);
  const result = await port.testConnection(CUSTOM_OPENAI_COMPAT_ID);
  assert.equal(result.ok, false);
  assert.ok(result.error, "a missing redirect target maps to an error");
});

// ---- 5. Timeout ---------------------------------------------------------------------

test("timeout: a bounded probe timeout → mapped PR7 timeout (retryable, no retry loop)", async () => {
  let calls = 0;
  const dialer = fakeDialer(() => {
    calls += 1;
    throw new ProbeTimeoutError(10);
  });
  const h = await harness(dialer);
  const result = await h.testConnection("openai");
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "timeout");
  assert.equal(result.error?.retryable, true);
  assert.equal(calls, 1, "the probe does not retry (bounded)");
});

test("transport failure (e.g. connection refused) maps to a non-secret PR7 error", async () => {
  const dialer = fakeDialer(() => {
    throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  });
  const h = await harness(dialer);
  const result = await h.testConnection("openai");
  assert.equal(result.ok, false);
  assert.ok(result.error, "an error is mapped");
  assert.ok(!JSON.stringify(result).includes(h.secret));
});

test("custom endpoint: auth probe then model probe — invalid model maps to model_invalid", async () => {
  const secret = "sk-custom-DO-NOT-LEAK-model-probe";
  const credentials = createCredentialService({ store: createMemoryStore() });
  const ref = await credentials.store({ providerId: CUSTOM_OPENAI_COMPAT_ID, secret });
  const ssrf = createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) });
  const dialer = fakeDialer((req) => {
    if (req.method === "POST") return { status: 400, headers: {}, dialedIp: req.ip };
    return { status: 200, headers: {}, dialedIp: req.ip };
  });
  const connector = createHttpConnector({
    ssrf,
    credentials,
    credentialRefFor: () => ref,
    dialer,
    activeModelFor: () => ({ providerID: CUSTOM_OPENAI_COMPAT_ID, modelID: "cghc-invalid-model" }),
    envSpecFor: () => providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, "DEEPSEEK_API_KEY"),
  });
  const port = createProviderPort({ ssrf, connector });
  await port.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, { baseUrl: "https://api.example.test/v1" });
  const result = await port.testConnection(CUSTOM_OPENAI_COMPAT_ID);
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "model_invalid");
  assert.equal(dialer.calls.length, 2, "models list then chat completion");
});

// ---- 6. Dual-stack IP-pinned Happy-Eyeballs fallback --------------------------------

test("dual-stack: a dead IPv6 pin falls back to the validated IPv4 (still IP-pinned)", async () => {
  const logs: string[] = [];
  const credentials = createCredentialService({ store: createMemoryStore(), log: (l) => logs.push(l) });
  const ref = await credentials.store({ providerId: "openai", secret: "sk-openai-DO-NOT-LEAK-abc123def456" });
  const ssrf = createSsrfPolicy({
    resolver: async () => [
      { address: "2606:4700:10::ac42:aa78", family: 6 as const }, // dead IPv6
      { address: "93.184.216.34", family: 4 as const }, // working IPv4
    ],
  });
  const dialer = fakeDialer((req) => {
    if (req.family === 6) throw new ProbeTimeoutError(10_000);
    return echoPinned(200)(req);
  });
  const connector = createHttpConnector({
    ssrf,
    credentials,
    credentialRefFor: () => ref,
    dialer,
    envSpecFor: () => providerEnvSpec("openai"),
  });
  const port = createProviderPort({ ssrf, connector });
  const result = await port.testConnection("openai");
  assert.equal(result.ok, true);
  assert.equal(dialer.calls.length, 2, "IPv6 attempt then IPv4 fallback");
  assert.equal(dialer.calls[0]!.family, 6);
  assert.equal(dialer.calls[1]!.family, 4);
});
