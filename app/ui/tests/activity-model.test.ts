/**
 * Activity model — EV folding, ordering, redaction, persistence helpers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import {
  buildActivitySnapshot,
  mergeEvEvents,
  markRunningAsCancelled,
  redactCommandText,
  snapshotFromSessionView,
  toRelativePath,
} from "../src/activity-model.js";
import { initialSessionView } from "@cowork-ghc/service/execution";

const SID = "sess-1";
const WS = "C:/fixture/ws";

function ev(partial: Omit<EvEvent, "sessionId" | "at"> & { at?: string }): EvEvent {
  return { sessionId: SID, at: partial.at ?? "2026-07-12T08:00:00.000Z", ...partial } as EvEvent;
}

test("mergeEvEvents ignores duplicate seq and orders chronologically", () => {
  const a = [ev({ kind: "token", seq: 1, delta: "x" })];
  const b = [
    ev({ kind: "tool_call", seq: 2, callId: "c1", toolName: "write", status: "running" }),
    ev({ kind: "tool_call", seq: 2, callId: "c1", toolName: "write", status: "completed" }),
    ev({ kind: "file_mutation", seq: 3, operation: "create", path: `${WS}/notes.txt` }),
  ];
  const merged = mergeEvEvents(a, b);
  assert.equal(merged.length, 3);
  assert.equal(merged[2]?.kind, "file_mutation");
});

test("buildActivitySnapshot maps tool and file events with Vietnamese labels", () => {
  const snapshot = buildActivitySnapshot(
    [
      ev({ kind: "tool_call", seq: 1, callId: "c1", toolName: "write", status: "running" }),
      ev({
        kind: "tool_call",
        seq: 2,
        callId: "c1",
        toolName: "write",
        status: "completed",
        summary: "notes.txt",
      }),
      ev({ kind: "file_mutation", seq: 3, operation: "create", path: `${WS}/notes.txt` }),
      ev({ kind: "terminal", seq: 4, state: "completed" }),
    ],
    WS,
    [],
    false,
  );
  assert.match(snapshot.items.some((i) => i.label.includes("tệp")) ? "yes" : "", /yes/);
  assert.equal(snapshot.fileChanges.length, 1);
  assert.equal(snapshot.fileChanges[0]?.relativePath, "notes.txt");
  assert.equal(snapshot.fileReviews.length, 0);
  assert.equal(snapshot.terminalState, "completed");
  assert.equal(snapshot.items.at(-1)?.label, "Đã hoàn thành");
});

test("completed read tool uses past tense and runtime read path", () => {
  const snapshot = buildActivitySnapshot(
    [
      ev({
        kind: "tool_call",
        seq: 1,
        callId: "c1",
        toolName: "read",
        status: "completed",
        summary: `${WS}/readme.md`,
      }),
    ],
    WS,
    [],
    false,
  );
  assert.equal(snapshot.items[0]?.label, "Đã đọc tệp");
  assert.deepEqual(snapshot.runtimeReadPaths, ["readme.md"]);
  assert.deepEqual(snapshot.attachmentContextPaths, []);
});

test("token events are excluded from activity timeline", () => {
  const snapshot = buildActivitySnapshot([ev({ kind: "token", seq: 1, delta: "hello" })], WS, [], false);
  assert.equal(snapshot.items.length, 0);
});

test("toRelativePath stays inside workspace and redactCommand hides secrets", () => {
  assert.equal(toRelativePath(`${WS}/src/a.ts`, WS), "src/a.ts");
  assert.match(redactCommandText("curl -H Authorization: Bearer sk-secret"), /\[redacted\]/i);
});

test("markRunningAsCancelled clears running tool states", () => {
  const snapshot = buildActivitySnapshot(
    [
      ev({ kind: "tool_call", seq: 1, callId: "c1", toolName: "bash", status: "running", summary: "echo hi" }),
    ],
    WS,
    [],
    false,
  );
  const cancelled = markRunningAsCancelled(snapshot);
  assert.equal(cancelled.items[0]?.status, "cancelled");
  assert.equal(cancelled.terminalState, "cancelled");
});

test("permission history is preserved in snapshot", () => {
  const history = [
    {
      id: "p1",
      requestId: "r1",
      at: "2026-07-12T08:00:00.000Z",
      actionLabel: "Ghi tệp",
      targetSummary: "notes.txt",
      decision: "denied" as const,
      outcomeLabel: "Đã bị từ chối",
    },
  ];
  const snapshot = buildActivitySnapshot([], WS, history, true);
  assert.equal(snapshot.permissionHistory.length, 1);
  assert.equal(snapshot.permissionHistory[0]?.decision, "denied");
});

test("snapshotFromSessionView provides backward-compatible rebuild", () => {
  const view = initialSessionView(SID);
  const rebuilt = snapshotFromSessionView(
    {
      ...view,
      toolCalls: [{ callId: "c1", toolName: "read", status: "completed", summary: "readme.md" }],
      fileMutations: [{ operation: "create", path: `${WS}/readme.md` }],
      terminal: "completed",
      status: "completed",
    },
    WS,
    [],
    true,
  );
  assert.equal(rebuilt.fileChanges.length, 1);
  assert.equal(rebuilt.items.at(-1)?.historical, true);
});
