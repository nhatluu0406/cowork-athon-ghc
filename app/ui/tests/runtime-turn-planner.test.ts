/**
 * Runtime turn planner tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conversationNeedsNewRuntimeTurn,
  planRuntimeTurn,
} from "../src/runtime-turn-planner.js";
import type { ConversationRecord, ServiceClient } from "../src/service-client.js";

const baseRecord = (): ConversationRecord => ({
  id: "conv-1",
  title: "Test",
  workspacePath: "C:/ws",
  runtimeSessionId: "rt-1",
  status: "completed",
  createdAt: "2026-07-12T08:00:00.000Z",
  updatedAt: "2026-07-12T08:00:00.000Z",
  messageCount: 2,
  messages: [
    { id: "m1", role: "user", text: "hello", at: "2026-07-12T08:00:00.000Z" },
    { id: "m2", role: "assistant", text: "hi", at: "2026-07-12T08:00:01.000Z" },
  ],
});

test("conversationNeedsNewRuntimeTurn after completed session", () => {
  assert.equal(conversationNeedsNewRuntimeTurn(baseRecord()), true);
});

test("planRuntimeTurn reuses live non-terminal session", async () => {
  const client = {
    getRuntimeSession: async () => ({
      session: { id: "rt-1" },
      view: { sessionId: "rt-1", text: "", terminal: null, lastSeq: 0, status: "running" },
      canPrompt: true,
    }),
  } as unknown as ServiceClient;
  const plan = await planRuntimeTurn(client, { ...baseRecord(), status: "ready" });
  assert.equal(plan.action, "reuse");
  if (plan.action === "reuse") assert.equal(plan.runtimeSessionId, "rt-1");
});

test("planRuntimeTurn plans new_turn when runtime terminal", async () => {
  const client = {
    getRuntimeSession: async () => ({
      session: { id: "rt-1" },
      view: { sessionId: "rt-1", text: "done", terminal: "completed", lastSeq: 1, status: "completed" },
      canPrompt: false,
    }),
  } as unknown as ServiceClient;
  const plan = await planRuntimeTurn(client, baseRecord());
  assert.equal(plan.action, "new_turn");
  if (plan.action === "new_turn") {
    assert.equal(plan.reason, "terminal");
    assert.equal(plan.priorMessages.length, 2);
  }
});
