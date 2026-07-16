import { test } from "node:test";
import assert from "node:assert/strict";
import { createPairingRegistry } from "../src/remote-gateway/pairing.js";
import {
  createRemoteRouter,
  REMOTE_STATUS_PATH,
  REMOTE_PAIRING_CODE_PATH,
  REMOTE_REVOKE_PATH,
  REMOTE_REVOKE_ALL_PATH,
  type RemoteControlState,
  type RemoteGatewayInfo,
} from "../src/remote-gateway/remote-router.js";
import type { AnyRouteDefinition, RouteContext, RouteResult } from "../src/boundary/contract.js";

function neverEnabled(): RemoteControlState {
  return { enabled: () => false, gateway: () => null };
}

function fixedGateway(info: RemoteGatewayInfo | null): RemoteControlState {
  return { enabled: () => info !== null, gateway: () => info };
}

function ctx(body?: unknown): RouteContext {
  return { method: "POST", url: new URL("http://x/"), params: {}, body };
}

function nonStreaming(route: AnyRouteDefinition): (c: RouteContext) => Promise<RouteResult> | RouteResult {
  assert.ok("handler" in route, "route is not a streaming route");
  return (route as { handler: (c: RouteContext) => Promise<RouteResult> | RouteResult }).handler;
}

function findRoute(state: RemoteControlState, path: string) {
  const router = createRemoteRouter({ pairing: createPairingRegistry(), state });
  const found = router.routes.find((r) => r.path === path);
  assert.ok(found, `route ${path} exists`);
  return nonStreaming(found);
}

test("status reflects gateway coordinates and paired devices", async () => {
  const gw: RemoteGatewayInfo = { url: "http://127.0.0.1:7777", lanUrls: ["http://192.168.1.9:7777"] };
  const handler = findRoute(fixedGateway(gw), REMOTE_STATUS_PATH);
  const res = (await handler(ctx())) as {
    data: { enabled: boolean; url: string | null; lanUrls: string[]; devices: unknown[] };
  };
  assert.equal(res.data.enabled, true);
  assert.equal(res.data.url, "http://127.0.0.1:7777");
  assert.deepEqual(res.data.lanUrls, ["http://192.168.1.9:7777"]);
  assert.equal(res.data.devices.length, 0);
});

test("pairing-code issues a code and a QR SVG that encodes the prefill URL", async () => {
  const pairing = createPairingRegistry();
  const gw: RemoteGatewayInfo = { url: "http://127.0.0.1:7777", lanUrls: ["http://192.168.1.9:7777"] };
  const router = createRemoteRouter({ pairing, state: fixedGateway(gw) });
  const handler = nonStreaming(router.routes.find((r) => r.path === REMOTE_PAIRING_CODE_PATH)!);
  const res = (await handler(ctx())) as {
    data: { code: string; qrSvg: string | null; pairingUrl: string | null };
  };
  assert.equal(res.data.code.length, 8);
  assert.ok(res.data.pairingUrl?.startsWith("http://192.168.1.9:7777/?code="));
  assert.match(res.data.qrSvg ?? "", /<svg/);
  // The issued code actually pairs a phone against the SAME registry.
  const exchange = pairing.exchange(res.data.code);
  assert.equal(exchange.ok, true);
});

test("pairing-code without a live gateway still issues a code but no QR", async () => {
  const handler = findRoute(neverEnabled(), REMOTE_PAIRING_CODE_PATH);
  const res = (await handler(ctx())) as {
    data: { code: string; qrSvg: string | null; pairingUrl: string | null };
  };
  assert.equal(res.data.code.length, 8);
  assert.equal(res.data.qrSvg, null);
  assert.equal(res.data.pairingUrl, null);
});

test("revoke and revoke-all delegate to the shared registry", async () => {
  const pairing = createPairingRegistry();
  const router = createRemoteRouter({ pairing, state: neverEnabled() });
  const issued = pairing.issueCode();
  const paired = pairing.exchange(issued.code);
  assert.equal(paired.ok, true);
  if (!paired.ok) return;

  const revoke = nonStreaming(router.routes.find((r) => r.path === REMOTE_REVOKE_PATH)!);
  const revoked = (await revoke(ctx({ deviceId: paired.deviceId }))) as { data: { revoked: boolean } };
  assert.equal(revoked.data.revoked, true);
  assert.equal(pairing.listDevices().length, 0);

  // revoke-all is idempotent-safe even with nothing paired.
  const all = nonStreaming(router.routes.find((r) => r.path === REMOTE_REVOKE_ALL_PATH)!);
  const allRes = (await all(ctx())) as { data: { ok: true } };
  assert.equal(allRes.data.ok, true);
});

test("revoke rejects a missing deviceId as bad_request", () => {
  const handler = findRoute(neverEnabled(), REMOTE_REVOKE_PATH);
  assert.throws(() => handler(ctx({})), /deviceId is required/);
});

test("every remote route is token-guarded (no publicUnauthenticated)", () => {
  const router = createRemoteRouter({ pairing: createPairingRegistry(), state: neverEnabled() });
  for (const r of router.routes) {
    assert.notEqual(
      (r as { publicUnauthenticated?: boolean }).publicUnauthenticated,
      true,
      `${r.method} ${r.path} must stay token-guarded`,
    );
  }
});
