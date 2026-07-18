/**
 * Write-mode store: default manual, persist on change, corrupt file falls back to manual,
 * and the router's GET/POST /v1/ms365/write-mode routes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createWriteModeStore,
  type Ms365WriteMode,
  type WriteModePersistence,
} from "../src/ms365/write-mode-store.js";
import { createWriteModeFilePersistence } from "../src/ms365/write-mode-file-persistence.js";
import {
  createMs365Router,
  MS365_WRITE_MODE_PATH,
  Ms365RouterRequestError,
  type Ms365RouterDeps,
} from "../src/ms365/ms365-tool-router.js";
import { createMs365SessionScope } from "../src/ms365/ms365-session-scope.js";

function memoryPersistence(initial: Ms365WriteMode | null = null): WriteModePersistence & {
  saved: Ms365WriteMode[];
} {
  let value = initial;
  const saved: Ms365WriteMode[] = [];
  return {
    saved,
    load: () => Promise.resolve(value),
    save: (mode) => {
      value = mode;
      saved.push(mode);
      return Promise.resolve();
    },
  };
}

test("store defaults to manual when persistence is empty", async () => {
  const store = await createWriteModeStore({ persistence: memoryPersistence() });
  assert.equal(store.mode(), "manual");
});

test("store loads persisted auto mode", async () => {
  const store = await createWriteModeStore({ persistence: memoryPersistence("auto") });
  assert.equal(store.mode(), "auto");
});

test("setMode persists and updates mode()", async () => {
  const persistence = memoryPersistence();
  const store = await createWriteModeStore({ persistence });
  await store.setMode("auto");
  assert.equal(store.mode(), "auto");
  assert.deepEqual(persistence.saved, ["auto"]);
});

test("file persistence: missing file loads null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-write-mode-"));
  const p = createWriteModeFilePersistence(join(dir, "ms365-write-mode.json"));
  assert.equal(await p.load(), null);
});

test("file persistence: corrupt file loads null (never throws)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-write-mode-"));
  const filePath = join(dir, "ms365-write-mode.json");
  await writeFile(filePath, "{not json", "utf8");
  const p = createWriteModeFilePersistence(filePath);
  assert.equal(await p.load(), null);
});

test("file persistence: unknown mode value loads null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-write-mode-"));
  const filePath = join(dir, "ms365-write-mode.json");
  await writeFile(filePath, JSON.stringify({ mode: "yolo" }), "utf8");
  const p = createWriteModeFilePersistence(filePath);
  assert.equal(await p.load(), null);
});

test("file persistence: save round-trips through load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-write-mode-"));
  const filePath = join(dir, "nested", "ms365-write-mode.json");
  const p = createWriteModeFilePersistence(filePath);
  await p.save("auto");
  assert.equal(await p.load(), "auto");
  const raw = JSON.parse(await readFile(filePath, "utf8")) as { mode?: unknown };
  assert.equal(raw.mode, "auto");
});

function buildRouterDeps(): Ms365RouterDeps {
  const sites = [
    { id: "s1", displayName: "A", webUrl: "u1", enabled: true },
    { id: "s2", displayName: "B", webUrl: "u2", enabled: true },
  ];
  return {
    connector: {} as Ms365RouterDeps["connector"],
    scopes: [],
    tools: {} as Ms365RouterDeps["tools"],
    siteScope: {
      listJoinedSites: async () => sites,
      setSiteEnabled: async (id, enabled) => {
        const s = sites.find((x) => x.id === id);
        if (s) s.enabled = enabled;
      },
      enabledSiteIds: () => sites.filter((s) => s.enabled).map((s) => s.id),
      isEnabled: (id) => sites.find((s) => s.id === id)?.enabled ?? true,
    },
    writeMode: { mode: () => "manual" as const, setMode: async () => {} },
    sessionScope: createMs365SessionScope(),
  };
}

function findRoute(router: ReturnType<typeof createMs365Router>, method: string, path: string) {
  const route = router.routes.find((r) => r.method === method && r.path === path);
  assert.ok(route, `route ${method} ${path} must exist`);
  return route!;
}

test("GET /v1/ms365/write-mode returns the current mode", async () => {
  const store = await createWriteModeStore({ persistence: memoryPersistence() });
  const router = createMs365Router({ ...buildRouterDeps(), writeMode: store });
  const route = findRoute(router, "GET", MS365_WRITE_MODE_PATH);
  const result = await route.handler({ body: undefined } as unknown as Parameters<typeof route.handler>[0]);
  assert.deepEqual(result.data, { mode: "manual" });
});

test("POST /v1/ms365/write-mode switches mode and persists", async () => {
  const persistence = memoryPersistence();
  const store = await createWriteModeStore({ persistence });
  const router = createMs365Router({ ...buildRouterDeps(), writeMode: store });
  const route = findRoute(router, "POST", MS365_WRITE_MODE_PATH);
  const result = await route.handler({ body: { mode: "auto" } } as unknown as Parameters<typeof route.handler>[0]);
  assert.deepEqual(result.data, { mode: "auto" });
  assert.equal(store.mode(), "auto");
  assert.deepEqual(persistence.saved, ["auto"]);
});

test("POST /v1/ms365/write-mode rejects an unknown mode with a 400-mapped error", async () => {
  const store = await createWriteModeStore({ persistence: memoryPersistence() });
  const router = createMs365Router({ ...buildRouterDeps(), writeMode: store });
  const route = findRoute(router, "POST", MS365_WRITE_MODE_PATH);
  await assert.rejects(
    async () => route.handler({ body: { mode: "yolo" } } as unknown as Parameters<typeof route.handler>[0]),
    Ms365RouterRequestError,
  );
  assert.equal(store.mode(), "manual");
});
