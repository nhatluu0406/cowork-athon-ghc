/**
 * Recent-workspaces list test (CGHC-008, W2 SHOULD).
 *
 * The MRU list is the single source of truth for recently-opened workspaces. A recorded folder
 * that no longer exists (renamed/removed after it was opened) must be reported `available: false`
 * (UNAVAILABLE) at render time — never silently dropped and never crashing the list. Also proves
 * MRU ordering, de-duplication of the same path, capacity eviction, and that a probe that THROWS
 * degrades to unavailable rather than blowing up the render.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorkspaceGrant } from "@cowork-ghc/contracts";
import {
  createRecentWorkspaces,
  nodeExistenceProbe,
  type RecentExistenceProbe,
} from "../src/workspace/index.js";

function grant(id: string, rootPath: string, iso: string): WorkspaceGrant {
  return { id, rootPath, grantedAt: iso };
}

test("production nodeExistenceProbe: a directory is available, a FILE or missing path is not (review LOW)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cghc-recent-"));
  const file = path.join(dir, "not-a-dir.txt");
  await writeFile(file, "x", "utf8");
  try {
    assert.equal(await nodeExistenceProbe(dir), true, "a real directory is available");
    assert.equal(await nodeExistenceProbe(file), false, "a recent entry that became a FILE is unavailable");
    assert.equal(await nodeExistenceProbe(path.join(dir, "gone")), false, "a missing path is unavailable, never throws");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a recent entry whose folder no longer exists is reported unavailable, not dropped", async () => {
  const recent = createRecentWorkspaces();
  recent.record(grant("a", "/ws/alive", "2026-01-01T00:00:00.000Z"));
  recent.record(grant("b", "/ws/gone", "2026-01-02T00:00:00.000Z"));

  const existing = new Set(["/ws/alive"]);
  const probe: RecentExistenceProbe = async (p) => existing.has(p);

  const view = await recent.listWithAvailability(probe);
  // Both entries are still present (nothing silently dropped); MRU: most-recent ("b") first.
  assert.deepEqual(
    view.map((e) => e.rootPath),
    ["/ws/gone", "/ws/alive"],
  );
  const gone = view.find((e) => e.rootPath === "/ws/gone");
  const alive = view.find((e) => e.rootPath === "/ws/alive");
  assert.equal(gone?.available, false, "a removed/renamed folder is UNAVAILABLE, not dropped");
  assert.equal(alive?.available, true);
});

test("a probe that throws degrades to unavailable without crashing the render", async () => {
  const recent = createRecentWorkspaces();
  recent.record(grant("a", "/ws/one", "2026-01-01T00:00:00.000Z"));
  const throwing: RecentExistenceProbe = async () => {
    throw new Error("probe blew up");
  };
  const view = await recent.listWithAvailability(throwing);
  assert.equal(view.length, 1);
  assert.equal(view[0]?.available, false);
});

test("recording the same path de-dupes and moves it to the front (MRU)", async () => {
  let clock = 0;
  const recent = createRecentWorkspaces({ now: () => new Date(1_700_000_000_000 + clock++ * 1000) });
  recent.record(grant("a", "/ws/one", "x"));
  recent.record(grant("b", "/ws/two", "x"));
  recent.record(grant("a2", "/ws/one", "x")); // same path, new id
  const list = recent.list();
  assert.deepEqual(
    list.map((e) => e.rootPath),
    ["/ws/one", "/ws/two"],
    "de-duped and moved to front",
  );
  assert.equal(list[0]?.id, "a2", "the latest record wins for the deduped path");
});

test("capacity evicts the oldest entries", async () => {
  const recent = createRecentWorkspaces({ capacity: 2 });
  recent.record(grant("a", "/ws/1", "x"));
  recent.record(grant("b", "/ws/2", "x"));
  recent.record(grant("c", "/ws/3", "x"));
  assert.deepEqual(
    recent.list().map((e) => e.rootPath),
    ["/ws/3", "/ws/2"],
  );
});

test("remove deletes an entry by id", () => {
  const recent = createRecentWorkspaces();
  recent.record(grant("a", "/ws/1", "x"));
  assert.equal(recent.remove("a"), true);
  assert.equal(recent.remove("a"), false);
  assert.equal(recent.list().length, 0);
});
