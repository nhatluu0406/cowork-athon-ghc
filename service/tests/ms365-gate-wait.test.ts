/**
 * awaitGateDecision: resolves "allowed" khi gate ghi Allow, "denied" khi request rời pending
 * (Deny tay hoặc fail-closed timeout), hard-cap không treo vô hạn.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitGateDecision } from "../src/ms365/ms365-gate-wait.js";

function fakeGate(initial: { allowed?: boolean; pending?: boolean }) {
  const state = { allowed: initial.allowed ?? false, pending: initial.pending ?? true };
  return {
    state,
    isAllowed: () => state.allowed,
    pending: () => (state.pending ? [{ requestId: "r1" } as never] : []),
  };
}
const instantWait = () => Promise.resolve();

test("already allowed → allowed without waiting", async () => {
  const gate = fakeGate({ allowed: true, pending: false });
  assert.equal(await awaitGateDecision(gate, "r1", instantWait), "allowed");
});

test("allow arriving after 3 polls → allowed", async () => {
  const gate = fakeGate({});
  let polls = 0;
  const wait = () => {
    polls += 1;
    if (polls === 3) { gate.state.allowed = true; gate.state.pending = false; }
    return Promise.resolve();
  };
  assert.equal(await awaitGateDecision(gate, "r1", wait), "allowed");
});

test("request leaving pending without allow (deny/timeout) → denied", async () => {
  const gate = fakeGate({});
  const wait = () => { gate.state.pending = false; return Promise.resolve(); };
  assert.equal(await awaitGateDecision(gate, "r1", wait), "denied");
});

test("unknown requestId (not pending, not allowed) → denied immediately", async () => {
  const gate = fakeGate({ pending: false });
  assert.equal(await awaitGateDecision(gate, "r1", instantWait), "denied");
});

test("hard cap: stuck-pending gate → denied (no infinite hang)", async () => {
  const gate = fakeGate({}); // pending forever
  assert.equal(await awaitGateDecision(gate, "r1", instantWait), "denied");
});
