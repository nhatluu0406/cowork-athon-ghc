import { test } from "node:test";
import assert from "node:assert/strict";
import { createSharePointService } from "../src/ms365/sharepoint-service.js";
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

test("search caps results at maxResults and returns hits", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({
    value: [
      {
        hitsContainers: [
          {
            hits: [
              { resource: { id: "a", name: "Doc A", webUrl: "http://x/a" } },
              { resource: { id: "b", name: "Doc B", webUrl: "http://x/b" } },
            ],
          },
        ],
      },
    ],
  }));
  const svc = createSharePointService({
    connector: conn,
    files: { readBytes: async () => new Uint8Array() },
    maxResults: 1,
  });
  const hits = await svc.search("quarterly report");
  assert.equal(hits.length, 1);
  assert.equal(seen[0].method, "POST");
  assert.match(seen[0].path, /\/search\/query/);
});

test("upload reads the workspace file then PUTs content", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ id: "up1", webUrl: "http://x/up1" }));
  const bytes = new TextEncoder().encode("hello");
  const svc = createSharePointService({ connector: conn, files: { readBytes: async () => bytes } });
  const out = await svc.upload({ siteId: "S", relativeLocalPath: "notes.txt", targetName: "notes.txt" });
  assert.equal(out.id, "up1");
  const put = seen.find((r) => r.method === "PUT");
  assert.ok(put && put.bodyBytes && put.bodyBytes.length === 5);
});

test("search returns [] without throwing on a malformed/empty response", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({}));
  const svc = createSharePointService({ connector: conn, files: { readBytes: async () => new Uint8Array() } });
  const hits = await svc.search("anything");
  assert.deepEqual(hits, []);
});

test("listSiteFiles maps drive children and caps at maxResults", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({
    value: [
      { id: "1", name: "one.txt", webUrl: "http://x/1" },
      { id: "2", name: "two.txt", webUrl: "http://x/2" },
      { id: "3", name: "three.txt", webUrl: "http://x/3" },
    ],
  }));
  const svc = createSharePointService({ connector: conn, files: { readBytes: async () => new Uint8Array() }, maxResults: 2 });
  const hits = await svc.listSiteFiles("site-1");
  assert.equal(hits.length, 2);
  assert.equal(seen[0].method, "GET");
  assert.match(seen[0].path, /\/sites\/site-1\/drive\/root\/children/);
});

test("getFileSummaryText truncates at maxSummaryBytes", async () => {
  const seen: GraphClientRequest[] = [];
  const longText = "abcdefghij".repeat(10); // 100 bytes
  const conn = connectorReturning(seen, () => new TextEncoder().encode(longText));
  const svc = createSharePointService({
    connector: conn,
    files: { readBytes: async () => new Uint8Array() },
    maxSummaryBytes: 10,
  });
  const text = await svc.getFileSummaryText("item-1");
  assert.equal(text, "abcdefghij");
  assert.equal(seen[0].method, "GET");
  assert.match(seen[0].path, /\/drive\/items\/item-1\/content/);
});
