/**
 * CGHC-024 — captured-frame test harness (PR10).
 *
 * Two honest layers:
 *  1. The MECHANISM runs for real NOW: schema round-trip, the recorder decoding a live-shaped
 *     SSE byte stream, the pin gate reporting needs_capture / needs_recapture, and replay
 *     through the production mapper + reducer.
 *  2. The REAL-FRAME assertions are GATED: for every required scenario, if the fixture is not
 *     yet captured (or was captured at another pin), the test SKIPS with the gate's reason —
 *     node:test counts it as skipped, NOT passed. No fabricated SSE frames exist in this repo,
 *     so nothing here green-washes a run that never happened.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_PIN,
  CapturedFrameSchemaError,
  REQUIRED_CAPTURE_SCENARIOS,
  captureGateStatus,
  evaluateCaptureGate,
  parseCapturedFrameFile,
  recordFrames,
  replayCapturedFrames,
  serializeCapturedFrameFile,
  type CapturedFrameFile,
} from "../src/execution/fixtures/index.js";

const SID = "ses_capture_demo";

/** A tiny live-shaped SSE byte stream (raw `data:` frames) used ONLY to test the recorder. */
async function* fakeSseStream(): AsyncIterable<string> {
  // A real stream announces the assistant message (role) before its text deltas; the mapper's
  // assistant-only token gate depends on it.
  yield `data: ${JSON.stringify({
    type: "message.updated",
    properties: { sessionID: SID, info: { id: "msg1", role: "assistant" } },
  })}\n\n`;
  yield `event: message\ndata: ${JSON.stringify({
    type: "message.part.delta",
    properties: { sessionID: SID, messageID: "msg1", field: "text", delta: "Hi" },
  })}\n\n`;
  // A frame for ANOTHER session must be filtered out by the recorder's sessionFilter.
  yield `data: ${JSON.stringify({
    type: "session.idle",
    properties: { sessionID: "ses_other" },
  })}\n\n`;
  yield `data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: SID } })}\n\n`;
}

test("schema round-trips (serialize → parse) preserving header + frames", () => {
  const file: CapturedFrameFile = {
    meta: {
      kind: "capture-meta",
      scenario: "simple-chat",
      opencodePin: CAPTURE_PIN,
      capturedAt: "2026-07-11T00:00:00.000Z",
      sessionId: SID,
      prompt: "Say hi.",
    },
    frames: [
      { kind: "frame", raw: { type: "session.idle", properties: { sessionID: SID } } },
    ],
  };
  const parsed = parseCapturedFrameFile(serializeCapturedFrameFile(file));
  assert.equal(parsed.meta.scenario, "simple-chat");
  assert.equal(parsed.meta.opencodePin, CAPTURE_PIN);
  assert.equal(parsed.frames.length, 1);
  assert.equal(parsed.frames[0]?.raw.type, "session.idle");
});

test("a malformed fixture is a hard schema error (never silently accepted)", () => {
  assert.throws(() => parseCapturedFrameFile(""), CapturedFrameSchemaError);
  assert.throws(
    () => parseCapturedFrameFile(`{"kind":"frame","raw":{"type":"x"}}`),
    CapturedFrameSchemaError, // first line must be the header
  );
  assert.throws(
    () =>
      parseCapturedFrameFile(
        `{"kind":"capture-meta","scenario":"s","opencodePin":"v1","capturedAt":"t","sessionId":"i","prompt":"p"}\n{"kind":"frame","raw":42}`,
      ),
    CapturedFrameSchemaError, // raw is not an envelope
  );
});

test("recorder decodes a live-shaped SSE stream + filters foreign-session frames", async () => {
  const file = await recordFrames({
    meta: {
      scenario: "simple-chat",
      opencodePin: CAPTURE_PIN,
      capturedAt: "2026-07-11T00:00:00.000Z",
      sessionId: SID,
      prompt: "Say hi.",
    },
    chunks: fakeSseStream(),
    sessionFilter: SID,
    now: () => "2026-07-11T00:00:00.000Z",
  });
  // 3 kept (message.updated + delta + our idle); the foreign-session idle is dropped.
  assert.equal(file.frames.length, 3);
  assert.equal(file.frames[0]?.raw.type, "message.updated");
  assert.equal(file.frames[1]?.raw.type, "message.part.delta");
  assert.equal(file.frames[2]?.raw.type, "session.idle");
});

test("replay of recorded frames flows through the REAL mapper + reducer", async () => {
  const file = await recordFrames({
    meta: {
      scenario: "simple-chat",
      opencodePin: CAPTURE_PIN,
      capturedAt: "2026-07-11T00:00:00.000Z",
      sessionId: SID,
      prompt: "Say hi.",
    },
    chunks: fakeSseStream(),
    sessionFilter: SID,
  });
  const { view, events } = replayCapturedFrames(file);
  // The real mapper produced a token then a completed terminal from the real idle frame.
  assert.equal(view.text, "Hi");
  assert.equal(view.terminal, "completed");
  assert.equal(view.status, "completed");
  assert.equal(events.filter((e) => e.kind === "terminal").length, 1);
});

test("pure gate: needs_capture when absent, needs_recapture on a pin mismatch, ready when matched", () => {
  const absent = evaluateCaptureGate("simple-chat", { present: false, path: "x" });
  assert.equal(absent.state, "needs_capture");
  assert.equal(absent.ready, false);
  assert.match(absent.reason, /NEEDS CAPTURE/);

  const stale: CapturedFrameFile = {
    meta: {
      kind: "capture-meta",
      scenario: "simple-chat",
      opencodePin: "v0.0.0-old",
      capturedAt: "t",
      sessionId: SID,
      prompt: "p",
    },
    frames: [{ kind: "frame", raw: { type: "session.idle", properties: { sessionID: SID } } }],
  };
  const recap = evaluateCaptureGate("simple-chat", { present: true, file: stale });
  assert.equal(recap.state, "needs_recapture");
  assert.match(recap.reason, /NEEDS RE-CAPTURE/);

  const fresh: CapturedFrameFile = { ...stale, meta: { ...stale.meta, opencodePin: CAPTURE_PIN } };
  const ready = evaluateCaptureGate("simple-chat", { present: true, file: fresh });
  assert.equal(ready.state, "ready");
  assert.equal(ready.ready, true);
  assert.ok(ready.file);

  const unknown = evaluateCaptureGate("not-a-scenario", { present: false, path: "x" });
  assert.equal(unknown.state, "unknown_scenario");
});

// ── GATED real-frame assertions: one per required scenario ──────────────────────────────
// Each SKIPS with the gate reason until a real fixture is captured post-token; then it
// asserts the REAL replayed terminal state + required EV kinds. No fixtures exist yet, so
// these currently skip honestly (visible needs-capture), never a fake pass.
for (const scenario of REQUIRED_CAPTURE_SCENARIOS) {
  const status = captureGateStatus(scenario.name);
  test(`captured "${scenario.name}" replays to ${scenario.expectedTerminal}`, { skip: status.ready ? false : status.reason }, () => {
    const file = status.file;
    assert.ok(file, "gate reported ready but carried no fixture");
    const { view, events, unmapped } = replayCapturedFrames(file);
    assert.equal(unmapped.length, 0, "a clean capture maps every frame (pinned frame shape)");
    assert.equal(view.terminal, scenario.expectedTerminal, "real terminal must match the manifest");
    for (const kind of scenario.mustEmit) {
      assert.ok(events.some((e) => e.kind === kind), `expected a real ${kind} EV event`);
    }
    // The load-bearing honesty check: completed only ever from a real session.idle.
    if (scenario.expectedTerminal !== "completed") {
      assert.notEqual(view.status, "completed");
    }
  });
}
