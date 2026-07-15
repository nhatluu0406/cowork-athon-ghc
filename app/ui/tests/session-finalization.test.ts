/**
 * Session finalization — text resolution, terminal mapping, fallbacks, finalize-once.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MISSING_FINAL_FALLBACK_VI,
  beginTurnFinalization,
  resolveFinalAssistantText,
  runtimePhaseForCompleted,
  shouldPollSessionView,
} from "../src/session-finalization.js";
import { reduceEv, initialSessionView } from "@cowork-ghc/service/execution";
import { createTurnTimingTracker } from "../src/turn-timing.js";

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

test("finalization called twice records only the first claim", () => {
  const finalized = new Set<string>();
  assert.equal(beginTurnFinalization(finalized, "rt-1", false), true);
  assert.equal(beginTurnFinalization(finalized, "rt-1", false), false);
  assert.equal(beginTurnFinalization(finalized, "rt-1", true), false);
  assert.equal(finalized.size, 1);
});

test("streamed text followed by identical final text keeps one assistant body", () => {
  const streamed = "File đã tạo xong.";
  const final = resolveFinalAssistantText(streamed, streamed);
  assert.equal(final.text, streamed);
  // Second finalize attempt must not claim again.
  const finalized = new Set<string>();
  assert.equal(beginTurnFinalization(finalized, "rt-dup", false), true);
  assert.equal(beginTurnFinalization(finalized, "rt-dup", false), false);
});

test("duplicate assistant terminal events finalize once", () => {
  const finalized = new Set<string>();
  const claims: string[] = [];
  for (const id of ["rt-same", "rt-same", "rt-same"]) {
    if (beginTurnFinalization(finalized, id, false)) claims.push(id);
  }
  assert.deepEqual(claims, ["rt-same"]);
});

test("turn timing reports slowest stage behind enabled flag", () => {
  let clock = 1_000;
  const lines: string[] = [];
  const tracker = createTurnTimingTracker({
    enabled: () => true,
    now: () => clock,
    log: (line) => lines.push(line),
  });
  tracker.mark("PROMPT_SENT");
  clock += 10;
  tracker.mark("FIRST_TOKEN");
  clock += 500;
  tracker.mark("TOOL_REQUEST");
  clock += 50;
  tracker.mark("FINAL_RESPONSE");
  const report = tracker.report();
  assert.equal(report.slowest, "TOOL_REQUEST");
  assert.equal(report.durationsMs["FIRST_TOKEN->TOOL_REQUEST"], 500);
  assert.ok(lines.some((l) => l.includes("PROMPT_SENT")));
});
