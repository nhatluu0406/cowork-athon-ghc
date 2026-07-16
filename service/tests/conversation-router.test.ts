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
import type { ProviderProfileStore } from "../src/provider-profiles/provider-profile-store.js";
import type { CredentialService } from "../src/credential/credential-service.js";

const NOW = (): string => "2026-07-12T08:00:00.000Z";

/** Minimal active-profile store: only activeProfile() is exercised by compaction. */
function stubProfiles(): ProviderProfileStore {
  const profile = {
    id: "p1",
    displayName: "Fixture",
    providerType: "openai_compatible" as const,
    baseUrl: "http://127.0.0.1:9/v1",
    modelId: "fixture-model",
    envVar: "FIXTURE_API_KEY",
    createdAt: NOW(),
    updatedAt: NOW(),
  };
  return { activeProfile: () => profile } as unknown as ProviderProfileStore;
}

const stubCredentials = (): CredentialService =>
  ({ resolveInjection: async () => ({ value: "unused" }) }) as unknown as CredentialService;

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

test("compaction preserves a message appended while the summary was being produced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-window-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const created = await store.create({ workspacePath: "C:/fixture/ws" });

  await store.appendMessage(created.id, { role: "user", text: "old turn" });
  const snapshot = await store.get(created.id);
  const boundaryId = snapshot!.messages.at(-1)!.id;

  // The compaction round-trip is in flight; a streaming turn lands in the meantime.
  await store.appendMessage(created.id, { role: "assistant", text: "arrived mid-compaction" });

  const compacted = await store.compact(created.id, "tóm tắt", boundaryId);

  // The summary replaces only what was summarized; the late message survives after it.
  assert.equal(compacted.messages.length, 2);
  assert.match(compacted.messages[0]!.text, /tóm tắt/);
  assert.equal(compacted.messages[1]!.text, "arrived mid-compaction");
  assert.equal(compacted.messageCount, 2);

  // The index must agree with the record, not report a stale count.
  const listed = await store.list();
  assert.equal(listed.find((c) => c.id === created.id)?.messageCount, 2);

  await rm(dir, { recursive: true, force: true });
});

test("compaction refuses to drop history when its boundary message is gone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-boundary-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const created = await store.create({ workspacePath: "C:/fixture/ws" });
  await store.appendMessage(created.id, { role: "user", text: "keep me" });

  await assert.rejects(
    () => store.compact(created.id, "tóm tắt", "00000000-0000-0000-0000-000000000000"),
    /refusing to drop history/,
  );

  const after = await store.get(created.id);
  assert.equal(after?.messages.length, 1);
  assert.equal(after?.messages[0]?.text, "keep me");

  await rm(dir, { recursive: true, force: true });
});

test("concurrent writes to one conversation never publish truncated json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-race-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const created = await store.create({ workspacePath: "C:/fixture/ws" });

  // A shared temp filename would let one rename publish another's half-written bytes.
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.appendMessage(created.id, { role: "user", text: `msg ${i}` }),
    ),
  );

  // The record must still parse — that is what a torn write destroys.
  const after = await store.get(created.id);
  assert.ok(after, "record must still be readable after concurrent writes");
  assert.ok(after.messages.length >= 1);
  await store.list();

  await rm(dir, { recursive: true, force: true });
});

test("conversation router compacts a conversation history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-compact-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const router = createConversationRouter(store);
  
  const createRoute = router.routes.find((r) => r.method === "POST" && r.path === "/v1/conversations");
  const created = await createRoute!.handler({
    method: "POST",
    url: new URL("http://127.0.0.1/v1/conversations"),
    params: {},
    body: { workspacePath: "C:/fixture/ws" },
  });
  const id = (created.data as { conversation: { id: string } }).conversation.id;

  const msgRoute = router.routes.find((r) => r.method === "POST" && r.path === "/v1/conversations/{id}/messages");
  await msgRoute!.handler({
    method: "POST",
    url: new URL(`http://127.0.0.1/v1/conversations/${id}/messages`),
    params: { id },
    body: { role: "user", text: "Hello" },
  });

  const compactRoute = router.routes.find((r) => r.method === "POST" && r.path === "/v1/conversations/{id}/compact");
  assert.ok(compactRoute);
  
  const compacted = await compactRoute!.handler({
    method: "POST",
    url: new URL(`http://127.0.0.1/v1/conversations/${id}/compact`),
    params: { id },
    body: undefined,
  });

  assert.equal(compacted.status, 200);
  const data = compacted.data as { summary: string; conversation: { messages: Array<{ text: string }> } };
  assert.equal(data.summary, "Lịch sử hội thoại đã được nén cục bộ.");
  assert.equal(data.conversation.messages.length, 1);
  assert.ok(data.conversation.messages[0].text.includes("Lịch sử hội thoại đã được nén cục bộ."));

  await rm(dir, { recursive: true, force: true });
});

test("a failed provider call preserves the transcript instead of faking a compaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-conv-compact-fail-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  // Port 9 (discard) never answers HTTP, so the compaction fetch fails.
  const router = createConversationRouter(store, stubProfiles(), stubCredentials());

  const createRoute = router.routes.find((r) => r.method === "POST" && r.path === "/v1/conversations");
  const created = await createRoute!.handler({
    method: "POST",
    url: new URL("http://127.0.0.1/v1/conversations"),
    params: {},
    body: { workspacePath: "C:/fixture/ws" },
  });
  const id = (created.data as { conversation: { id: string } }).conversation.id;

  const msgRoute = router.routes.find((r) => r.method === "POST" && r.path === "/v1/conversations/{id}/messages");
  await msgRoute!.handler({
    method: "POST",
    url: new URL(`http://127.0.0.1/v1/conversations/${id}/messages`),
    params: { id },
    body: { role: "user", text: "irreplaceable history" },
  });

  const compactRoute = router.routes.find((r) => r.method === "POST" && r.path === "/v1/conversations/{id}/compact");
  await assert.rejects(
    () =>
      compactRoute!.handler({
        method: "POST",
        url: new URL(`http://127.0.0.1/v1/conversations/${id}/compact`),
        params: { id },
        body: undefined,
      }),
    /Lịch sử được giữ nguyên/,
  );

  // The whole point: the user's transcript survived the failure.
  const after = await store.get(id);
  assert.equal(after?.messages.length, 1);
  assert.equal(after?.messages[0]?.text, "irreplaceable history");

  await rm(dir, { recursive: true, force: true });
});

