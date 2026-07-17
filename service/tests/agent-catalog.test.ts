import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentCatalog, type AgentStoreFs } from "../src/agents/catalog.js";

const BASE_POLICY: Record<string, string> = {
  read: "allow",
  edit: "ask",
  bash: "deny",
  task: "deny",
};

function memoryFs(seed?: string): AgentStoreFs & { readonly data: string | undefined } {
  const state = { data: seed };
  return {
    get data() {
      return state.data;
    },
    read: async () => state.data,
    write: async (d: string) => {
      state.data = d;
    },
  };
}

test("built-in agents are present, read-only, and valid", async () => {
  const catalog = await createAgentCatalog({ fs: memoryFs(), basePolicy: BASE_POLICY });
  const ids = catalog.list().map((a) => a.id);
  assert.deepEqual(ids, ["researcher", "implementer", "reviewer"]);
  await assert.rejects(() => catalog.deleteUserAgent("researcher"), /read-only/);
  await assert.rejects(
    () => catalog.updateUserAgent("reviewer", { name: "x", systemPrompt: "y" }),
    /read-only/,
  );
});

test("create + update + delete a user agent persists through the fs seam", async () => {
  const fs = memoryFs();
  const catalog = await createAgentCatalog({ fs, basePolicy: BASE_POLICY });
  const created = await catalog.createUserAgent({
    name: "Trợ lý Tài liệu",
    systemPrompt: "viết tài liệu",
    permissionPreset: { edit: "ask" },
  });
  assert.match(created.id, /^[a-z0-9-]+$/);
  assert.equal(created.source, "user_local");
  assert.ok(fs.data && fs.data.includes(created.id));

  const updated = await catalog.updateUserAgent(created.id, {
    name: "Trợ lý Tài liệu v2",
    systemPrompt: "viết tài liệu tốt hơn",
  });
  assert.equal(updated.name, "Trợ lý Tài liệu v2");

  await catalog.deleteUserAgent(created.id);
  assert.equal(catalog.get(created.id), undefined);
});

test("a user agent cannot loosen the live policy or shadow a built-in id", async () => {
  const catalog = await createAgentCatalog({ fs: memoryFs(), basePolicy: BASE_POLICY });
  await assert.rejects(
    () =>
      catalog.createUserAgent({
        name: "Rogue",
        systemPrompt: "re-enable bash",
        permissionPreset: { bash: "allow" },
      }),
    /narrow/,
  );
  await assert.rejects(
    () => catalog.createUserAgent({ id: "researcher", name: "Fake", systemPrompt: "x" }),
    /built-in/,
  );
});

test("corrupt or looser persisted agents are dropped on load, built-ins survive", async () => {
  // A persisted doc containing a looser agent + a valid one; the looser one must be discarded.
  const doc = JSON.stringify({
    version: 1,
    agents: [
      { id: "loose", name: "Loose", source: "user_local", systemPrompt: "p", skillIds: [], permissionPreset: { bash: "allow" } },
      { id: "ok-agent", name: "OK", source: "user_local", systemPrompt: "p", skillIds: [], permissionPreset: { edit: "deny" } },
    ],
  });
  const catalog = await createAgentCatalog({ fs: memoryFs(doc), basePolicy: BASE_POLICY });
  const ids = catalog.list().map((a) => a.id);
  assert.ok(ids.includes("ok-agent"));
  assert.ok(!ids.includes("loose"));
  assert.ok(ids.includes("researcher"));

  // A completely corrupt store loads as empty (built-ins only), never throws.
  const corrupt = await createAgentCatalog({ fs: memoryFs("{not json"), basePolicy: BASE_POLICY });
  assert.equal(corrupt.list().length, 3);
});

test("knownIds includes built-ins and user agents for task validation", async () => {
  const catalog = await createAgentCatalog({ fs: memoryFs(), basePolicy: BASE_POLICY });
  await catalog.createUserAgent({ id: "mine", name: "Mine", systemPrompt: "p" });
  const ids = catalog.knownIds();
  assert.ok(ids.has("implementer"));
  assert.ok(ids.has("mine"));
});
