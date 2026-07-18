import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPowerAutomateStore,
  DEFAULT_FLOW_TIMEOUT_MS,
  MAX_FLOW_TIMEOUT_MS,
  MIN_FLOW_TIMEOUT_MS,
  type PowerAutomateFlow,
  type PowerAutomatePersistence,
} from "../src/ms365/power-automate-store.js";

function memPersistence(initial: readonly PowerAutomateFlow[] | null): {
  persistence: PowerAutomatePersistence;
  saved: () => readonly PowerAutomateFlow[] | null;
} {
  let current = initial;
  return {
    persistence: {
      load: async () => current,
      save: async (flows) => {
        current = flows;
      },
    },
    saved: () => current,
  };
}

test("normalizes legacy entries missing enabled/timeoutMs", async () => {
  // Legacy file: only name+url (cast through PowerAutomateFlow shape).
  const legacy = [{ name: "old", url: "https://x/y?sig=a" }] as unknown as PowerAutomateFlow[];
  const { persistence } = memPersistence(legacy);
  const store = await createPowerAutomateStore({ persistence });
  const [flow] = store.list();
  assert.equal(flow.enabled, true);
  assert.equal(flow.timeoutMs, DEFAULT_FLOW_TIMEOUT_MS);
});

test("add appends enabled flow and rejects duplicate name", async () => {
  const { persistence, saved } = memPersistence([]);
  const store = await createPowerAutomateStore({ persistence });
  await store.add({ name: "f1", url: "https://x/1?sig=a", description: "", timeoutMs: 5000, payloadSchema: "" });
  assert.deepEqual(store.list(), [{ name: "f1", url: "https://x/1?sig=a", enabled: true, timeoutMs: 5000, description: "", payloadSchema: "" }]);
  assert.equal((saved() ?? []).length, 1);
  await assert.rejects(() => store.add({ name: "f1", url: "https://x/2?sig=b", description: "", timeoutMs: 5000, payloadSchema: "" }));
});

test("remove, setEnabled, setTimeout persist", async () => {
  const { persistence } = memPersistence([]);
  const store = await createPowerAutomateStore({ persistence });
  await store.add({ name: "f1", url: "https://x/1?sig=a", description: "", timeoutMs: 5000, payloadSchema: "" });
  await store.setEnabled("f1", false);
  assert.equal(store.resolve("f1")?.enabled, false);
  await store.setTimeout("f1", 9000);
  assert.equal(store.resolve("f1")?.timeoutMs, 9000);
  await store.remove("f1");
  assert.equal(store.resolve("f1"), null);
  assert.deepEqual(store.list(), []);
});

test("clamps timeout out of range", async () => {
  const { persistence } = memPersistence([]);
  const store = await createPowerAutomateStore({ persistence });
  await store.add({ name: "lo", url: "https://x/1?sig=a", description: "", timeoutMs: 10, payloadSchema: "" });
  await store.add({ name: "hi", url: "https://x/2?sig=b", description: "", timeoutMs: 10_000_000, payloadSchema: "" });
  assert.equal(store.resolve("lo")?.timeoutMs, MIN_FLOW_TIMEOUT_MS);
  assert.equal(store.resolve("hi")?.timeoutMs, MAX_FLOW_TIMEOUT_MS);
});

test("normalizes legacy entries missing description", async () => {
  const legacy = [{ name: "old", url: "https://x/y?sig=a", enabled: true, timeoutMs: 5000 }] as unknown as PowerAutomateFlow[];
  const store = await createPowerAutomateStore({ persistence: { load: async () => legacy, save: async () => {} } });
  assert.equal(store.list()[0]!.description, "");
});

test("add stores description; update replaces desc/timeout and keeps url when blank", async () => {
  let saved: readonly PowerAutomateFlow[] = [];
  const store = await createPowerAutomateStore({ persistence: { load: async () => [], save: async (f) => { saved = f; } } });
  await store.add({ name: "f1", url: "https://x/1?sig=a", description: "send mail", timeoutMs: 5000, payloadSchema: "" });
  assert.equal(store.resolve("f1")?.description, "send mail");
  await store.update("f1", { description: "updated", timeoutMs: 9000, payloadSchema: "" }); // no url → keep
  assert.equal(store.resolve("f1")?.description, "updated");
  assert.equal(store.resolve("f1")?.timeoutMs, 9000);
  assert.equal(store.resolve("f1")?.url, "https://x/1?sig=a");
  await store.update("f1", { description: "u2", timeoutMs: 9000, payloadSchema: "", url: "https://x/2?sig=b" }); // url → replace
  assert.equal(store.resolve("f1")?.url, "https://x/2?sig=b");
  assert.equal(saved.length, 1);
});

test("update throws for unknown name", async () => {
  const store = await createPowerAutomateStore({ persistence: { load: async () => [], save: async () => {} } });
  await assert.rejects(() => store.update("nope", { description: "x", timeoutMs: 5000, payloadSchema: "" }));
});

test("payloadSchema: legacy default, add stores, update replaces", async () => {
  const legacy = [{ name: "old", url: "https://x/y?sig=a", enabled: true, timeoutMs: 5000, description: "d" }] as unknown as PowerAutomateFlow[];
  const store = await createPowerAutomateStore({ persistence: { load: async () => legacy, save: async () => {} } });
  assert.equal(store.list()[0]!.payloadSchema, "");
  await store.add({ name: "f1", url: "https://x/1?sig=a", description: "d", timeoutMs: 5000, payloadSchema: '{"type":"object"}' });
  assert.equal(store.resolve("f1")?.payloadSchema, '{"type":"object"}');
  await store.update("f1", { description: "d", timeoutMs: 5000, payloadSchema: '{"type":"string"}' });
  assert.equal(store.resolve("f1")?.payloadSchema, '{"type":"string"}');
});
