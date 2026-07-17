/**
 * CGHC-013 — session logic unit test (S1).
 *
 * Proves create / continue / rename / list over the OpenCode-store SEAM, and that the app
 * holds only LIGHT, secret-free metadata (no transcript/content, no key bytes). No live
 * network/LLM: the store, health, and cancel seams are all in-memory fakes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionService } from "../src/session/index.js";
import { fakeStore, aliveHealth, recordingCanceller, FIXED_NOW } from "./session-fakes.js";

function makeService() {
  return createSessionService({
    store: fakeStore(),
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
}

test("create() persists light metadata and registers a live idle task (S1)", async () => {
  const service = makeService();
  const meta = await service.create({ workspaceId: "ws-1", title: "First" });

  assert.equal(meta.title, "First");
  assert.equal(meta.workspaceId, "ws-1");
  assert.equal(meta.status, "idle");
  assert.equal(meta.createdAt, FIXED_NOW());
  // A live view exists and is honestly empty (no fabricated completion).
  const view = service.view(meta.id);
  assert.ok(view, "view registered");
  assert.equal(view.status, "idle");
  assert.equal(view.terminal, null);
});

test("list() returns light metadata from the store — no transcript/content (S1)", async () => {
  const store = fakeStore();
  const service = createSessionService({
    store,
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  await service.create({ workspaceId: "ws-1", title: "A" });
  await service.create({ workspaceId: "ws-1", title: "B" });

  const list = await service.list();
  assert.equal(list.length, 2);
  // The metadata surface is exactly the light SessionMeta shape — no content field leaks.
  const keys = Object.keys(list[0] ?? {}).sort();
  assert.deepEqual(
    keys.filter((k) => k !== "model"),
    ["createdAt", "id", "status", "title", "updatedAt", "workspaceId"],
  );
});

test("continue() reopens an existing session and returns its metadata (S1)", async () => {
  const service = makeService();
  const created = await service.create({ workspaceId: "ws-1", title: "Cont" });

  const reopened = await service.continueSession(created.id);
  assert.equal(reopened.meta.id, created.id);
  assert.equal(reopened.meta.title, "Cont");
  assert.ok(service.view(created.id), "task re-registered on continue");
});

test("continue() of an unknown session id rejects", async () => {
  const service = makeService();
  await assert.rejects(() => service.continueSession("nope"), /No stored session/);
});

test("rename() updates the store and the light metadata (S1)", async () => {
  const service = makeService();
  const created = await service.create({ workspaceId: "ws-1", title: "Old" });

  const renamed = await service.rename(created.id, "New Title");
  assert.equal(renamed.title, "New Title");
  const list = await service.list();
  assert.equal(list.find((m) => m.id === created.id)?.title, "New Title");
});

test("a model ref is carried as a secret-free handle, never key bytes", async () => {
  const service = makeService();
  const meta = await service.create({
    workspaceId: "ws-1",
    title: "M",
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" },
  });
  const serialized = JSON.stringify(meta);
  assert.ok(serialized.includes("claude-3-5-sonnet-latest"), "model ref present");
  assert.ok(!/sk-ant-|api[_-]?key/i.test(serialized), "no secret material in metadata");
});
