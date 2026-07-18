/**
 * Conversation-turn orchestrator (#21) — the server-side "start a turn from the web/phone" path.
 * These tests drive the route handler directly with fake session/prompt/stream seams so no live
 * runtime is needed; they assert the real create→link→persist→dispatch dance and its honest errors.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConversationStore, type ConversationStore } from "../src/conversation/store.js";
import {
  createConversationTurnRouter,
  CONVERSATION_TURN_PATH,
  type TurnSessionPort,
  type TurnPromptPort,
  type TurnStreamPort,
} from "../src/conversation/turn-router.js";

const NOW = (): string => "2026-07-18T08:00:00.000Z";
const WS = "C:/fixture/ws";

interface Fixture {
  readonly dir: string;
  readonly store: ConversationStore;
  readonly conversationId: string;
  readonly prompts: Array<{ sessionId: string; text: string }>;
  /** Fire the terminal transition for the created session (drives the persistence subscription). */
  goTerminal(state: string, text: string): void;
  handler: (body: unknown, id?: string) => Promise<{ status: number; data: unknown }>;
}

async function fixture(overrides?: {
  activeRoot?: string | undefined;
  createThrows?: unknown;
  sendThrows?: unknown;
  noStream?: boolean;
}): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "cghc-turn-router-"));
  const store = createConversationStore({ rootDir: dir, now: NOW });
  const conv = await store.create({ workspacePath: WS, title: "Web chat" });

  const views = new Map<string, { terminal: string | null; text: string }>();
  const listeners = new Map<string, Array<(e: { kind: string }) => void>>();
  const prompts: Array<{ sessionId: string; text: string }> = [];
  let created = 0;

  const session: TurnSessionPort = {
    create: async () => {
      if (overrides?.createThrows !== undefined) throw overrides.createThrows;
      created += 1;
      const id = `sess-${created}`;
      views.set(id, { terminal: null, text: "" });
      return { id };
    },
    view: (id) => views.get(id),
    bindStream: () => {},
  };
  const prompt: TurnPromptPort = {
    send: async (sessionId, text) => {
      if (overrides?.sendThrows !== undefined) throw overrides.sendThrows;
      prompts.push({ sessionId, text });
    },
  };
  const stream: TurnStreamPort = {
    subscribe: (sessionId, listener) => {
      if (overrides?.noStream === true) return undefined;
      const arr = listeners.get(sessionId) ?? [];
      arr.push(listener);
      listeners.set(sessionId, arr);
      return { close: () => listeners.set(sessionId, []) };
    },
  };

  const router = createConversationTurnRouter({
    store,
    session,
    prompt,
    stream,
    activeWorkspaceRoot: () => ("activeRoot" in (overrides ?? {}) ? overrides!.activeRoot : WS),
    now: NOW,
  });
  const route = router.routes.find((r) => r.path === CONVERSATION_TURN_PATH);
  assert.ok(route);

  return {
    dir,
    store,
    conversationId: conv.id,
    prompts,
    goTerminal(state, text) {
      const id = `sess-${created}`;
      views.set(id, { terminal: state, text });
      for (const l of listeners.get(id) ?? []) l({ kind: "terminal" });
    },
    handler: (body, id = conv.id) =>
      route!.handler({
        method: "POST",
        url: new URL(`http://127.0.0.1${CONVERSATION_TURN_PATH}`),
        params: { id },
        body,
      }) as Promise<{ status: number; data: unknown }>,
  };
}

test("web turn: creates a session, persists the user message, dispatches, returns 202", async () => {
  const fx = await fixture();
  try {
    const res = await fx.handler({ text: "xin chào" });
    assert.equal(res.status, 202);
    const data = res.data as { accepted: boolean; sessionId: string; conversationId: string };
    assert.equal(data.accepted, true);
    assert.equal(data.sessionId, "sess-1");
    assert.equal(data.conversationId, fx.conversationId);
    // Prompt actually dispatched to the created session.
    assert.deepEqual(fx.prompts, [{ sessionId: "sess-1", text: "xin chào" }]);
    // User message + running turn persisted.
    const conv = await fx.store.get(fx.conversationId);
    assert.equal(conv?.runtimeSessionId, "sess-1");
    assert.equal(conv?.status, "running");
    assert.equal(conv?.messages.at(-1)?.role, "user");
    assert.equal(conv?.messages.at(-1)?.text, "xin chào");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("web turn: assistant reply is persisted server-side when the session goes terminal", async () => {
  const fx = await fixture();
  try {
    await fx.handler({ text: "hỏi gì đó" });
    fx.goTerminal("completed", "Đây là câu trả lời.");
    // Persistence is fire-and-forget (append + patch, both queued file writes); poll for it.
    let conv = await fx.store.get(fx.conversationId);
    for (let i = 0; i < 100 && conv?.status !== "completed"; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      conv = await fx.store.get(fx.conversationId);
    }
    assert.equal(conv?.status, "completed");
    const last = conv?.messages.at(-1);
    assert.equal(last?.role, "assistant");
    assert.equal(last?.text, "Đây là câu trả lời.");
    const turn = conv?.runtimeTurns?.at(-1);
    assert.equal(turn?.status, "completed");
    assert.ok(turn?.completedAt);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("web turn: a conversation in a different workspace is refused with 409 (honest)", async () => {
  const fx = await fixture({ activeRoot: "C:/other/ws" });
  try {
    const res = await fx.handler({ text: "hi" });
    assert.equal(res.status, 409);
    assert.equal((res.data as { code: string }).code, "workspace_mismatch");
    assert.equal(fx.prompts.length, 0);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("web turn: no active workspace yields 503, never a fake acceptance", async () => {
  const fx = await fixture({ activeRoot: undefined });
  try {
    const res = await fx.handler({ text: "hi" });
    assert.equal(res.status, 503);
    assert.equal((res.data as { code: string }).code, "no_active_workspace");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("web turn: unknown conversation is 404", async () => {
  const fx = await fixture();
  try {
    const res = await fx.handler({ text: "hi" }, "00000000-0000-4000-8000-000000000000");
    assert.equal(res.status, 404);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("web turn: a failed dispatch marks the turn errored and returns 503", async () => {
  const fx = await fixture({ sendThrows: { code: "runtime_not_attached" } });
  try {
    const res = await fx.handler({ text: "hi" });
    assert.equal(res.status, 503);
    assert.equal((res.data as { code: string }).code, "runtime_not_attached");
    const conv = await fx.store.get(fx.conversationId);
    assert.equal(conv?.status, "errored");
    // The user message is preserved even though dispatch failed.
    assert.equal(conv?.messages.at(-1)?.text, "hi");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});
