/**
 * Message role filtering — user text must not appear in SessionView.text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvMapper } from "../src/execution/ev-mapper.js";
import { foldEv } from "../src/execution/ev-reducer.js";

const SID = "sess-role";

function foldFrames(frames: readonly unknown[]) {
  const mapper = createEvMapper({ sessionId: SID, now: () => "2026-07-12T08:00:00.000Z" });
  const events = frames.flatMap((frame) => mapper.map(frame));
  return foldEv(SID, events);
}

test("user message.part.updated text is not mapped to assistant stream", () => {
  const userMsg = "Reply with a single short sentence.";
  const view = foldFrames([
    {
      type: "message.updated",
      properties: {
        sessionID: SID,
        info: { id: "msg_user", role: "user", sessionID: SID },
      },
    },
    {
      type: "message.part.updated",
      properties: {
        sessionID: SID,
        part: { id: "p_user", messageID: "msg_user", sessionID: SID, type: "text", text: userMsg },
      },
    },
    {
      type: "message.updated",
      properties: {
        sessionID: SID,
        info: { id: "msg_asst", role: "assistant", sessionID: SID },
      },
    },
    {
      type: "message.part.delta",
      properties: { sessionID: SID, messageID: "msg_asst", partID: "p_asst", field: "text", delta: "Yes." },
    },
    { type: "session.idle", properties: { sessionID: SID } },
  ]);
  assert.equal(view.text, "Yes.");
  assert.ok(!view.text.includes(userMsg));
});

test("augmented context user echo in user part does not leak to view.text", () => {
  const augmentedUser =
    "<<<CGHC_UNTRUSTED_PRIOR_TURNS>>>\n[user] old\n<<<END_CGHC_UNTRUSTED_PRIOR_TURNS>>>\n\n" +
    "<<<CGHC_CURRENT_USER_REQUEST>>>\nMã vừa rồi?\n<<<END_CGHC_CURRENT_USER_REQUEST>>>";
  const view = foldFrames([
    {
      type: "message.updated",
      properties: { sessionID: SID, info: { id: "msg_u", role: "user", sessionID: SID } },
    },
    {
      type: "message.part.updated",
      properties: {
        sessionID: SID,
        part: { id: "p_u", messageID: "msg_u", sessionID: SID, type: "text", text: augmentedUser },
      },
    },
    {
      type: "message.updated",
      properties: { sessionID: SID, info: { id: "msg_a", role: "assistant", sessionID: SID } },
    },
    {
      type: "message.part.updated",
      properties: {
        sessionID: SID,
        part: {
          id: "p_a",
          messageID: "msg_a",
          sessionID: SID,
          type: "text",
          text: "ORANGE-731",
          time: { end: 1 },
        },
      },
    },
    { type: "session.idle", properties: { sessionID: SID } },
  ]);
  assert.equal(view.text, "ORANGE-731");
  assert.ok(!view.text.includes("CGHC_UNTRUSTED"));
  assert.ok(!view.text.includes("Mã vừa rồi"));
});
