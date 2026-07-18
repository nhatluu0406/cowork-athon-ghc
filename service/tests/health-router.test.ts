import { test } from "node:test";
import assert from "node:assert/strict";
import { createHealthRouter, HEALTH_PATH } from "../src/server/health-router.js";

type Handler = () => { status: number; data: { runtimeReady?: boolean; status: string } };

function invoke(runtimeReady?: () => boolean) {
  const router = createHealthRouter(new Date(), runtimeReady);
  const route = router.routes.find((r) => r.path === HEALTH_PATH);
  assert.ok(route, "health route mounted");
  return (route!.handler as unknown as Handler)();
}

test("health omits runtimeReady when no getter is provided (Tier 1)", () => {
  const res = invoke();
  assert.equal(res.status, 200);
  assert.equal(res.data.status, "ok");
  assert.equal(res.data.runtimeReady, undefined);
});

test("health reports runtimeReady live from the getter on each poll", () => {
  let alive = false;
  const runtimeReady = (): boolean => alive;
  assert.equal(invoke(runtimeReady).data.runtimeReady, false, "reports false before the child is up");
  alive = true;
  assert.equal(invoke(runtimeReady).data.runtimeReady, true, "reports true once the child is alive");
});
