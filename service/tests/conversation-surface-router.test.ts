/**
 * Conversation HTTP router — surface filter on GET list + surface on POST create.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConversationStore } from "../src/conversation/store.js";
import { createConversationRouter, CONVERSATIONS_PATH } from "../src/conversation/router.js";

const NOW = (): string => "2026-07-16T08:00:00.000Z";

test("router: create accepts surface and list filters by it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-surface-router-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const router = createConversationRouter(store);

  const createRoute = router.routes.find((r) => r.method === "POST" && r.path === CONVERSATIONS_PATH);
  assert.ok(createRoute);
  const listRoute = router.routes.find((r) => r.method === "GET" && r.path === CONVERSATIONS_PATH);
  assert.ok(listRoute);

  await createRoute!.handler({
    method: "POST",
    url: new URL("http://127.0.0.1/v1/conversations"),
    params: {},
    body: { workspacePath: "C:/fixture/ws", surface: "ms365", title: "M" },
  });
  await createRoute!.handler({
    method: "POST",
    url: new URL("http://127.0.0.1/v1/conversations"),
    params: {},
    body: { workspacePath: "C:/fixture/ws", title: "C" },
  });

  const coworkRes = await listRoute!.handler({
    method: "GET",
    url: new URL("http://127.0.0.1/v1/conversations?surface=cowork"),
    params: {},
    body: undefined,
  });
  const ms365Res = await listRoute!.handler({
    method: "GET",
    url: new URL("http://127.0.0.1/v1/conversations?surface=ms365"),
    params: {},
    body: undefined,
  });
  const allRes = await listRoute!.handler({
    method: "GET",
    url: new URL("http://127.0.0.1/v1/conversations"),
    params: {},
    body: undefined,
  });

  const coworkTitles = (coworkRes.data as { conversations: { title: string }[] }).conversations.map((c) => c.title);
  const ms365Titles = (ms365Res.data as { conversations: { title: string }[] }).conversations.map((c) => c.title);
  const allTitles = (allRes.data as { conversations: { title: string }[] }).conversations.map((c) => c.title);

  assert.deepEqual(coworkTitles, ["C"]);
  assert.deepEqual(ms365Titles, ["M"]);
  assert.deepEqual(allTitles.sort(), ["C", "M"]);
});

test("router: create rejects invalid surface", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-surface-router-invalid-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const router = createConversationRouter(store);
  const createRoute = router.routes.find((r) => r.method === "POST" && r.path === CONVERSATIONS_PATH);
  assert.ok(createRoute);

  await assert.rejects(
    createRoute!.handler({
      method: "POST",
      url: new URL("http://127.0.0.1/v1/conversations"),
      params: {},
      body: { workspacePath: "C:/fixture/ws", surface: "bogus" },
    }),
  );
});
