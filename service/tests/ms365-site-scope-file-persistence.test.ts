import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSiteScopeFilePersistence } from "../src/ms365/site-scope-file-persistence.js";

test("save then load round-trips records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-sitescope-"));
  const p = createSiteScopeFilePersistence(join(dir, "sites.json"));
  await p.save([{ siteId: "s1", enabled: false }]);
  assert.deepEqual(await p.load(), [{ siteId: "s1", enabled: false }]);
});

test("load returns [] for a missing file (no throw)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-sitescope-"));
  const p = createSiteScopeFilePersistence(join(dir, "does-not-exist.json"));
  assert.deepEqual(await p.load(), []);
});

test("load returns [] for corrupt JSON (no throw)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-sitescope-"));
  const file = join(dir, "sites.json");
  await (await import("node:fs/promises")).writeFile(file, "{ not json", "utf8");
  const p = createSiteScopeFilePersistence(file);
  assert.deepEqual(await p.load(), []);
});
