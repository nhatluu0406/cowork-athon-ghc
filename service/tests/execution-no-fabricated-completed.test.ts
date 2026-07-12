/**
 * CGHC-012 — no-fabricated-completed guarantee (EV7 / testing.md).
 *
 * Proves the mapper + reducer NEVER yield a `completed`/terminal state without a real
 * terminal SSE frame, and that an error/cancel frame yields `errored`/`cancelled` — not
 * `completed`. This is the load-bearing honesty test for the whole EV pipeline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import type { RawOpencodeEvent } from "../src/execution/index.js";
import { createEvMapper, foldEv } from "../src/execution/index.js";

const SID = "session-a";

function mapAll(frames: readonly unknown[]): EvEvent[] {
  const mapper = createEvMapper({ sessionId: SID, now: () => "2026-07-11T00:00:00.000Z" });
  const out: EvEvent[] = [];
  for (const frame of frames) out.push(...mapper.map(frame));
  return out;
}

// A busy run: plan, tool activity, and streamed tokens — but NO session.idle.
const RUN_WITHOUT_TERMINAL: readonly RawOpencodeEvent[] = [
  { type: "todo.updated", properties: { sessionID: SID, todos: [
    { id: "t1", content: "Work", status: "in_progress" },
  ] } },
  { type: "message.part.updated", properties: { part: {
    id: "p", sessionID: SID, messageID: "m", type: "tool", callID: "c", tool: "write",
    state: { status: "running", input: { filePath: "src/a.ts" } },
  } } },
  { type: "message.part.delta", properties: { sessionID: SID, messageID: "m", partID: "p", delta: "Hi" } },
  { type: "message.part.updated", properties: { part: {
    id: "p2", sessionID: SID, messageID: "m", type: "tool", callID: "c", tool: "write",
    state: { status: "completed", input: { filePath: "src/a.ts" } },
  } } },
];

test("without a terminal frame, the mapper emits NO terminal event", () => {
  const events = mapAll(RUN_WITHOUT_TERMINAL);
  assert.ok(events.length > 0, "the run should still produce activity EV events");
  assert.equal(events.filter((e) => e.kind === "terminal").length, 0);
});

test("without a terminal frame, the folded view is running — never completed", () => {
  const view = foldEv(SID, mapAll(RUN_WITHOUT_TERMINAL));
  assert.equal(view.terminal, null);
  assert.equal(view.status, "running");
  assert.notEqual(view.status, "completed");
});

test("a fresh session with no events at all stays idle (not completed)", () => {
  const view = foldEv(SID, []);
  assert.equal(view.status, "idle");
  assert.equal(view.terminal, null);
});

test("an error frame yields errored — NOT completed", () => {
  const view = foldEv(SID, mapAll([
    ...RUN_WITHOUT_TERMINAL,
    { type: "session.error", properties: { sessionID: SID, error: { name: "ProviderAuthError" } } },
  ]));
  assert.equal(view.terminal, "errored");
  assert.equal(view.status, "errored");
  assert.notEqual(view.status, "completed");
});

test("a cancel frame yields cancelled — NOT errored and NOT completed", () => {
  const view = foldEv(SID, mapAll([
    ...RUN_WITHOUT_TERMINAL,
    { type: "session.error", properties: { sessionID: SID, error: { name: "MessageAbortedError" } } },
  ]));
  assert.equal(view.terminal, "cancelled");
  assert.equal(view.status, "cancelled");
});

test("only a real session.idle frame produces the completed status", () => {
  const view = foldEv(SID, mapAll([
    ...RUN_WITHOUT_TERMINAL,
    { type: "session.idle", properties: { sessionID: SID } },
  ]));
  assert.equal(view.terminal, "completed");
  assert.equal(view.status, "completed");
});
