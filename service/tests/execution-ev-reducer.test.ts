/**
 * CGHC-012 — EV reducer / state machine unit test.
 *
 * Feeds a representative EV sequence and asserts the folded authoritative view + terminal
 * status is correct, and that every terminal EV state maps to the right SessionStatus via
 * the shared `terminalStateToSessionStatus` (no invented tokens).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent, TerminalState } from "@cowork-ghc/contracts";
import { terminalStateToSessionStatus } from "@cowork-ghc/contracts";
import {
  foldEv,
  initialSessionView,
  reduceEv,
  type SessionView,
} from "../src/execution/index.js";

const SID = "session-a";
const AT = "2026-07-11T00:00:00.000Z";

function base(seq: number) {
  return { sessionId: SID, seq, at: AT } as const;
}

test("folds a representative EV run into the authoritative view + completed status", () => {
  const events: EvEvent[] = [
    { ...base(1), kind: "plan", todos: [
      { id: "t1", title: "Read", status: "running" },
      { id: "t2", title: "Write", status: "pending" },
    ] },
    { ...base(2), kind: "step", stepId: "s1", label: "Step started", status: "running" },
    { ...base(3), kind: "tool_call", callId: "c1", toolName: "write", status: "running" },
    { ...base(4), kind: "token", delta: "Hel" },
    { ...base(5), kind: "token", delta: "lo" },
    { ...base(6), kind: "tool_call", callId: "c1", toolName: "write", status: "completed" },
    { ...base(7), kind: "file_mutation", operation: "create", path: "src/a.ts" },
    { ...base(8), kind: "terminal", state: "completed" },
  ];

  const view = foldEv(SID, events);

  assert.equal(view.status, "completed");
  assert.equal(view.terminal, "completed");
  assert.equal(view.lastSeq, 8);
  assert.equal(view.todos.length, 2);
  // The tool call was upserted by callId: one entry, final status completed.
  assert.equal(view.toolCalls.length, 1);
  assert.equal(view.toolCalls[0]?.status, "completed");
  assert.equal(view.text, "Hello");
  assert.equal(view.fileMutations.length, 1);
  assert.equal(view.fileMutations[0]?.path, "src/a.ts");
  assert.equal(view.steps.length, 1);
});

test("every terminal EV state maps to its exact SessionStatus", () => {
  const states: readonly TerminalState[] = ["completed", "errored", "cancelled", "denied"];
  for (const state of states) {
    const view = foldEv(SID, [{ ...base(1), kind: "terminal", state }]);
    assert.equal(view.terminal, state);
    assert.equal(view.status, terminalStateToSessionStatus[state]);
  }
});

test("the first terminal wins — a later terminal cannot overwrite it", () => {
  // errored, then a late session.idle-style completed: must stay errored.
  const view = foldEv(SID, [
    { ...base(1), kind: "error", message: "boom", recovery: { kind: "retry", label: "Retry" } },
    { ...base(2), kind: "terminal", state: "errored" },
    { ...base(3), kind: "terminal", state: "completed" },
  ]);
  assert.equal(view.terminal, "errored");
  assert.equal(view.status, "errored");
  assert.equal(view.error?.message, "boom");
  assert.equal(view.error?.recovery, "retry");
});

test("a post-terminal activity event does not flip status back to running", () => {
  const view = foldEv(SID, [
    { ...base(1), kind: "terminal", state: "completed" },
    { ...base(2), kind: "token", delta: "late" },
  ]);
  assert.equal(view.status, "completed");
  assert.equal(view.terminal, "completed");
});

test("post-terminal mutating frames are dropped, not appended (defense in depth)", () => {
  // A late file_mutation / tool_call / token / error after ANY terminal must not mutate the
  // view — every direct reduceEv consumer (session registry, streaming, permission) inherits
  // this, so the UI can never show a mutation that "happened" after the run finished.
  const view = foldEv(SID, [
    { ...base(1), kind: "terminal", state: "completed" },
    { ...base(2), kind: "file_mutation", operation: "create", path: "late.ts" },
    { ...base(3), kind: "tool_call", callId: "c9", toolName: "write", status: "running" },
    { ...base(4), kind: "token", delta: "late" },
    { ...base(5), kind: "error", message: "late error" },
  ]);
  assert.equal(view.terminal, "completed");
  assert.equal(view.status, "completed");
  assert.equal(view.fileMutations.length, 0, "no post-terminal file mutation");
  assert.equal(view.toolCalls.length, 0, "no post-terminal tool call");
  assert.equal(view.text, "", "no post-terminal token text");
  assert.equal(view.error, null, "no post-terminal error surfaced");
});

test("EV5 — a progress event folds label + ratio into view.progress (newer replaces older)", () => {
  let view: SessionView = initialSessionView(SID);
  view = reduceEv(view, { ...base(1), kind: "progress", label: "Đang tải mô hình", ratio: 0.25 });
  assert.deepEqual(view.progress, { label: "Đang tải mô hình", ratio: 0.25 });
  assert.equal(view.status, "running", "progress marks the live run running");

  // A newer progress REPLACES the older one (not accumulated).
  view = reduceEv(view, { ...base(2), kind: "progress", label: "Đang xử lý", ratio: 0.75 });
  assert.deepEqual(view.progress, { label: "Đang xử lý", ratio: 0.75 });
});

test("EV5 — a progress event with no ratio folds an indeterminate marker (ratio omitted)", () => {
  const view = foldEv(SID, [{ ...base(1), kind: "progress", label: "Đang chờ runtime" }]);
  assert.equal(view.progress?.label, "Đang chờ runtime");
  assert.equal(view.progress?.ratio, undefined, "indeterminate: no ratio");
  assert.equal(Object.prototype.hasOwnProperty.call(view.progress, "ratio"), false, "ratio omitted, not undefined");
});

test("EV5 — a terminal event CLEARS in-flight progress (no stale in-progress bar)", () => {
  const view = foldEv(SID, [
    { ...base(1), kind: "progress", label: "Đang xử lý", ratio: 0.5 },
    { ...base(2), kind: "terminal", state: "completed" },
  ]);
  assert.equal(view.terminal, "completed");
  assert.equal(view.progress, undefined, "progress is dropped once terminal");
});

test("apply is idempotent + ordered — seq <= lastSeq is ignored", () => {
  let view: SessionView = initialSessionView(SID);
  const tok: EvEvent = { ...base(3), kind: "token", delta: "x" };
  view = reduceEv(view, tok);
  view = reduceEv(view, tok); // replay: ignored (seq 3 <= lastSeq 3)
  view = reduceEv(view, { ...base(2), kind: "token", delta: "OLD" }); // stale: ignored
  assert.equal(view.text, "x");
  assert.equal(view.lastSeq, 3);
});
