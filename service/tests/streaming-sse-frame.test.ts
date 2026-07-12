/**
 * CGHC-014 — hop-2 SSE wire framing round-trip.
 *
 * The renderer transport serializes EV events with the same SSE conventions the hop-1 decoder
 * uses (`data:` line + blank-line terminator). Asserts encode→decode is lossless and that a
 * corrupt frame is dropped (never fabricates an EV event).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import {
  decodeEvSseChunk,
  decodeEvSseFrame,
  encodeEvSseFrame,
  encodeSseHeartbeat,
  EV_SSE_EVENT_NAME,
} from "../src/execution/index.js";
import { STREAM_AT, STREAM_SID, terminalEv, tokenEv } from "./streaming-fakes.js";

test("encode → decode round-trips an EV event losslessly", () => {
  const events: EvEvent[] = [
    tokenEv(1, "Hello"),
    { sessionId: STREAM_SID, seq: 2, at: STREAM_AT, kind: "tool_call", callId: "c1", toolName: "write", status: "running" },
    terminalEv(3, "completed"),
  ];
  const wire = events.map(encodeEvSseFrame).join("");
  assert.ok(wire.includes(`event: ${EV_SSE_EVENT_NAME}`), "carries a stable SSE event name");
  const decoded = decodeEvSseChunk(wire);
  assert.deepEqual(decoded, events, "every EV event survives the wire round-trip in order");
});

test("a heartbeat comment carries no EV payload and is ignored by the decoder", () => {
  const wire = encodeSseHeartbeat() + encodeEvSseFrame(tokenEv(1, "x"));
  const decoded = decodeEvSseChunk(wire);
  assert.equal(decoded.length, 1, "heartbeat produced no EV event");
  assert.equal(decoded[0]?.kind, "token");
});

test("a corrupt / non-EV frame is dropped, never fabricated into an event", () => {
  assert.equal(decodeEvSseFrame("data: not-json"), null);
  assert.equal(decodeEvSseFrame("data: {\"kind\":\"nope\",\"seq\":1,\"sessionId\":\"s\"}"), null, "unknown kind rejected");
  assert.equal(decodeEvSseFrame("data: {\"kind\":\"token\",\"seq\":\"x\",\"sessionId\":\"s\"}"), null, "non-numeric seq rejected");
  assert.equal(decodeEvSseFrame(": just a comment"), null);
});

test("a state-bearing frame missing its required field is dropped (review LOW: no fabricated terminal)", () => {
  // A `terminal` with no valid `state` must NOT decode — otherwise it would fold to a bogus
  // terminal status on the renderer.
  assert.equal(
    decodeEvSseFrame('data: {"kind":"terminal","seq":9,"sessionId":"s"}'),
    null,
    "terminal without state rejected",
  );
  assert.equal(
    decodeEvSseFrame('data: {"kind":"terminal","seq":9,"sessionId":"s","state":"bogus"}'),
    null,
    "terminal with an unknown state rejected",
  );
  assert.equal(
    decodeEvSseFrame('data: {"kind":"token","seq":9,"sessionId":"s"}'),
    null,
    "token without a string delta rejected",
  );
  // A well-formed terminal still decodes (the guard did not over-reject).
  assert.equal(decodeEvSseFrame('data: {"kind":"terminal","seq":9,"sessionId":"s","state":"completed","at":"t"}')?.kind, "terminal");
});
