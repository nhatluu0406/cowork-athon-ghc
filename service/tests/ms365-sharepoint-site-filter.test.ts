import { test } from "node:test";
import assert from "node:assert/strict";
import { createSharePointService } from "../src/ms365/sharepoint-service.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";
import type { GraphClient, GraphClientRequest } from "../src/ms365/graph-client.js";

function connectorReturning(responder: (r: GraphClientRequest) => unknown): Ms365Connector {
  const graph: GraphClient = {
    json: async (r) => responder(r) as never,
    bytes: async (r) => responder(r) as Uint8Array,
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

const twoSiteHits = {
  value: [
    {
      hitsContainers: [
        {
          hits: [
            { resource: { id: "a", name: "Doc A", webUrl: "u/a", parentReference: { siteId: "site-on" } } },
            { resource: { id: "b", name: "Doc B", webUrl: "u/b", parentReference: { siteId: "site-off" } } },
          ],
        },
      ],
    },
  ],
};

test("search drops hits from a disabled site (server-side block)", async () => {
  const conn = connectorReturning(() => twoSiteHits);
  const svc = createSharePointService({
    connector: conn,
    files: { readBytes: async () => new Uint8Array() },
    siteFilter: { isEnabled: (id) => id !== "site-off" },
  });
  const hits = await svc.search("q");
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
});

test("with no siteFilter, search returns all hits (backward compatible)", async () => {
  const conn = connectorReturning(() => twoSiteHits);
  const svc = createSharePointService({ connector: conn, files: { readBytes: async () => new Uint8Array() } });
  const hits = await svc.search("q");
  assert.deepEqual(hits.map((h) => h.id).sort(), ["a", "b"]);
});

test("a hit with no resolvable site id is DROPPED when a siteFilter is present (fail-closed)", async () => {
  const conn = connectorReturning(() => ({
    value: [{ hitsContainers: [{ hits: [{ resource: { id: "c", name: "C", webUrl: "u/c" } }] }] }],
  }));
  const svc = createSharePointService({
    connector: conn,
    files: { readBytes: async () => new Uint8Array() },
    siteFilter: { isEnabled: () => false },
  });
  const hits = await svc.search("q");
  assert.deepEqual(hits.map((h) => h.id), []);
});

const siteChildren = {
  value: [{ id: "f1", name: "File 1", webUrl: "u/f1" }],
};

test("listSiteFiles denies (fail-closed) when the site is disabled", async () => {
  const conn = connectorReturning(() => siteChildren);
  const svc = createSharePointService({
    connector: conn,
    files: { readBytes: async () => new Uint8Array() },
    siteFilter: { isEnabled: () => false },
  });
  await assert.rejects(
    () => svc.listSiteFiles("site-off"),
    (err: unknown) => {
      assert.ok(err instanceof Ms365Error);
      assert.equal(err.kind, "endpoint_blocked");
      return true;
    },
  );
});

test("listSiteFiles returns files normally when the site is enabled", async () => {
  const conn = connectorReturning(() => siteChildren);
  const svc = createSharePointService({
    connector: conn,
    files: { readBytes: async () => new Uint8Array() },
    siteFilter: { isEnabled: () => true },
  });
  const hits = await svc.listSiteFiles("site-on");
  assert.deepEqual(hits.map((h) => h.id), ["f1"]);
});

test("listSiteFiles returns files normally when no siteFilter is configured (backward compatible)", async () => {
  const conn = connectorReturning(() => siteChildren);
  const svc = createSharePointService({
    connector: conn,
    files: { readBytes: async () => new Uint8Array() },
  });
  const hits = await svc.listSiteFiles("any-site");
  assert.deepEqual(hits.map((h) => h.id), ["f1"]);
});
