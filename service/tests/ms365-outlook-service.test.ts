// service/tests/ms365-outlook-service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutlookService } from "../src/ms365/outlook-service.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
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

test("searchMessages hits /me/messages with a quoted $search and caps results", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({
    value: [
      { id: "m1", subject: "Q report", from: { emailAddress: { address: "a@x.com" } }, receivedDateTime: "2026-07-01T00:00:00Z", bodyPreview: "hello" },
      { id: "m2", subject: "Q2", from: { emailAddress: { address: "b@x.com" } }, receivedDateTime: "2026-07-02T00:00:00Z", bodyPreview: "hi" },
    ],
  }));
  const svc = createOutlookService({ connector: conn, maxResults: 1 });
  const hits = await svc.searchMessages("quarterly");
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], {
    id: "m1", subject: "Q report", from: "a@x.com", receivedDateTime: "2026-07-01T00:00:00Z", bodyPreview: "hello",
  });
  assert.equal(seen[0].method, "GET");
  assert.match(seen[0].path, /\/me\/messages/);
  assert.equal(seen[0].query?.["$search"], '"quarterly"');
});

test("searchMessages drops malformed entries and defaults missing fields", async () => {
  const conn = connectorReturning([], () => ({
    value: [
      { id: "m1", subject: "ok" }, // missing from/date/preview → defaulted to ""
      { id: 5, subject: "bad id" }, // non-string id → dropped
      { subject: "no id" }, // missing id → dropped
    ],
  }));
  const svc = createOutlookService({ connector: conn });
  const hits = await svc.searchMessages("x");
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], { id: "m1", subject: "ok", from: "", receivedDateTime: "", bodyPreview: "" });
});

test("getMessage returns detail + body", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({
    id: "m1", subject: "S", from: { emailAddress: { address: "a@x.com" } },
    receivedDateTime: "2026-07-01T00:00:00Z", bodyPreview: "p", body: { content: "full body" },
  }));
  const svc = createOutlookService({ connector: conn });
  const msg = await svc.getMessage("m1");
  assert.equal(msg.body, "full body");
  assert.equal(msg.from, "a@x.com");
  assert.match(seen[0].path, /\/me\/messages\/m1/);
});

test("getMessageSummaryText truncates body at maxSummaryBytes", async () => {
  const conn = connectorReturning([], () => ({ id: "m1", subject: "S", body: { content: "abcdefghij".repeat(10) } }));
  const svc = createOutlookService({ connector: conn, maxSummaryBytes: 10 });
  const text = await svc.getMessageSummaryText("m1");
  assert.equal(text, "abcdefghij");
});

test("searchMessages returns [] on a malformed/empty response (no throw)", async () => {
  const conn = connectorReturning([], () => ({}));
  const svc = createOutlookService({ connector: conn });
  assert.deepEqual(await svc.searchMessages("x"), []);
});

test("getMessage throws a typed Ms365Error (graph_error) on a malformed response", async () => {
  const conn = connectorReturning([], () => ({})); // no id/subject → toHit null
  const svc = createOutlookService({ connector: conn });
  await assert.rejects(
    () => svc.getMessage("m1"),
    (err: unknown) => err instanceof Ms365Error && err.kind === "graph_error" && typeof err.recovery === "string",
  );
});

test("searchMessages escapes an embedded double quote in the $search value", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  const svc = createOutlookService({ connector: conn });
  await svc.searchMessages('a" OR from:boss');
  // The embedded " is backslash-escaped so it cannot close the KQL quoted phrase early.
  assert.equal(seen[0].query?.["$search"], '"a\\" OR from:boss"');
});
