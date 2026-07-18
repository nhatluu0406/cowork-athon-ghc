import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMs365Router,
  MS365_FLOWS_PATH,
  MS365_FLOWS_DELETE_PATH,
  MS365_FLOWS_TOGGLE_PATH,
  MS365_FLOWS_TIMEOUT_PATH,
  MS365_FLOWS_UPDATE_PATH,
} from "../src/ms365/ms365-tool-router.js";
import { createPowerAutomateStore } from "../src/ms365/power-automate-store.js";

async function routerWithStore() {
  const store = await createPowerAutomateStore({ persistence: { load: async () => [], save: async () => {} } });
  const router = createMs365Router({
    powerAutomateStore: store,
    // Unused-by-these-tests deps; cast the whole deps object.
  } as unknown as Parameters<typeof createMs365Router>[0]);
  const find = (method: string, path: string) => {
    const r = router.routes.find((x) => x.method === method && x.path === path);
    assert.ok(r, `route ${method} ${path} missing`);
    return r!;
  };
  return { store, find };
}

test("GET /flows returns description + payloadSchema, never url", async () => {
  const { store, find } = await routerWithStore();
  await store.add({ name: "f1", url: "https://x/1?sig=secret", description: "d1", timeoutMs: 5000, payloadSchema: '{"type":"object"}' });
  const res = await find("GET", MS365_FLOWS_PATH).handler({ body: undefined } as never);
  assert.deepEqual(res.data, { flows: [{ name: "f1", enabled: true, timeoutMs: 5000, description: "d1", payloadSchema: '{"type":"object"}' }] });
  assert.equal(JSON.stringify(res.data).includes("sig=secret"), false);
});

test("POST /flows adds; duplicate name → 400", async () => {
  const { find } = await routerWithStore();
  const add = find("POST", MS365_FLOWS_PATH).handler;
  const res = await add({ body: { name: "f1", url: "https://x/1?sig=a", description: "d", timeoutMs: 3000, payloadSchema: '{"type":"object"}' } } as never);
  assert.deepEqual(res.data, { flows: [{ name: "f1", enabled: true, timeoutMs: 3000, description: "d", payloadSchema: '{"type":"object"}' }] });
  await assert.rejects(() => add({ body: { name: "f1", url: "https://x/2?sig=b" } } as never));
});

test("POST /flows rejects invalid payloadSchema JSON with 400", async () => {
  const { find } = await routerWithStore();
  await assert.rejects(() => find("POST", MS365_FLOWS_PATH).handler({ body: { name: "f1", url: "https://x/1?sig=a", payloadSchema: "{not json" } } as never));
});

test("toggle + timeout + delete", async () => {
  const { store, find } = await routerWithStore();
  await store.add({ name: "f1", url: "https://x/1?sig=a", description: "", timeoutMs: 3000, payloadSchema: "" });
  await find("POST", MS365_FLOWS_TOGGLE_PATH).handler({ body: { name: "f1", enabled: false } } as never);
  assert.equal(store.resolve("f1")?.enabled, false);
  await find("POST", MS365_FLOWS_TIMEOUT_PATH).handler({ body: { name: "f1", timeoutMs: 8000 } } as never);
  assert.equal(store.resolve("f1")?.timeoutMs, 8000);
  const res = await find("POST", MS365_FLOWS_DELETE_PATH).handler({ body: { name: "f1" } } as never);
  assert.deepEqual(res.data, { flows: [] });
});

test("POST /flows/update updates desc/timeout/schema; keeps url when blank; unknown → 400", async () => {
  const { store, find } = await routerWithStore();
  await store.add({ name: "f1", url: "https://x/1?sig=a", description: "d", timeoutMs: 5000, payloadSchema: "" });
  const upd = find("POST", MS365_FLOWS_UPDATE_PATH).handler;
  await upd({ body: { name: "f1", description: "d2", timeoutMs: 8000, payloadSchema: '{"type":"string"}' } } as never);
  assert.equal(store.resolve("f1")?.description, "d2");
  assert.equal(store.resolve("f1")?.payloadSchema, '{"type":"string"}');
  assert.equal(store.resolve("f1")?.url, "https://x/1?sig=a");
  await upd({ body: { name: "f1", description: "d3", timeoutMs: 8000, payloadSchema: "", url: "https://x/2?sig=b" } } as never);
  assert.equal(store.resolve("f1")?.url, "https://x/2?sig=b");
  await assert.rejects(() => upd({ body: { name: "ghost", description: "x", timeoutMs: 8000, payloadSchema: "" } } as never));
});

test("bad body → 400", async () => {
  const { find } = await routerWithStore();
  await assert.rejects(() => find("POST", MS365_FLOWS_PATH).handler({ body: { name: "f1" } } as never));
  await assert.rejects(() => find("POST", MS365_FLOWS_TOGGLE_PATH).handler({ body: { name: "f1" } } as never));
});
