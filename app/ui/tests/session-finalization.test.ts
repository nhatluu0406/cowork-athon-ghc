/**
 * Session finalization — text resolution, terminal mapping, fallbacks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MISSING_FINAL_FALLBACK_VI,
  resolveFinalAssistantText,
  runtimePhaseForCompleted,
  shouldPollSessionView,
} from "../src/session-finalization.js";
import { foldEv, initialSessionView, reduceEv } from "@cowork-ghc/service/execution";

const SID = "sess-final";

test("resolveFinalAssistantText prefers streamed text", () => {
  const r = resolveFinalAssistantText("  Hello  ", "Fetched");
  assert.equal(r.outcome, "completed_with_response");
  assert.equal(r.text, "Hello");
});

test("resolveFinalAssistantText uses fetched text when stream empty", () => {
  const r = resolveFinalAssistantText("", "Done.");
  assert.equal(r.outcome, "completed_with_response");
  assert.equal(r.text, "Done.");
});

test("resolveFinalAssistantText uses truthful fallback when both empty", () => {
  const r = resolveFinalAssistantText("  ", null);
  assert.equal(r.outcome, "completed_without_final_message");
  assert.equal(r.text, MISSING_FINAL_FALLBACK_VI);
});

test("runtimePhaseForCompleted distinguishes missing final message", () => {
  const phase = runtimePhaseForCompleted(
    { text: MISSING_FINAL_FALLBACK_VI, outcome: "completed_without_final_message" },
    "completed",
  );
  assert.equal(phase, "completed_without_final_message");
});

test("shouldPollSessionView when completed with empty text", () => {
  const view = { ...initialSessionView(SID), terminal: "completed" as const, status: "completed" as const };
  assert.equal(shouldPollSessionView(view), true);
});

test("reducer accepts late token after terminal when text still empty", () => {
  let view = initialSessionView(SID);
  view = reduceEv(view, {
    sessionId: SID,
    seq: 1,
    at: "2026-07-12T08:00:00.000Z",
    kind: "terminal",
    state: "completed",
  });
  view = reduceEv(view, {
    sessionId: SID,
    seq: 2,
    at: "2026-07-12T08:00:01.000Z",
    kind: "token",
    delta: "Done.",
  });
  assert.equal(view.text, "Done.");
  assert.equal(view.terminal, "completed");
});
