/**
 * Text part snapshot mapping tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvMapper } from "../src/execution/ev-mapper.js";
import { foldEv } from "../src/execution/ev-reducer.js";

const SID = "sess-text";

test("committed text part.updated supplements missing deltas", () => {
  const mapper = createEvMapper({ sessionId: SID, now: () => "2026-07-12T08:00:00.000Z" });
  const roleFrame = {
    type: "message.updated",
    properties: { sessionID: SID, info: { id: "m1", role: "assistant", sessionID: SID } },
  };
  const frame = {
    type: "message.part.updated",
    properties: {
      sessionID: SID,
      part: {
        id: "p1",
        messageID: "m1",
        sessionID: SID,
        type: "text",
        text: "CGHC_FINAL_RESPONSE_OK",
        time: { end: 1 },
      },
    },
  };
  const events = [...mapper.map(roleFrame), ...mapper.map(frame)];
  assert.equal(events.some((e) => e.kind === "token"), true);
  const view = foldEv(SID, events);
  assert.equal(view.text, "CGHC_FINAL_RESPONSE_OK");
});

test("text part.updated does not duplicate after deltas", () => {
  const mapper = createEvMapper({ sessionId: SID, now: () => "2026-07-12T08:00:00.000Z" });
  const roleFrame = {
    type: "message.updated",
    properties: { sessionID: SID, info: { id: "m1", role: "assistant", sessionID: SID } },
  };
  mapper.map(roleFrame);
  const deltas = mapper.map({
    type: "message.part.delta",
    properties: { sessionID: SID, messageID: "m1", partID: "p1", field: "text", delta: "Done." },
  });
  const commit = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SID,
      part: { id: "p1", messageID: "m1", sessionID: SID, type: "text", text: "Done.", time: { end: 1 } },
    },
  });
  const view = foldEv(SID, [...deltas, ...commit]);
  assert.equal(view.text, "Done.");
});
