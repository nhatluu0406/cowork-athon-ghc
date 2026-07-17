/**
 * Text part snapshot mapping tests — cursor unification across delta + commit.
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

test("streamed text followed by identical final text appends once", () => {
  const mapper = createEvMapper({ sessionId: SID, now: () => "2026-07-12T08:00:00.000Z" });
  mapper.map({
    type: "message.updated",
    properties: { sessionID: SID, info: { id: "m1", role: "assistant", sessionID: SID } },
  });
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
  assert.equal(commit.filter((e) => e.kind === "token").length, 0);
  const view = foldEv(SID, [...deltas, ...commit]);
  assert.equal(view.text, "Done.");
});

test("duplicate assistant text events keyed by part id stay single", () => {
  const mapper = createEvMapper({ sessionId: SID, now: () => "2026-07-12T08:00:00.000Z" });
  mapper.map({
    type: "message.updated",
    properties: { sessionID: SID, info: { id: "m1", role: "assistant", sessionID: SID } },
  });
  const first = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SID,
      part: { id: "p1", messageID: "m1", sessionID: SID, type: "text", text: "Hello", time: { end: 1 } },
    },
  });
  const second = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SID,
      part: { id: "p1", messageID: "m1", sessionID: SID, type: "text", text: "Hello", time: { end: 2 } },
    },
  });
  assert.equal(first.filter((e) => e.kind === "token").length, 1);
  assert.equal(second.filter((e) => e.kind === "token").length, 0);
  const view = foldEv(SID, [...first, ...second]);
  assert.equal(view.text, "Hello");
});

test("delta keyed by partId then commit keyed by messageId does not double-append", () => {
  const mapper = createEvMapper({ sessionId: SID, now: () => "2026-07-12T08:00:00.000Z" });
  mapper.map({
    type: "message.updated",
    properties: { sessionID: SID, info: { id: "m1", role: "assistant", sessionID: SID } },
  });
  const deltas = mapper.map({
    type: "message.part.delta",
    properties: { sessionID: SID, messageID: "m1", partID: "p9", field: "text", delta: "Once." },
  });
  // Simulate commit arriving with only messageID (part id still present for unification).
  const commit = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SID,
      part: { id: "p9", messageID: "m1", sessionID: SID, type: "text", text: "Once.", time: { end: 1 } },
    },
  });
  const view = foldEv(SID, [...deltas, ...commit]);
  assert.equal(view.text, "Once.");
  assert.notEqual(view.text, "Once.Once.");
});

test("two legitimate different paragraphs remain intact", () => {
  const mapper = createEvMapper({ sessionId: SID, now: () => "2026-07-12T08:00:00.000Z" });
  mapper.map({
    type: "message.updated",
    properties: { sessionID: SID, info: { id: "m1", role: "assistant", sessionID: SID } },
  });
  const p1 = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SID,
      part: {
        id: "para-a",
        messageID: "m1",
        sessionID: SID,
        type: "text",
        text: "First paragraph.",
        time: { end: 1 },
      },
    },
  });
  const p2 = mapper.map({
    type: "message.part.updated",
    properties: {
      sessionID: SID,
      part: {
        id: "para-b",
        messageID: "m1",
        sessionID: SID,
        type: "text",
        text: "Second paragraph.",
        time: { end: 2 },
      },
    },
  });
  const view = foldEv(SID, [...p1, ...p2]);
  assert.match(view.text, /First paragraph/);
  assert.match(view.text, /Second paragraph/);
  assert.equal(view.text.includes("First paragraph.Second paragraph."), true);
});
