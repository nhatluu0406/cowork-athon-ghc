/**
 * Conversation controller — title helpers and continuation detection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createConversationManager,
  formatConversationMeta,
  needsContinuation,
} from "../src/conversation-controller.js";
import type { ConversationRecord } from "../src/service-client.js";

test("needsContinuation is true for terminal and interrupted sessions", () => {
  const base: ConversationRecord = {
    id: "1",
    title: "t",
    workspacePath: "C:/ws",
    runtimeSessionId: "rt-1",
    status: "completed",
    createdAt: "2026-07-12T08:00:00.000Z",
    updatedAt: "2026-07-12T08:00:00.000Z",
    messageCount: 1,
    messages: [{ id: "m1", role: "user", text: "hi", at: "2026-07-12T08:00:00.000Z" }],
  };
  assert.equal(needsContinuation(base), true);
  assert.equal(needsContinuation({ ...base, status: "interrupted" }), true);
  assert.equal(needsContinuation({ ...base, status: "running", runtimeSessionId: "rt" }), false);
  assert.equal(needsContinuation(null), false);
});

test("formatConversationMeta includes status for interrupted sessions", () => {
  const meta = formatConversationMeta({
    id: "1",
    title: "t",
    workspacePath: "C:/ws",
    runtimeSessionId: null,
    status: "interrupted",
    createdAt: "2026-07-12T08:00:00.000Z",
    updatedAt: "2026-07-12T08:00:00.000Z",
    messageCount: 0,
  });
  assert.match(meta, /Đã gián đoạn/);
});

test("conversation manager isolates late stream events by runtime session id", () => {
  const manager = createConversationManager(() => null);
  manager.state.runtimeSessionId = "session-a";
  assert.equal(manager.shouldApplyStreamView("session-a"), true);
  assert.equal(manager.shouldApplyStreamView("session-b"), false);
});
