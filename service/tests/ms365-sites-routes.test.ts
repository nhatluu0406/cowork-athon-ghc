import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMs365Router,
  MS365_SITES_PATH,
  MS365_SITES_TOGGLE_PATH,
  type Ms365RouterDeps,
} from "../src/ms365/ms365-tool-router.js";
import type { RouteContext } from "../src/boundary/contract.js";

function baseDeps(): Ms365RouterDeps {
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
  };
}

function findRoute(router: ReturnType<typeof createMs365Router>, method: string, path: string) {
  const route = router.routes.find((r) => r.method === method && r.path === path);
  assert.ok(route, `route ${method} ${path} exists`);
  return route!;
}

test("GET /v1/ms365/sites returns joined sites", async () => {
  const router = createMs365Router(baseDeps());
  const route = findRoute(router, "GET", MS365_SITES_PATH);
  const res = await route.handler({ body: undefined } as unknown as RouteContext);
  assert.equal(res.status, 200);
  assert.equal((res.data as { sites: unknown[] }).sites.length, 2);
});

test("POST /v1/ms365/sites/toggle disables a site and returns refreshed list", async () => {
  const router = createMs365Router(baseDeps());
  const route = findRoute(router, "POST", MS365_SITES_TOGGLE_PATH);
  const res = await route.handler({ body: { siteId: "s2", enabled: false } } as unknown as RouteContext);
  assert.equal(res.status, 200);
  const sites = (res.data as { sites: Array<{ id: string; enabled: boolean }> }).sites;
  assert.equal(sites.find((s) => s.id === "s2")?.enabled, false);
});

test("POST toggle rejects a malformed body", async () => {
  const router = createMs365Router(baseDeps());
  const route = findRoute(router, "POST", MS365_SITES_TOGGLE_PATH);
  await assert.rejects(() => route.handler({ body: { siteId: "s2" } } as unknown as RouteContext));
});
