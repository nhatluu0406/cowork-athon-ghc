/**
 * Device-code OAuth adapter tests. Scripts a fake fetch through begin -> pending ->
 * connected, then exercises refresh-near-expiry and refresh-failure edge cases using
 * the injectable clock (no real Date.now / no real network).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeviceCodeProvider } from "../src/ms365/device-code-provider.js";
import { createSsrfPolicy, type ResolvedAddress } from "../src/provider/index.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";

const PUBLIC = async (): Promise<readonly ResolvedAddress[]> => [{ address: "20.190.1.1", family: 4 }];

function scriptedFetch(steps: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return (async () => {
    const step = steps[Math.min(i++, steps.length - 1)];
    return { ok: step.status < 300, status: step.status, headers: { get: () => null }, json: async () => step.body } as unknown as Response;
  }) as unknown as typeof fetch;
}

test("begin() returns a device code prompt", async () => {
  const fetchFn = scriptedFetch([{ status: 200, body: { user_code: "ABCD", verification_uri: "https://microsoft.com/devicelogin", expires_in: 900, device_code: "dc" } }]);
  const { begin } = createDeviceCodeProvider({ ssrf: createSsrfPolicy({ resolver: PUBLIC }), fetchFn, config: { clientId: "cid", scopes: ["Sites.Read.All"] } });
  const prompt = await begin();
  assert.equal(prompt.userCode, "ABCD");
  assert.match(prompt.verificationUri, /devicelogin/);
  assert.equal(prompt.expiresInSec, 900);
});

test("poll() returns pending then connected", async () => {
  const fetchFn = scriptedFetch([
    { status: 200, body: { user_code: "ABCD", verification_uri: "u", expires_in: 900, device_code: "dc" } },
    { status: 400, body: { error: "authorization_pending" } },
    { status: 200, body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 } },
  ]);
  const { provider, begin, poll } = createDeviceCodeProvider({ ssrf: createSsrfPolicy({ resolver: PUBLIC }), fetchFn, config: { clientId: "cid", scopes: ["Sites.Read.All"] } });
  await begin();
  assert.equal(await poll(), "pending");
  assert.equal(await poll(), "connected");
  assert.equal(await provider.getAccessToken(), "AT");
  assert.equal(provider.source, "device_code");
  assert.equal(await provider.isValid(), true);
});

test("getAccessToken refreshes when within 60s of expiry", async () => {
  let nowMs = 0;
  const now = () => nowMs;
  const fetchFn = scriptedFetch([
    { status: 200, body: { user_code: "ABCD", verification_uri: "u", expires_in: 900, device_code: "dc" } },
    { status: 200, body: { access_token: "AT1", refresh_token: "RT1", expires_in: 3600 } },
    { status: 200, body: { access_token: "AT2", refresh_token: "RT2", expires_in: 3600 } },
  ]);
  const { provider, begin, poll } = createDeviceCodeProvider({ ssrf: createSsrfPolicy({ resolver: PUBLIC }), fetchFn, config: { clientId: "cid", scopes: ["Sites.Read.All"] }, now });
  await begin();
  assert.equal(await poll(), "connected");
  assert.equal(await provider.getAccessToken(), "AT1");

  // Advance clock to within 60s of expiresAt (now + 3600_000 - 30_000).
  nowMs += 3600_000 - 30_000;
  assert.equal(await provider.getAccessToken(), "AT2");
});

test("getAccessToken throws auth_expired when refresh fails", async () => {
  let nowMs = 0;
  const now = () => nowMs;
  const fetchFn = scriptedFetch([
    { status: 200, body: { user_code: "ABCD", verification_uri: "u", expires_in: 900, device_code: "dc" } },
    { status: 200, body: { access_token: "AT1", refresh_token: "RT1", expires_in: 3600 } },
    { status: 400, body: { error: "invalid_grant" } },
  ]);
  const { provider, begin, poll } = createDeviceCodeProvider({ ssrf: createSsrfPolicy({ resolver: PUBLIC }), fetchFn, config: { clientId: "cid", scopes: ["Sites.Read.All"] }, now });
  await begin();
  assert.equal(await poll(), "connected");

  nowMs += 3600_000 - 10_000;
  await assert.rejects(
    () => provider.getAccessToken(),
    (err: unknown) => err instanceof Ms365Error && err.kind === "auth_expired",
  );
});

test("clear() drops cached tokens and isValid reflects it", async () => {
  const fetchFn = scriptedFetch([
    { status: 200, body: { user_code: "ABCD", verification_uri: "u", expires_in: 900, device_code: "dc" } },
    { status: 200, body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 } },
  ]);
  const { provider, begin, poll } = createDeviceCodeProvider({ ssrf: createSsrfPolicy({ resolver: PUBLIC }), fetchFn, config: { clientId: "cid", scopes: ["Sites.Read.All"] } });
  await begin();
  await poll();
  assert.equal(await provider.isValid(), true);
  await provider.clear();
  assert.equal(await provider.isValid(), false);
  await assert.rejects(() => provider.getAccessToken());
});
