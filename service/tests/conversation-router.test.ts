/**
 * Conversation HTTP router — CRUD + message append.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConversationStore } from "../src/conversation/store.js";
import { createConversationRouter } from "../src/conversation/router.js";

const NOW = (): string => "2026-07-12T08:00:00.000Z";

test("conversation router creates, lists, patches, and deletes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-router-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const router = createConversationRouter(store);
  const createRoute = router.routes.find((r) => r.method === "POST" && r.path === "/v1/conversations");
  assert.ok(createRoute);
  const created = await createRoute!.handler({
    method: "POST",
    url: new URL("http://127.0.0.1/v1/conversations"),
    params: {},
    body: { workspacePath: "C:/fixture/ws" },
  });
  assert.equal(created.status, 201);
  const id = (created.data as { conversation: { id: string } }).conversation.id;

  const listRoute = router.routes.find((r) => r.method === "GET" && r.path === "/v1/conversations");
  const listed = await listRoute!.handler({
    method: "GET",
    url: new URL("http://127.0.0.1/v1/conversations"),
    params: {},
    body: undefined,
  });
  assert.equal((listed.data as { conversations: unknown[] }).conversations.length, 1);

  const patchRoute = router.routes.find((r) => r.method === "PATCH");
  const patched = await patchRoute!.handler({
    method: "PATCH",
    url: new URL(`http://127.0.0.1/v1/conversations/${id}`),
    params: { id },
    body: { title: "My chat" },
  });
  assert.equal((patched.data as { conversation: { title: string } }).conversation.title, "My chat");

  const linked = await patchRoute!.handler({
    method: "PATCH",
    url: new URL(`http://127.0.0.1/v1/conversations/${id}`),
    params: { id },
    body: { runtimeSessionId: "rt-2", status: "ready" },
  });
  const linkedConv = (linked.data as { conversation: { runtimeSessionId: string | null; status: string } })
    .conversation;
  assert.equal(linkedConv.runtimeSessionId, "rt-2");
  assert.equal(linkedConv.status, "ready");

  const deleteRoute = router.routes.find((r) => r.method === "DELETE");
  const deleted = await deleteRoute!.handler({
    method: "DELETE",
    url: new URL(`http://127.0.0.1/v1/conversations/${id}`),
    params: { id },
    body: undefined,
  });
  assert.equal((deleted.data as { deleted: boolean }).deleted, true);
  await rm(dir, { recursive: true, force: true });
});
