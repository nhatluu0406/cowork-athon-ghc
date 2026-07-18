import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSiteScopeStore,
  type SiteEnabledRecord,
  type SiteScopePersistence,
} from "../src/ms365/site-scope-store.js";

function fakePersistence(initial: SiteEnabledRecord[] = []): SiteScopePersistence & { saved: SiteEnabledRecord[][] } {
  let current = [...initial];
  const saved: SiteEnabledRecord[][] = [];
  return {
    saved,
    load: async () => [...current],
    save: async (records) => {
      current = [...records];
      saved.push([...records]);
    },
  };
}

test("a newly seen site defaults to ENABLED and is persisted", async () => {
  const p = fakePersistence();
  const store = await createSiteScopeStore({ persistence: p });
  const enabled = await store.seenSite("site-A");
  assert.equal(enabled, true);
  assert.equal(store.isEnabled("site-A"), true);
  assert.deepEqual(p.saved.at(-1), [{ siteId: "site-A", enabled: true }]);
});

test("setEnabled(false) disables a site and persists it", async () => {
  const p = fakePersistence([{ siteId: "site-A", enabled: true }]);
  const store = await createSiteScopeStore({ persistence: p });
  await store.setEnabled("site-A", false);
  assert.equal(store.isEnabled("site-A"), false);
  assert.deepEqual(store.enabledSiteIds(), []);
  assert.deepEqual(p.saved.at(-1), [{ siteId: "site-A", enabled: false }]);
});

test("isEnabled returns true (default-enabled) for a site never seen", async () => {
  const store = await createSiteScopeStore({ persistence: fakePersistence() });
  assert.equal(store.isEnabled("unknown"), true);
});

test("loaded records survive and are reflected in enabledSiteIds", async () => {
  const store = await createSiteScopeStore({
    persistence: fakePersistence([
      { siteId: "a", enabled: true },
      { siteId: "b", enabled: false },
    ]),
  });
  assert.deepEqual(store.enabledSiteIds().sort(), ["a"]);
});
