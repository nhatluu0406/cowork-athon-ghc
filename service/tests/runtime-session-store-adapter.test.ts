/**
 * CGHC-028 Wave A2 — LIVE {@link SessionStore} adapter over a FAKE OpenCode HTTP server.
 *
 * Drives create → list → get → rename round-trips against a real loopback `http.Server`, proves
 * `replay` returns frames the REAL CGHC-012 `createEvMapper` folds into a NON-EMPTY `SessionView`
 * (so the rebuilt view matches the live path), and proves a non-2xx surfaces as a TYPED error.
 * No real OpenCode binary, socket auth, network, or secret.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpencodeHttp, createOpencodeSessionStore, OpencodeHttpError } from "../src/runtime/index.js";
import { createEvMapper, initialSessionView, reduceEv, type SessionView } from "../src/execution/index.js";
import { startFakeOpencodeServer, type FakeOpencodeServer } from "./opencode-fake-server.js";

const WS = "C:/Users/test/Live Workspace";
const NOW = () => "2026-07-11T00:00:00.000Z";

function storeFor(fake: FakeOpencodeServer) {
  const http = createOpencodeHttp({ baseUrl: () => fake.baseUrl, timeoutMs: 4_000 });
  return createOpencodeSessionStore({ http, workspaceId: WS, now: NOW });
}

test("create → list → get → rename round-trips through the live HTTP seam", async () => {
  const fake = await startFakeOpencodeServer();
  try {
    const store = storeFor(fake);

    const created = await store.create({ workspaceId: WS, title: "First run" });
    assert.equal(created.title, "First run");
    assert.equal(created.workspaceId, WS);
    assert.ok(created.id.length > 0);
    // Epoch-millis time block is mapped to ISO.
    assert.equal(created.createdAt, new Date(1_783_757_969_956).toISOString());

    const listed = await store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, created.id);
    assert.equal(listed[0]?.workspaceId, WS);

    const got = await store.get(created.id);
    assert.equal(got?.id, created.id);
    assert.equal(await store.get("ses_missing"), undefined); // 404 → soft undefined

    const renamed = await store.rename(created.id, "Renamed");
    assert.equal(renamed.title, "Renamed");
    // The PATCH really hit the child.
    assert.ok(fake.requests.some((r) => r.method === "PATCH" && r.path === `/session/${created.id}`));
  } finally {
    await fake.close();
  }
});

test("replay returns frames the REAL ev-mapper folds into a non-empty SessionView", async () => {
  const fake = await startFakeOpencodeServer();
  try {
    const store = storeFor(fake);
    const created = await store.create({ workspaceId: WS, title: "Replay" });
    const sid = created.id;

    // Seed OpenCode's message store: a completed `write` tool + a step. `replay` must SYNTHESIZE
    // `message.part.updated` frames from these parts.
    fake.state.messages.set(sid, [
      {
        info: { id: "msg1", role: "assistant", sessionID: sid },
        parts: [
          { type: "step-start", id: "prt_step", messageID: "msg1", sessionID: sid },
          {
            type: "tool",
            id: "prt_tool",
            callID: "call1",
            tool: "write",
            messageID: "msg1",
            sessionID: sid,
            state: { status: "completed", input: { filePath: "C:/ws/out.txt" } },
          },
        ],
      },
    ]);

    const frames = await store.replay(sid);
    assert.ok(frames.length >= 2, "replay yields one frame per stored part");
    // Each frame is the exact envelope the mapper understands.
    assert.deepEqual((frames[0] as { type: string }).type, "message.part.updated");

    // Fold through the REAL mapper + reducer (identical to the live path).
    const mapper = createEvMapper({ sessionId: sid, now: NOW });
    let view: SessionView = initialSessionView(sid);
    for (const frame of frames) for (const ev of mapper.map(frame)) view = reduceEv(view, ev);

    assert.ok(view.toolCalls.length > 0, "the write tool call is reconstructed");
    assert.ok(view.fileMutations.length > 0, "the completed write mutation is reconstructed");
    assert.equal(view.fileMutations[0]?.path, "C:/ws/out.txt");
    assert.ok(view.steps.length > 0, "the step-start is reconstructed");
  } finally {
    await fake.close();
  }
});

test("a non-2xx from the child surfaces as a typed OpencodeHttpError", async () => {
  const fake = await startFakeOpencodeServer();
  try {
    const store = storeFor(fake);
    fake.state.forceStatus.set("POST /session", 500);
    await assert.rejects(
      () => store.create({ workspaceId: WS, title: "boom" }),
      (err: unknown) => err instanceof OpencodeHttpError && err.status === 500,
    );
  } finally {
    await fake.close();
  }
});
