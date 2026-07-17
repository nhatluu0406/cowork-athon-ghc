// service/tests/ms365-lists-service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createListsService } from "../src/ms365/lists-service.js";
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
    noContent: async (r) => {
      recorder.push(r);
      responder(r);
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

test("getLists maps /sites/{id}/lists and caps", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [
    { id: "l1", displayName: "UserList" }, { id: 2, displayName: "bad" }, { id: "l3", displayName: "Other" },
  ]}));
  const svc = createListsService({ connector: conn, maxResults: 1 });
  assert.deepEqual(await svc.getLists("s1"), [{ id: "l1", displayName: "UserList" }]);
  assert.match(seen[0].path, /\/sites\/s1\/lists/);
});

test("getItems expands fields and passes $filter as query param value", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [
    { id: "1", fields: { Title: "Alice", Status: "Active" } },
    { id: "2" }, // fields thiếu → {}
    { fields: {} }, // id thiếu → dropped
  ]}));
  const svc = createListsService({ connector: conn });
  const items = await svc.getItems("s1", "l1", "fields/Status eq 'Active'");
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { id: "1", fields: { Title: "Alice", Status: "Active" } });
  assert.deepEqual(items[1], { id: "2", fields: {} });
  assert.equal(seen[0].query?.["$expand"], "fields");
  assert.equal(seen[0].query?.["$filter"], "fields/Status eq 'Active'");
});

test("getItems omits $filter when not given", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  await createListsService({ connector: conn }).getItems("s1", "l1");
  assert.equal(seen[0].query?.["$filter"], undefined);
});

test("getItems sends $expand=fields (with $ prefix) — real Graph ignores bare 'expand'", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  await createListsService({ connector: conn }).getItems("s1", "l1");
  assert.equal(seen[0].query?.["$expand"], "fields");
  assert.equal(seen[0].query?.["expand"], undefined);
});

test("getItems with a filter sends the non-indexed-query Prefer header; without filter it does not", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  const svc = createListsService({ connector: conn });
  await svc.getItems("s1", "l1", "fields/Title eq 'x'");
  assert.equal(seen[0].prefer, "HonorNonIndexedQueriesWarningMayFailRandomly");
  await svc.getItems("s1", "l1");
  assert.equal(seen[1].prefer, undefined);
});

test("addItem POSTs { fields } and maps created item", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ id: "9", fields: { Title: "New" } }));
  const item = await createListsService({ connector: conn }).addItem({ siteId: "s1", listId: "l1", fields: { Title: "New" } });
  assert.deepEqual(item, { id: "9", fields: { Title: "New" } });
  assert.equal(seen[0].method, "POST");
  assert.deepEqual(seen[0].body, { fields: { Title: "New" } });
});

test("editItem PATCHes /items/{id}/fields with the fields body (noContent)", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => undefined);
  await createListsService({ connector: conn }).editItem({ siteId: "s1", listId: "l1", itemId: "5", fields: { Status: "Done" } });
  assert.equal(seen[0].method, "PATCH");
  assert.match(seen[0].path, /\/items\/5\/fields/);
  assert.deepEqual(seen[0].body, { Status: "Done" });
});

test("deleteItem DELETEs /items/{id} (noContent)", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => undefined);
  await createListsService({ connector: conn }).deleteItem({ siteId: "s1", listId: "l1", itemId: "5" });
  assert.equal(seen[0].method, "DELETE");
  assert.match(seen[0].path, /\/items\/5$/);
});

test("a disabled site blocks EVERY method before any Graph call (fail-closed)", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  const svc = createListsService({ connector: conn, siteFilter: { isEnabled: () => false } });
  for (const op of [
    () => svc.getLists("s1"),
    () => svc.getItems("s1", "l1"),
    () => svc.addItem({ siteId: "s1", listId: "l1", fields: {} }),
    () => svc.editItem({ siteId: "s1", listId: "l1", itemId: "5", fields: {} }),
    () => svc.deleteItem({ siteId: "s1", listId: "l1", itemId: "5" }),
  ]) {
    await assert.rejects(op, (e: unknown) => e instanceof Ms365Error && e.kind === "endpoint_blocked");
  }
  assert.equal(seen.length, 0); // Graph KHÔNG BAO GIỜ được gọi
});

test("without siteFilter all methods pass through (backward compatible)", async () => {
  const conn = connectorReturning([], () => ({ value: [] }));
  await createListsService({ connector: conn }).getLists("s1"); // không throw
});
