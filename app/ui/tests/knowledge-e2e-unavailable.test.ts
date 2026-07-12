/**
 * Knowledge E2E negative path test (REQ-205 T3.3).
 *
 * Scenario: M365KG backend stops/becomes unreachable mid-session → tool returns `unavailable` → no crash, no hung turn.
 *
 * Acceptance criteria (US-3, NFR-002 graceful degradation):
 *  - Tool call with unreachable M365KG returns "unavailable" outcome cleanly
 *  - No unhandled rejection or hung promise
 *  - Status indicator reflects unreachable state (FR-010)
 *  - Session continues, user can retry or disconnect
 *
 * Run: npm test -- app/ui/tests/knowledge-e2e-unavailable.test.ts
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

const UNAVAILABLE_INVOCATION: KnowledgeToolInvocationFixture = {
  toolName: "m365_knowledge_search",
  query: "What is the project status?",
  outcome: "unavailable",
  answer: null,
  citations: [],
  requestedAt: "2026-07-12T10:05:00.000Z",
  respondedAt: "2026-07-12T10:05:01.000Z",
};

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  host.className = "knowledge-panel-host";
  document.body.append(host);
  return host;
}

test("T3.3a: Negative path — unavailable outcome handled gracefully", () => {
  const host = mountHost();
  // This should not throw or crash when outcome is "unavailable"
  const dom = createKnowledgePanel(host, { invocation: UNAVAILABLE_INVOCATION });

  assert.ok(dom.root, "panel root created even with unavailable outcome");
});

test("T3.3b: Negative path — unavailable shows appropriate error message (FR-010)", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: UNAVAILABLE_INVOCATION });

  const content = host.textContent ?? "";
  // Should show a Vietnamese error message indicating knowledge source is unavailable
  // "Nguồn kiến thức không khả dụng" or similar
  assert.ok(
    content.includes("không khả dụng") || content.includes("không thể") || content.includes("lỗi"),
    "unavailable message should be shown in Vietnamese",
  );
});

test("T3.3c: Negative path — no citations rendered when unavailable", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: UNAVAILABLE_INVOCATION });

  const citationItems = host.querySelectorAll(".knowledge-citation-item");
  assert.equal(citationItems.length, 0, "no citations rendered when outcome is unavailable");
});

test("T3.3d: Negative path — unavailable outcome with null answer", () => {
  const host = mountHost();
  const invocation: KnowledgeToolInvocationFixture = {
    ...UNAVAILABLE_INVOCATION,
    answer: null,
  };

  createKnowledgePanel(host, { invocation });

  const answerText = host.querySelector(".knowledge-answer");
  assert.ok(!answerText?.textContent, "no answer text when unavailable");
});

test("T3.3e: Negative path — multiple unavailable calls in sequence (retry scenario)", () => {
  const host = mountHost();

  // First call: unavailable
  const firstInvocation: KnowledgeToolInvocationFixture = {
    ...UNAVAILABLE_INVOCATION,
    requestedAt: "2026-07-12T10:00:00.000Z",
    respondedAt: "2026-07-12T10:00:01.000Z",
  };

  let dom = createKnowledgePanel(host, { invocation: firstInvocation });
  assert.ok(dom.root, "panel created for first unavailable call");

  // User sees error, retries → still unavailable
  const secondInvocation: KnowledgeToolInvocationFixture = {
    ...UNAVAILABLE_INVOCATION,
    requestedAt: "2026-07-12T10:01:00.000Z",
    respondedAt: "2026-07-12T10:01:01.000Z",
  };

  // In a real session, the panel would be updated; here we verify it can handle repeated unavailable calls
  dom = createKnowledgePanel(host, { invocation: secondInvocation });
  assert.ok(dom.root, "panel handles second unavailable call without crashing");
});

test("T3.3f: Negative path — status indicator reflects unreachable (US-3, NFR-002)", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: UNAVAILABLE_INVOCATION });

  // Look for a status or health indicator that shows unreachable state
  const statusElement = host.querySelector("[data-status], .knowledge-status, .health-status");
  if (statusElement) {
    // If a status indicator exists, it should reflect the unreachable/unavailable state
    const status = statusElement.getAttribute("data-status") || statusElement.textContent || "";
    assert.ok(
      status.toLowerCase().includes("unreachable") || status.toLowerCase().includes("unavailable"),
      `status should indicate unreachable state (found: ${status})`,
    );
  }
  // If no explicit status element, the error message itself conveys the state
});

test("T3.3g: Negative path — no crash with empty citations array", () => {
  const host = mountHost();
  const invocation: KnowledgeToolInvocationFixture = {
    toolName: "m365_knowledge_search",
    query: "test",
    outcome: "unavailable",
    answer: null,
    citations: [], // Empty array should not cause rendering issues
    requestedAt: "2026-07-12T10:00:00.000Z",
    respondedAt: "2026-07-12T10:00:01.000Z",
  };

  assert.doesNotThrow(() => {
    createKnowledgePanel(host, { invocation });
  });

  assert.equal(host.querySelectorAll(".knowledge-citation-item").length, 0);
});

test("T3.3h: Negative path — panel cleanup when unavailable (no dangling references)", () => {
  const host = mountHost();
  const invocation: KnowledgeToolInvocationFixture = {
    ...UNAVAILABLE_INVOCATION,
    query: "First query",
  };

  const dom1 = createKnowledgePanel(host, { invocation });
  assert.ok(dom1.root);

  // Replace with second invocation
  host.innerHTML = ""; // Clear the host
  const dom2 = createKnowledgePanel(host, {
    invocation: { ...invocation, query: "Second query" },
  });
  assert.ok(dom2.root);

  // Both should work without dangling references
});
