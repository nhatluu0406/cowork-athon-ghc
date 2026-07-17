// service/tests/ms365-site-scope-service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSiteScopeService } from "../src/ms365/site-scope-service.js";
import { createSiteScopeStore } from "../src/ms365/site-scope-store.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";
import type { GraphClient, GraphClientRequest } from "../src/ms365/graph-client.js";

function connectorReturning(
  recorder: GraphClientRequest[],
  responder: (r: GraphClientRequest) => unknown,
): Ms365Connector {
  const graph: GraphClient = {
    json: async (r) => {
      recorder.push(r);
      return responder(r) as never;
    },
    bytes: async (r) => {
      recorder.push(r);
      return responder(r) as Uint8Array;
    },
  };
  return {
    connectionState: () => "connected",
    connectWithToken: async () => {},
    disconnect: async () => {},
    graph: () => graph,
    source: () => "manual_token",
    lastError: () => null,
  };
}

async function newStore() {
  return createSiteScopeStore({ persistence: { load: async () => [], save: async () => {} } });
}

test("listJoinedSites maps /me/followedSites and seeds each ENABLED", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({
    value: [
      { id: "s1", displayName: "Team A", webUrl: "http://x/s1" },
      { id: "s2", displayName: "Team B", webUrl: "http://x/s2" },
    ],
  }));
  const svc = createSiteScopeService({ connector: conn, store: await newStore() });
  const sites = await svc.listJoinedSites();
  assert.equal(sites.length, 2);
  assert.deepEqual(sites[0], { id: "s1", displayName: "Team A", webUrl: "http://x/s1", enabled: true });
  assert.match(seen[0].path, /\/me\/followedSites/);
});

test("a site toggled off reports enabled:false on next list", async () => {
  const conn = connectorReturning([], () => ({ value: [{ id: "s1", displayName: "A", webUrl: "u" }] }));
  const svc = createSiteScopeService({ connector: conn, store: await newStore() });
  await svc.listJoinedSites();
  await svc.setSiteEnabled("s1", false);
  const sites = await svc.listJoinedSites();
  assert.equal(sites[0].enabled, false);
  assert.deepEqual(svc.enabledSiteIds(), []);
});

test("listJoinedSites drops malformed entries and caps at maxSites", async () => {
  const conn = connectorReturning([], () => ({
    value: [
      { id: "s1", displayName: "A", webUrl: "u1" },
      { id: 123, displayName: "bad", webUrl: "u" }, // non-string id → dropped
      { id: "s2", displayName: "B", webUrl: "u2" },
    ],
  }));
  const svc = createSiteScopeService({ connector: conn, store: await newStore(), maxSites: 1 });
  const sites = await svc.listJoinedSites();
  assert.equal(sites.length, 1);
  assert.equal(sites[0].id, "s1");
});
