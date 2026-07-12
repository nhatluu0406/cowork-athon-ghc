/**
 * `m365_knowledge_search` tool test (REQ-205 T1.3) — THE most safety-critical test in Phase 1:
 * a `PermissionGate` denial must make the mocked `KnowledgeSourceClient`/query port
 * UNREACHABLE, not merely skip a UI confirmation (P3, "deny must actually prevent the action").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryAuditSink, createPermissionGate } from "../../src/permission/index.js";
import { classifyApprovalLevel } from "../../src/permission/approval-level.js";
import {
  createFakeTime,
  recordingDenialSink,
  recordingReplyPort,
} from "../permission-fakes.js";
import {
  createKnowledgeTool,
  M365_KNOWLEDGE_ACTION_KIND,
  M365_KNOWLEDGE_TOOL_NAME,
  type KnowledgeQueryPort,
} from "../../src/knowledge/tool.js";
import type { KnowledgeQueryOutcome } from "../../src/knowledge/types.js";

const TIMEOUT_MS = 30_000;

function harness() {
  const reply = recordingReplyPort();
  const denial = recordingDenialSink();
  const audit = createInMemoryAuditSink();
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply,
    audit,
    session: denial,
    scheduler: time.scheduler,
    timeoutMs: TIMEOUT_MS,
    now: time.now,
  });
  return { gate, reply, denial, audit, time };
}

function spyPort(outcome: KnowledgeQueryOutcome): { readonly port: KnowledgeQueryPort; readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    port: {
      async query(queryText: string) {
        calls.push(queryText);
        return outcome;
      },
    },
  };
}

test("M365_KNOWLEDGE_ACTION_KIND is the additive network_access kind, classified standard", () => {
  assert.equal(M365_KNOWLEDGE_ACTION_KIND, "network_access");
  assert.equal(classifyApprovalLevel(M365_KNOWLEDGE_ACTION_KIND), "standard");
  assert.equal(M365_KNOWLEDGE_TOOL_NAME, "m365_knowledge_search");
});

test("DENY: the M365KG query port is NEVER called — no bypass of a denial", async () => {
  const h = harness();
  const { port, calls } = spyPort({ outcome: "answered", answer: "should never be seen", citations: [], syncedAt: null });
  const tool = createKnowledgeTool({ gate: h.gate, port, now: h.time.now });

  tool.requestPermission({ requestId: "req-1", sessionId: "sess-1", query: "Ai biết về X?" });
  const resolution = await h.gate.resolve({ requestId: "req-1", decision: "deny" });
  assert.equal(resolution.status, "resolved");

  const result = await tool.invoke("req-1", "Ai biết về X?");

  assert.deepEqual(result, { outcome: "permission_denied", answer: null, citations: [], syncedAt: null });
  assert.deepEqual(calls, [], "the query port must NEVER be invoked after a deny");
  assert.deepEqual(h.denial.denied, ["sess-1"], "the session was driven terminal (P3, no strand)");
});

test("PENDING (no decision yet): invoke() still cannot reach the port", async () => {
  const h = harness();
  const { port, calls } = spyPort({ outcome: "answered", answer: "x", citations: [], syncedAt: null });
  const tool = createKnowledgeTool({ gate: h.gate, port, now: h.time.now });

  tool.requestPermission({ requestId: "req-2", sessionId: "sess-2", query: "Q" });
  const result = await tool.invoke("req-2", "Q");

  assert.equal(result.outcome, "permission_denied");
  assert.deepEqual(calls, []);
});

test("UNKNOWN requestId (invoke without ever requesting permission): the port is never called", async () => {
  const h = harness();
  const { port, calls } = spyPort({ outcome: "answered", answer: "x", citations: [], syncedAt: null });
  const tool = createKnowledgeTool({ gate: h.gate, port, now: h.time.now });

  const result = await tool.invoke("never-submitted", "Q");
  assert.equal(result.outcome, "permission_denied");
  assert.deepEqual(calls, []);
});

test("FAIL-CLOSED TIMEOUT (P6): an unanswered request auto-denies, and the port is never called", async () => {
  const h = harness();
  const { port, calls } = spyPort({ outcome: "answered", answer: "x", citations: [], syncedAt: null });
  const tool = createKnowledgeTool({ gate: h.gate, port, now: h.time.now });

  tool.requestPermission({ requestId: "req-3", sessionId: "sess-3", query: "Q" });
  h.time.advance(TIMEOUT_MS); // fires the fail-closed timer — no explicit decision ever arrives

  const result = await tool.invoke("req-3", "Q");
  assert.equal(result.outcome, "permission_denied");
  assert.deepEqual(calls, []);
});

test("ALLOW: the port is called exactly once, and the outcome maps to the tool result shape", async () => {
  const h = harness();
  const { port, calls } = spyPort({
    outcome: "answered",
    answer: "Kết quả thật",
    citations: [{ entityType: "Project", entityId: "proj-1", displayName: "Dự án A", sourceRef: null }],
    syncedAt: "2026-07-12T09:00:00Z",
  });
  const tool = createKnowledgeTool({ gate: h.gate, port, now: h.time.now });

  tool.requestPermission({ requestId: "req-4", sessionId: "sess-4", query: "Dự án nào đang chạy?" });
  await h.gate.resolve({ requestId: "req-4", decision: "allow" });

  const result = await tool.invoke("req-4", "Dự án nào đang chạy?");
  assert.equal(result.outcome, "answered");
  assert.equal(result.answer, "Kết quả thật");
  assert.equal(result.citations.length, 1);
  assert.deepEqual(calls, ["Dự án nào đang chạy?"], "the port is invoked exactly once, only after Allow");
});

test("ALLOW scope 'once' is consumed — a second invoke() with the same requestId cannot replay the call", async () => {
  const h = harness();
  const { port, calls } = spyPort({ outcome: "answered", answer: "x", citations: [], syncedAt: null });
  const tool = createKnowledgeTool({ gate: h.gate, port, now: h.time.now });

  tool.requestPermission({ requestId: "req-5", sessionId: "sess-5", query: "Q" });
  await h.gate.resolve({ requestId: "req-5", decision: "allow", scope: "once" });

  const first = await tool.invoke("req-5", "Q");
  assert.equal(first.outcome, "answered");
  const second = await tool.invoke("req-5", "Q");
  assert.equal(second.outcome, "permission_denied", "a consumed 'once' allow cannot be replayed");
  assert.deepEqual(calls, ["Q"], "the port was called exactly once across both invoke() calls");
});

test("ALLOW: a non-answered client outcome (unavailable/timeout) maps through, still only after Allow", async () => {
  const h = harness();
  const { port, calls } = spyPort({ outcome: "timeout" });
  const tool = createKnowledgeTool({ gate: h.gate, port, now: h.time.now });

  tool.requestPermission({ requestId: "req-6", sessionId: "sess-6", query: "Q" });
  await h.gate.resolve({ requestId: "req-6", decision: "allow" });

  const result = await tool.invoke("req-6", "Q");
  assert.deepEqual(result, { outcome: "timeout", answer: null, citations: [], syncedAt: null });
  assert.deepEqual(calls, ["Q"]);
});

test("the submitted PermissionRequest never carries a secret-shaped description", async () => {
  const h = harness();
  const { port } = spyPort({ outcome: "answered", answer: "x", citations: [], syncedAt: null });
  const tool = createKnowledgeTool({ gate: h.gate, port, now: h.time.now });

  tool.requestPermission({ requestId: "req-7", sessionId: "sess-7", query: "bí mật lương CEO" });
  const [pending] = h.gate.pending();
  assert.ok(pending);
  assert.equal(pending!.action.kind, "network_access");
  assert.equal(pending!.approvalLevel, "standard");
  // The description is a fixed, non-secret label — it must NOT echo the raw user query.
  assert.ok(!pending!.action.description.includes("bí mật lương CEO"));
});
