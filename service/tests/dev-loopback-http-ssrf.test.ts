/**
 * Developer-only loopback-http override — direct SSRF policy behavior (CGHC-010 follow-up).
 *
 * Proves the override, via `readDevLoopbackHttpEscape` feeding `createSsrfPolicy({ loopbackEscape })`,
 * relaxes ONLY loopback http and cannot widen anything beyond loopback:
 *  - flag OFF: `http://127.0.0.1:8080` refused (scheme_not_https) — unchanged baseline;
 *  - flag ON: `http://127.0.0.1:8080` and a `localhost`-style hostname resolving to loopback allowed;
 *  - flag ON but target not loopback: private (10.0.0.1), cloud-metadata (169.254.169.254), and a
 *    public host over http all stay refused.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSsrfPolicy,
  SsrfBlockedError,
  type DnsResolver,
  type ResolvedAddress,
} from "../src/provider/index.js";
import { readDevLoopbackHttpEscape } from "../src/provider/dev-loopback-http.js";

const loopbackResolver: DnsResolver = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "127.0.0.1", family: 4 },
];
const publicResolver: DnsResolver = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

test("flag OFF: http://127.0.0.1:8080 is refused (scheme_not_https) — baseline unchanged", async () => {
  const escape = readDevLoopbackHttpEscape({}); // unset
  assert.equal(escape, false);
  const policy = createSsrfPolicy({ resolver: loopbackResolver, loopbackEscape: escape });
  await assert.rejects(
    () => policy.assertAllowed("http://127.0.0.1:8080"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "scheme_not_https",
  );
});

test("flag ON: http://127.0.0.1:8080 is allowed (literal loopback IP)", async () => {
  const escape = readDevLoopbackHttpEscape({ COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP: "1" });
  assert.equal(escape, true);
  const policy = createSsrfPolicy({ resolver: loopbackResolver, loopbackEscape: escape });
  const target = await policy.assertAllowed("http://127.0.0.1:8080");
  assert.equal(target.url.hostname, "127.0.0.1");
});

test("flag ON: a hostname resolving to loopback (e.g. localhost) over http is allowed", async () => {
  const escape = readDevLoopbackHttpEscape({ COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP: "true" });
  const policy = createSsrfPolicy({ resolver: loopbackResolver, loopbackEscape: escape });
  const target = await policy.assertAllowed("http://localhost:8080");
  assert.deepEqual(target.resolved, [{ address: "127.0.0.1", family: 4 }]);
});

test("flag ON but target is private (10.0.0.1): still refused", async () => {
  const escape = readDevLoopbackHttpEscape({ COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP: "1" });
  const policy = createSsrfPolicy({ resolver: loopbackResolver, loopbackEscape: escape });
  await assert.rejects(
    () => policy.assertAllowed("http://10.0.0.1"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "private",
  );
});

test("flag ON but target is cloud-metadata (169.254.169.254): still refused", async () => {
  const escape = readDevLoopbackHttpEscape({ COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP: "1" });
  const policy = createSsrfPolicy({ resolver: loopbackResolver, loopbackEscape: escape });
  await assert.rejects(
    () => policy.assertAllowed("http://169.254.169.254"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "cloud_metadata",
  );
});

test("flag ON but target is a public host over http: still refused", async () => {
  const escape = readDevLoopbackHttpEscape({ COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP: "1" });
  const policy = createSsrfPolicy({ resolver: publicResolver, loopbackEscape: escape });
  await assert.rejects(
    () => policy.assertAllowed("http://api.example.com"),
    (err: unknown) => err instanceof SsrfBlockedError && err.reason === "scheme_not_https",
  );
});
