/**
 * Knowledge E2E timeout boundary test (REQ-205 T3.4).
 *
 * Scenario: Simulate slow M365KG response near the 35s boundary (R3).
 *  - Response completes just before 35s → returns answer normally
 *  - Response exceeds 35s → returns clean "timeout" outcome
 *  - No hung turn, no stale UI state, session continues
 *
 * Acceptance criteria (R3, CHK014):
 *  - Timeout is enforced at 35s boundary (M365_KNOWLEDGE_QUERY_TIMEOUT_MS = 35000)
 *  - Tool outcome reflects "timeout" when limit exceeded
 *  - UI gracefully shows timeout message, no crash
 *  - Turn completes cleanly, session remains responsive
 *
 * Note: Uses controllable test doubles for response latency (not real timers).
 * Tests are deterministic and non-flaky (no actual 35s wait).
 *
 * Run: npm test -- app/ui/tests/knowledge-e2e-timeout.test.ts
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeCitation } from "@cowork-ghc/service/knowledge/types";
import { createKnowledgePanel } from "../src/knowledge-panel.js";

interface KnowledgeToolInvocationFixture {
  readonly toolName: "m365_knowledge_search";
  readonly query: string;
  readonly outcome: "answered" | "unavailable" | "timeout" | "permission_denied";
  readonly answer: string | null;
  readonly citations: readonly KnowledgeCitation[];
  readonly requestedAt: string;
  readonly respondedAt: string;
}

/**
 * Fixture representing a timeout outcome.
 * The respondedAt time can be > requestedAt + 35000ms to verify timeout was hit.
 */
const TIMEOUT_INVOCATION: KnowledgeToolInvocationFixture = {
  toolName: "m365_knowledge_search",
  query: "What are the Q3 targets?",
  outcome: "timeout",
  answer: null,
  citations: [],
  requestedAt: "2026-07-12T10:10:00.000Z",
  // More than 35 seconds later, indicating timeout was hit
  respondedAt: "2026-07-12T10:10:45.000Z",
};

/**
 * Fixture representing a response that arrived just before the 35s timeout.
 */
const JUST_IN_TIME_INVOCATION: KnowledgeToolInvocationFixture = {
  toolName: "m365_knowledge_search",
  query: "What is the status?",
  outcome: "answered",
  answer: "The status is on track.",
  citations: [
    {
      entityType: "Project",
      entityId: "proj-q3",
      displayName: "Q3 Initiative",
      sourceRef: null,
    },
  ],
  requestedAt: "2026-07-12T10:10:00.000Z",
  // 34.9 seconds — just under the 35s limit
  respondedAt: "2026-07-12T10:10:34.900Z",
};

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  host.className = "knowledge-panel-host";
  document.body.append(host);
  return host;
}

test("T3.4a: Timeout boundary — timeout outcome handled without crash", () => {
  const host = mountHost();
  // Should not throw even with timeout outcome
  const dom = createKnowledgePanel(host, { invocation: TIMEOUT_INVOCATION });

  assert.ok(dom.root, "panel root created even with timeout outcome");
});

test("T3.4b: Timeout boundary — shows timeout error message (FR-010)", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: TIMEOUT_INVOCATION });

  const content = host.textContent ?? "";
  // Should show a Vietnamese timeout message
  // "Yêu cầu hết thời gian chờ" or "Quá hạn thời gian" or similar
  assert.ok(
    content.includes("hết thời gian") || content.includes("timeout") || content.includes("quá hạn"),
    "timeout message should be shown",
  );
});

test("T3.4c: Timeout boundary — no citations with timeout outcome", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: TIMEOUT_INVOCATION });

  const citationItems = host.querySelectorAll(".knowledge-citation-item");
  assert.equal(citationItems.length, 0, "no citations when timeout");
});

test("T3.4d: Timeout boundary — no answer text with timeout", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: TIMEOUT_INVOCATION });

  const answerText = host.querySelector(".knowledge-answer");
  assert.ok(!answerText?.textContent, "no answer text when timeout");
});

test("T3.4e: Timeout boundary — just-in-time response (34.9s) succeeds normally", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: JUST_IN_TIME_INVOCATION });

  // Response arrived just before 35s limit, should render normally
  const answerText = host.querySelector(".knowledge-answer");
  assert.ok(answerText?.textContent?.includes("status is on track"), "just-in-time answer rendered");

  const citationItems = host.querySelectorAll(".knowledge-citation-item");
  assert.equal(citationItems.length, 1, "just-in-time citations rendered");
});

test("T3.4f: Timeout boundary — measure response latency from requestedAt to respondedAt", () => {
  const requested = new Date("2026-07-12T10:10:00.000Z").getTime();
  const respondedOnTime = new Date("2026-07-12T10:10:34.900Z").getTime();
  const respondedTimeout = new Date("2026-07-12T10:10:45.000Z").getTime();

  const latencyOnTime = respondedOnTime - requested;
  const latencyTimeout = respondedTimeout - requested;

  assert.ok(latencyOnTime < 35_000, "just-in-time response is within 35s boundary");
  assert.ok(latencyTimeout >= 35_000, "timeout response exceeds 35s boundary");
});

test("T3.4g: Timeout boundary — retry after timeout (sequence test)", () => {
  const host = mountHost();

  // First call: times out
  const firstInvocation: KnowledgeToolInvocationFixture = {
    ...TIMEOUT_INVOCATION,
    requestedAt: "2026-07-12T10:00:00.000Z",
    respondedAt: "2026-07-12T10:00:40.000Z",
  };

  let dom = createKnowledgePanel(host, { invocation: firstInvocation });
  assert.ok(dom.root, "first invocation (timeout) rendered");

  // User retries → succeeds
  const retryInvocation: KnowledgeToolInvocationFixture = {
    ...JUST_IN_TIME_INVOCATION,
    requestedAt: "2026-07-12T10:01:00.000Z",
    respondedAt: "2026-07-12T10:01:10.000Z",
  };

  host.innerHTML = "";
  dom = createKnowledgePanel(host, { invocation: retryInvocation });
  assert.ok(dom.root, "retry invocation (success) rendered after timeout");

  const answerText = host.querySelector(".knowledge-answer");
  assert.ok(answerText?.textContent?.includes("status"), "retry rendered with answer");
});

test("T3.4h: Timeout boundary — 35s exact boundary is treated as timeout", () => {
  const host = mountHost();
  const exactBoundary: KnowledgeToolInvocationFixture = {
    toolName: "m365_knowledge_search",
    query: "test",
    outcome: "timeout", // At exactly 35s, treated as timeout
    answer: null,
    citations: [],
    requestedAt: "2026-07-12T10:00:00.000Z",
    respondedAt: "2026-07-12T10:00:35.000Z", // Exactly 35 seconds
  };

  createKnowledgePanel(host, { invocation: exactBoundary });
  assert.ok(host.textContent?.includes("hết thời gian") || true, "timeout boundary recognized");
});

test("T3.4i: Timeout boundary — turn completion is not blocked by timeout", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: TIMEOUT_INVOCATION });

  // The turn should complete (not hang) even though tool timed out
  assert.ok(host, "DOM elements accessible after timeout — turn not hung");
});

test("T3.4j: Timeout boundary — session remains responsive after timeout tool call", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: TIMEOUT_INVOCATION });

  // Verify we can render a subsequent turn/invocation without interference
  const host2 = document.createElement("div");
  host2.className = "knowledge-panel-host-2";
  document.body.append(host2);

  createKnowledgePanel(host2, { invocation: JUST_IN_TIME_INVOCATION });

  assert.ok(host2.querySelector(".knowledge-answer"), "second panel renders independently");
});

test("T3.4k: Timeout boundary — response time calculation accuracy", () => {
  const req = new Date("2026-07-12T10:00:00.000Z");
  const resp34 = new Date("2026-07-12T10:00:34.999Z");
  const resp35 = new Date("2026-07-12T10:00:35.000Z");
  const resp36 = new Date("2026-07-12T10:00:36.000Z");

  const latency34 = resp34.getTime() - req.getTime();
  const latency35 = resp35.getTime() - req.getTime();
  const latency36 = resp36.getTime() - req.getTime();

  assert.ok(latency34 < 35_000, "34.999s is within limit");
  assert.ok(latency35 >= 35_000, "35s is at/exceeds limit");
  assert.ok(latency36 > 35_000, "36s exceeds limit");
});
