import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivitySnapshot, mergeEvEvents } from "../src/activity-model.js";
import { ms365ToolLabel } from "../src/ms365-tool-label.js";
import type { EvEvent } from "@cowork-ghc/contracts";

function toolEvent(seq: number, callId: string, status: "running" | "completed"): EvEvent {
  return {
    sessionId: "s-ms365",
    seq,
    at: new Date(0).toISOString(),
    kind: "tool_call",
    callId,
    toolName: "teams_post_message",
    status,
  };
}

test("fold tool_call running→completed → một item, nhãn MS365 theo trạng thái", () => {
  let events: readonly EvEvent[] = [];
  events = mergeEvEvents(events, [toolEvent(1, "c1", "running")]);
  events = mergeEvEvents(events, [toolEvent(2, "c1", "completed")]);
  const snap = buildActivitySnapshot(events, null, []);
  const toolItems = snap.items.filter((i) => i.kind === "tool");
  assert.equal(toolItems.length, 1);
  assert.equal(toolItems[0]!.status, "success");
  assert.equal(ms365ToolLabel(toolItems[0]!.toolName ?? "", true), "Đã đăng tin nhắn Teams");
});
