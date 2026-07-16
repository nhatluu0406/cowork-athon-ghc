/**
 * Provider boundary router test (CGHC-010 / CGHC-002 carry-forward).
 *
 * Proves: no provider route opts out of the token guard (`publicUnauthenticated` is never
 * set — forbidden for provider routes); the SSRF test-mode escape is UNREACHABLE from a
 * request body (a caller who smuggles `loopbackEscape: true` is still blocked); and a
 * refused base_url yields a non-secret mapped error, not a stack trace.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RouteContext } from "../src/boundary/contract.js";
import {
  createProviderPort,
  createProviderRouter,
  createSsrfPolicy,
  ProviderRequestError,
  PROVIDERS_PATH,
  PROVIDER_ENDPOINT_PATH,
  CUSTOM_OPENAI_COMPAT_ID,
  type ConnectTarget,
  type ProviderConnector,
  type ResolvedAddress,
} from "../src/provider/index.js";

const LOOPBACK_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "127.0.0.1", family: 4 },
];

function connector(): ProviderConnector {
  return { probe: async (_id, _t: ConnectTarget | null) => ({ ok: true }), cancel: async () => {} };
}

// A production port: loopbackEscape is NOT set (defaults false), as a release build yields.
function prodRouter() {
  const port = createProviderPort({
    ssrf: createSsrfPolicy({ resolver: LOOPBACK_RESOLVER }),
    connector: connector(),
  });
  return createProviderRouter(port);
}

function ctx(method: RouteContext["method"], path: string, body?: unknown): RouteContext {
  return { method, url: new URL(`http://127.0.0.1${path}`), params: {}, body };
}

test("no provider route opts out of the token guard (publicUnauthenticated never set)", () => {
  const router = prodRouter();
  for (const route of router.routes) {
    assert.notEqual(route.publicUnauthenticated, true, `${route.path} must stay token-guarded`);
  }
  assert.equal(router.name, "provider");
});

test("GET /v1/providers returns the five descriptors", async () => {
  const router = prodRouter();
  const route = router.routes.find((r) => r.method === "GET" && r.path === PROVIDERS_PATH);
  assert.ok(route);
  const result = (await route.handler(ctx("GET", PROVIDERS_PATH))) as {
    data: { providers: readonly unknown[] };
  };
  assert.equal(result.data.providers.length, 5);
});

test("the SSRF escape is unreachable from the body: a smuggled loopbackEscape is ignored", async () => {
  const router = prodRouter();
  const route = router.routes.find((r) => r.method === "POST" && r.path === PROVIDER_ENDPOINT_PATH);
  assert.ok(route);
  // A malicious caller tries to relax the policy via the request body.
  await assert.rejects(
    () =>
      route.handler(
        ctx("POST", PROVIDER_ENDPOINT_PATH, {
          id: CUSTOM_OPENAI_COMPAT_ID,
          baseUrl: "https://localhost.evil/v1", // resolves to 127.0.0.1
          loopbackEscape: true, // ignored — not a real field
          buildProfile: "development", // ignored
        }),
      ),
    (err: unknown) =>
      err instanceof ProviderRequestError && /SSRF policy: loopback/.test(err.message),
  );
});

test("the DEV loopback-http override is unreachable from the body: a smuggled dev flag is ignored", async () => {
  const router = prodRouter();
  const route = router.routes.find((r) => r.method === "POST" && r.path === PROVIDER_ENDPOINT_PATH);
  assert.ok(route);
  // A caller tries to smuggle the developer-only env override via the request body. The router
  // only ever reads `id`/`baseUrl` from the body (see `parseEndpointBody`) — the override is
  // sourced ONLY from process env at the composition root, never from a request.
  await assert.rejects(
    () =>
      route.handler(
        ctx("POST", PROVIDER_ENDPOINT_PATH, {
          id: CUSTOM_OPENAI_COMPAT_ID,
          baseUrl: "http://localhost.evil/v1", // resolves to 127.0.0.1, plain http
          loopbackEscape: true, // ignored — not a real field
          devAllowLoopbackHttp: true, // ignored — not a real field
          COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP: "1", // ignored — env-only, never a body field
        }),
      ),
    (err: unknown) =>
      err instanceof ProviderRequestError && /SSRF policy: scheme_not_https/.test(err.message),
  );
});

test("a malformed endpoint body is rejected with a generic error", async () => {
  const router = prodRouter();
  const route = router.routes.find((r) => r.method === "POST" && r.path === PROVIDER_ENDPOINT_PATH);
  assert.ok(route);
  await assert.rejects(
    () => route.handler(ctx("POST", PROVIDER_ENDPOINT_PATH, { id: "" })),
    ProviderRequestError,
  );
});
