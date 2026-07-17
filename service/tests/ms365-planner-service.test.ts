// service/tests/ms365-planner-service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlannerService } from "../src/ms365/planner-service.js";
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

test("listPlans maps /me/planner/plans and caps", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [
    { id: "p1", title: "Plan ABC" }, { id: 2, title: "bad" }, { id: "p3", title: "Plan X" },
  ]}));
  const svc = createPlannerService({ connector: conn, maxResults: 1 });
  const plans = await svc.listPlans();
  assert.deepEqual(plans, [{ id: "p1", title: "Plan ABC" }]);
  assert.match(seen[0].path, /\/me\/planner\/plans/);
});

test("listTasks maps tasks incl etag from @odata.etag, defaults missing fields", async () => {
  const conn = connectorReturning([], () => ({ value: [
    { id: "t1", title: "T1", planId: "p1", percentComplete: 50, dueDateTime: "2026-07-13T00:00:00Z", "@odata.etag": 'W/"e1"' },
    { id: "t2", title: "T2", planId: "p1" }, // thiếu due/percent/etag → defaults
    { title: "no id" }, // dropped
  ]}));
  const svc = createPlannerService({ connector: conn });
  const tasks = await svc.listTasks("p1");
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0], { id: "t1", title: "T1", planId: "p1", percentComplete: 50, dueDateTime: "2026-07-13T00:00:00Z", etag: 'W/"e1"' });
  assert.deepEqual(tasks[1], { id: "t2", title: "T2", planId: "p1", percentComplete: 0, dueDateTime: "", etag: "" });
});

test("createTask POSTs body with assignments when assigneeUserIds given", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ id: "t9", title: "New", planId: "p1", percentComplete: 0, "@odata.etag": 'W/"e9"' }));
  const svc = createPlannerService({ connector: conn });
  const t = await svc.createTask({ planId: "p1", title: "New", dueDateTime: "2026-07-13T00:00:00Z", assigneeUserIds: ["u1"] });
  assert.equal(t.id, "t9");
  const body = seen[0].body as Record<string, unknown>;
  assert.equal(body.planId, "p1");
  assert.equal(body.title, "New");
  assert.equal(body.dueDateTime, "2026-07-13T00:00:00Z");
  assert.deepEqual(body.assignments, { u1: { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" } });
});

test("editTask PATCHes with If-Match and only provided fields", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => undefined);
  const svc = createPlannerService({ connector: conn });
  await svc.editTask({ taskId: "t1", etag: 'W/"e1"', percentComplete: 100 });
  assert.equal(seen[0].method, "PATCH");
  assert.equal(seen[0].ifMatch, 'W/"e1"');
  assert.match(seen[0].path, /\/planner\/tasks\/t1/);
  assert.deepEqual(seen[0].body, { percentComplete: 100 }); // KHÔNG có title/dueDateTime undefined
});

test("deleteTask DELETEs with If-Match", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => undefined);
  const svc = createPlannerService({ connector: conn });
  await svc.deleteTask({ taskId: "t1", etag: 'W/"e1"' });
  assert.equal(seen[0].method, "DELETE");
  assert.equal(seen[0].ifMatch, 'W/"e1"');
});
