/**
 * CGHC-012 — OpenCode SSE → EV mapper unit test.
 *
 * Uses representative frames whose shape is pinned to the READ-ONLY reference (cited in
 * `src/execution/opencode-events.ts`). Asserts real runtime frames become EV1 (plan),
 * EV2 (step), EV3 (tool call), EV4 (file mutation), S2 (token), and terminal events —
 * forwarded, never fabricated — and that unmapped/foreign frames are handled explicitly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import type { RawOpencodeEvent } from "../src/execution/index.js";
import {
  createEvMapper,
  decodeSseChunk,
  foldEv,
  KNOWN_IGNORED_FRAME_TYPES,
} from "../src/execution/index.js";

const SID = "session-a";
const NOW = () => "2026-07-11T00:00:00.000Z";

function newMapper(onUnmapped?: (f: RawOpencodeEvent) => void) {
  return onUnmapped
    ? createEvMapper({ sessionId: SID, now: NOW, onUnmapped })
    : createEvMapper({ sessionId: SID, now: NOW });
}

function partFrame(part: Record<string, unknown>): RawOpencodeEvent {
  return { type: "message.part.updated", properties: { part } };
}

test("todo.updated → EV1 plan event with normalized statuses", () => {
  const out = newMapper().map({
    type: "todo.updated",
    properties: {
      sessionID: SID,
      todos: [
        { id: "t1", content: "Read files", status: "in_progress" },
        { id: "t2", content: "Write file", status: "pending" },
        { id: "t3", content: "Done", status: "completed" },
      ],
    },
  });
  assert.equal(out.length, 1);
  const plan = out[0] as Extract<EvEvent, { kind: "plan" }>;
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.todos.map((t) => t.status), ["running", "pending", "completed"]);
  assert.equal(plan.todos[0]?.title, "Read files");
});

test("a completed write tool part → EV3 tool_call + EV4 file_mutation", () => {
  const out = newMapper().map(
    partFrame({
      id: "part-write",
      sessionID: SID,
      messageID: "msg-a",
      type: "tool",
      callID: "call-write",
      tool: "write",
      state: {
        status: "completed",
        input: { filePath: "src/a.ts", content: "hello" },
        title: "Write src/a.ts",
      },
    }),
  );
  assert.equal(out.length, 2);
  const call = out[0] as Extract<EvEvent, { kind: "tool_call" }>;
  assert.equal(call.kind, "tool_call");
  assert.equal(call.callId, "call-write");
  assert.equal(call.toolName, "write");
  assert.equal(call.status, "completed");
  // Summary prefers the concrete file path (the tool name is shown separately in the trace).
  assert.equal(call.summary, "src/a.ts");
  const mut = out[1] as Extract<EvEvent, { kind: "file_mutation" }>;
  assert.equal(mut.kind, "file_mutation");
  assert.equal(mut.operation, "create");
  assert.equal(mut.path, "src/a.ts");
});

test("a running tool part → EV3 tool_call only (no premature file_mutation)", () => {
  const out = newMapper().map(
    partFrame({
      id: "p", sessionID: SID, messageID: "m", type: "tool", callID: "c",
      tool: "edit", state: { status: "running", input: { filePath: "src/b.ts" } },
    }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]?.kind, "tool_call");
});

test("step-start / step-finish parts → EV2 step events", () => {
  const start = newMapper().map(partFrame({ id: "s1", sessionID: SID, messageID: "m", type: "step-start" }));
  const finish = newMapper().map(partFrame({ id: "s1", sessionID: SID, messageID: "m", type: "step-finish" }));
  assert.equal((start[0] as Extract<EvEvent, { kind: "step" }>).status, "running");
  assert.equal((finish[0] as Extract<EvEvent, { kind: "step" }>).status, "completed");
});

/** Seed the message role so the assistant-only token gate lets deltas through (as in a real run). */
function assistantMessage(mapper: ReturnType<typeof newMapper>, id: string): void {
  mapper.map({ type: "message.updated", properties: { info: { id, role: "assistant" } } });
}

test("message.part.delta → S2 token event; a text part emits nothing (deltas own tokens)", () => {
  const mapper = newMapper();
  assistantMessage(mapper, "m");
  const tok = mapper.map({
    type: "message.part.delta",
    properties: { sessionID: SID, messageID: "m", partID: "p", field: "text", delta: "Hello" },
  });
  assert.equal(tok.length, 1);
  assert.equal((tok[0] as Extract<EvEvent, { kind: "token" }>).delta, "Hello");

  const textPart = newMapper().map(
    partFrame({ id: "p", sessionID: SID, messageID: "m", type: "text", text: "Hello" }),
  );
  assert.equal(textPart.length, 0);
});

test("message.part.delta with field=reasoning emits NO token (thinking must not leak)", () => {
  const mapper = newMapper();
  assistantMessage(mapper, "m");
  const reasoning = mapper.map({
    type: "message.part.delta",
    properties: { sessionID: SID, messageID: "m", partID: "r", field: "reasoning", delta: "Let me think..." },
  });
  assert.equal(reasoning.length, 0, "reasoning deltas must not become visible tokens");

  // A field-less delta stays backward-compatible (treated as answer text).
  const legacy = mapper.map({
    type: "message.part.delta",
    properties: { sessionID: SID, messageID: "m", partID: "p", delta: "Answer" },
  });
  assert.equal(legacy.length, 1);
  assert.equal((legacy[0] as Extract<EvEvent, { kind: "token" }>).delta, "Answer");
});

test("step-finish part → EV metrics event with token counts + cost (issue #4)", () => {
  const mapper = newMapper();
  assistantMessage(mapper, "m");
  const out = mapper.map(
    partFrame({
      id: "s1",
      sessionID: SID,
      messageID: "m",
      type: "step-finish",
      tokens: { input: 31, output: 126, total: 157, reasoning: 0, cache: { read: 7808, write: 0 } },
      cost: 0.0001,
    }),
  );
  const metrics = out.find((e) => e.kind === "metrics") as Extract<EvEvent, { kind: "metrics" }> | undefined;
  assert.ok(metrics, "a step-finish with usage emits a metrics event");
  assert.equal(metrics.metrics.tokensInput, 31);
  assert.equal(metrics.metrics.tokensOutput, 126);
  assert.equal(metrics.metrics.tokensTotal, 157);
  assert.equal(metrics.metrics.tokensCache, 7808, "cache read+write folded into tokensCache");
  assert.equal(metrics.metrics.costUsd, 0.0001);
});

test("a step-finish with no usage emits no metrics event", () => {
  const mapper = newMapper();
  assistantMessage(mapper, "m");
  const out = mapper.map(partFrame({ id: "s2", sessionID: SID, messageID: "m", type: "step-finish" }));
  assert.equal(out.filter((e) => e.kind === "metrics").length, 0);
});

test("reducer keeps metrics through the terminal fold (completed turn shows usage)", () => {
  const mapper = newMapper();
  assistantMessage(mapper, "m");
  const events = [
    ...mapper.map(
      partFrame({
        id: "s1", sessionID: SID, messageID: "m", type: "step-finish",
        tokens: { input: 31, output: 126, total: 157 }, cost: 0,
      }),
    ),
    ...mapper.map({ type: "session.idle", properties: { sessionID: SID } }),
  ];
  const view = foldEv(SID, events);
  assert.equal(view.terminal, "completed");
  assert.equal(view.metrics?.tokensTotal, 157);
  assert.equal(view.metrics?.tokensInput, 31);
  assert.equal(view.metrics?.tokensOutput, 126);
});

test("session.idle → terminal completed (the only completed source)", () => {
  const out = newMapper().map({ type: "session.idle", properties: { sessionID: SID } });
  assert.equal(out.length, 1);
  const term = out[0] as Extract<EvEvent, { kind: "terminal" }>;
  assert.equal(term.state, "completed");
});

test("session.error(ProviderAuthError) → EV6 error(recovery) + terminal errored", () => {
  const out = newMapper().map({
    type: "session.error",
    properties: { sessionID: SID, error: { name: "ProviderAuthError", message: "auth failed" } },
  });
  assert.equal(out.length, 2);
  const err = out[0] as Extract<EvEvent, { kind: "error" }>;
  assert.equal(err.message, "auth failed");
  assert.equal(err.recovery?.kind, "reconfigure_credential");
  assert.equal((out[1] as Extract<EvEvent, { kind: "terminal" }>).state, "errored");
});

test("session.error(MessageAbortedError) → terminal cancelled (not errored, not completed)", () => {
  const out = newMapper().map({
    type: "session.error",
    properties: { sessionID: SID, error: { name: "MessageAbortedError" } },
  });
  assert.equal(out.length, 1);
  assert.equal((out[0] as Extract<EvEvent, { kind: "terminal" }>).state, "cancelled");
});

test("monotonic seq is assigned per emitted event and resumes from startSeq", () => {
  const mapper = createEvMapper({ sessionId: SID, now: () => "t", startSeq: 40 });
  const out = mapper.map({
    type: "session.error",
    properties: { sessionID: SID, error: { name: "X" } },
  });
  assert.equal(out[0]?.seq, 41);
  assert.equal(out[1]?.seq, 42);
  assert.equal(mapper.lastSeq(), 42);
});

test("frames for another session are dropped silently (multiplexed /event stream)", () => {
  let unmapped = 0;
  const out = newMapper(() => { unmapped += 1; }).map({
    type: "session.idle", properties: { sessionID: "other-session" },
  });
  assert.equal(out.length, 0);
  assert.equal(unmapped, 0);
});

test("MEDIUM-2: session.idle needs exact session attribution — unresolvable owner is dropped", () => {
  // A terminal-producing frame with NO resolvable sessionID must NOT fabricate a
  // completed/terminal for this bound session on the multiplexed /event stream.
  const mapper = createEvMapper({ sessionId: SID, now: NOW });
  const noOwner = mapper.map({ type: "session.idle", properties: {} });
  assert.equal(noOwner.length, 0);
  assert.equal(mapper.lastSeq(), 0, "a dropped terminal frame must not consume a seq");

  // A session.idle for a DIFFERENT session is dropped.
  const foreign = mapper.map({ type: "session.idle", properties: { sessionID: "other" } });
  assert.equal(foreign.length, 0);
  assert.equal(mapper.lastSeq(), 0);

  // Only a session.idle whose sessionID === the bound session yields completed.
  const mine = mapper.map({ type: "session.idle", properties: { sessionID: SID } });
  assert.equal(mine.length, 1);
  assert.equal((mine[0] as Extract<EvEvent, { kind: "terminal" }>).state, "completed");
});

test("MEDIUM-2: session.error with an unresolvable sessionID emits no error/terminal", () => {
  const mapper = createEvMapper({ sessionId: SID, now: NOW });
  const out = mapper.map({ type: "session.error", properties: { error: { name: "X" } } });
  assert.equal(out.length, 0);
  assert.equal(mapper.lastSeq(), 0);
});

test("a genuinely unknown frame type is reported to onUnmapped and dropped (drift detection)", () => {
  const seen: RawOpencodeEvent[] = [];
  // Use a type that is NEITHER dispatched NOR recognised housekeeping — real drift.
  const out = newMapper((f) => seen.push(f)).map({
    type: "cghc.brand.new.frame.type", properties: { sessionID: SID },
  });
  assert.equal(out.length, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.type, "cghc.brand.new.frame.type");
});

test("recognised housekeeping frames (CGHC-024 live vocabulary) are ignored, NOT unmapped", () => {
  // These are real pinned-OpenCode frames observed in the CGHC-024 captures; they carry no
  // EV meaning and must be dropped WITHOUT being flagged as drift.
  for (const type of KNOWN_IGNORED_FRAME_TYPES) {
    const seen: RawOpencodeEvent[] = [];
    const out = newMapper((f) => seen.push(f)).map({ type, properties: { sessionID: SID } });
    assert.equal(out.length, 0, `${type} must emit no EV`);
    assert.equal(seen.length, 0, `${type} is recognised housekeeping, not unmapped drift`);
  }
});

test("captured raw SSE wire text decodes to the same frame and maps identically", () => {
  const wire = `event: message\ndata: ${JSON.stringify({ type: "session.idle", properties: { sessionID: SID } })}\n\n`;
  const frames = decodeSseChunk(wire);
  assert.equal(frames.length, 1);
  const out = newMapper().map(frames[0]);
  assert.equal((out[0] as Extract<EvEvent, { kind: "terminal" }>).state, "completed");
});

test("a malformed/non-event value is reported unmapped, never fabricates an event", () => {
  const seen: RawOpencodeEvent[] = [];
  const out = newMapper((f) => seen.push(f)).map("not-a-frame");
  assert.equal(out.length, 0);
  assert.equal(seen.length, 1);
});
