/**
 * Knowledge panel component tests (T2.1).
 *
 * Tests rendering of citations from a KnowledgeToolInvocation fixture,
 * and verifies no panel appears when a turn has no knowledge-tool call (US-2 requirement).
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeCitation } from "@cowork-ghc/service/knowledge/types";
import { createKnowledgePanel } from "../src/knowledge-panel.js";

/** Fixture: a knowledge tool invocation with citations. */
interface KnowledgeToolInvocationFixture {
  readonly toolName: "m365_knowledge_search";
  readonly query: string;
  readonly outcome: "answered" | "unavailable" | "timeout" | "permission_denied";
  readonly answer: string | null;
  readonly citations: readonly KnowledgeCitation[];
  readonly syncedAt: string | null;
  readonly requestedAt: string;
  readonly respondedAt: string;
}

const SAMPLE_CITATIONS: readonly KnowledgeCitation[] = [
  {
    entityType: "Person",
    entityId: "p-123",
    displayName: "Alice Johnson",
    sourceRef: null,
  },
  {
    entityType: "Project",
    entityId: "proj-456",
    displayName: "Project Cowork",
    sourceRef: "doc-789",
  },
  {
    entityType: "Document",
    entityId: "doc-001",
    displayName: "Architecture Guide",
    sourceRef: "chunk-abc",
  },
];

const KNOWLEDGE_FIXTURE: KnowledgeToolInvocationFixture = {
  toolName: "m365_knowledge_search",
  query: "Who is responsible for the Cowork project?",
  outcome: "answered",
  answer: "Alice Johnson leads the Cowork project.",
  citations: SAMPLE_CITATIONS,
  syncedAt: "2026-07-12T10:00:00.000Z",
  requestedAt: "2026-07-12T10:00:00.000Z",
  respondedAt: "2026-07-12T10:00:05.000Z",
};

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  host.className = "knowledge-panel-host";
  document.body.append(host);
  return host;
}

test("T2.1a: renders citation list from KnowledgeToolInvocation fixture", () => {
  const host = mountHost();
  const dom = createKnowledgePanel(host, { invocation: KNOWLEDGE_FIXTURE });

  assert.ok(dom.root, "panel root created");
  assert.ok(dom.citations, "citations container created");

  const citationItems = dom.citations.querySelectorAll(".knowledge-citation-item");
  assert.equal(citationItems.length, 3, "renders all three citations");

  // Verify first citation (Person — Vietnamese label "Người")
  const firstCitation = citationItems[0];
  assert.ok(firstCitation?.textContent?.includes("Alice Johnson"));
  assert.ok(firstCitation?.textContent?.includes("Người")); // Vietnamese for "Person"

  // Verify second citation (Project — Vietnamese label "Dự án")
  const secondCitation = citationItems[1];
  assert.ok(secondCitation?.textContent?.includes("Project Cowork"));
  assert.ok(secondCitation?.textContent?.includes("Dự án")); // Vietnamese for "Project"

  // Verify third citation (Document — Vietnamese label "Tài liệu")
  const thirdCitation = citationItems[2];
  assert.ok(thirdCitation?.textContent?.includes("Architecture Guide"));
  assert.ok(thirdCitation?.textContent?.includes("Tài liệu")); // Vietnamese for "Document"
});

test("T2.1b: displays answer text from invocation", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: KNOWLEDGE_FIXTURE });

  const answerText = host.querySelector(".knowledge-answer");
  assert.ok(answerText?.textContent?.includes("Alice Johnson leads the Cowork project."));
});

test("T2.1c: does not render panel when invocation is null (no knowledge-tool call, US-2)", () => {
  const host = mountHost();
  const dom = createKnowledgePanel(host, { invocation: null });

  // Panel should be created but hidden/empty
  assert.ok(dom.root, "root element exists");
  assert.equal(dom.root.hidden, true, "panel is hidden when no invocation");
  assert.equal(dom.citations.children.length, 0, "citations are empty");
});

test("T2.1d: handles unavailable outcome gracefully", () => {
  const host = mountHost();
  const unavailableFixture: KnowledgeToolInvocationFixture = {
    ...KNOWLEDGE_FIXTURE,
    outcome: "unavailable",
    answer: null,
    citations: [],
  };

  const dom = createKnowledgePanel(host, { invocation: unavailableFixture });

  const statusText = host.querySelector(".knowledge-status");
  assert.ok(statusText?.textContent?.includes("Không khả dụng"));
  assert.equal(dom.citations.children.length, 0, "no citations rendered");
});

test("T2.1e: handles timeout outcome gracefully", () => {
  const host = mountHost();
  const timeoutFixture: KnowledgeToolInvocationFixture = {
    ...KNOWLEDGE_FIXTURE,
    outcome: "timeout",
    answer: null,
    citations: [],
  };

  const dom = createKnowledgePanel(host, { invocation: timeoutFixture });

  const statusText = host.querySelector(".knowledge-status");
  assert.ok(statusText?.textContent?.includes("Hết thời gian"));
  assert.equal(dom.citations.children.length, 0, "no citations rendered");
});

test("T2.1f: shows query that was asked", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: KNOWLEDGE_FIXTURE });

  const queryText = host.querySelector(".knowledge-query");
  assert.ok(queryText?.textContent?.includes("Who is responsible for the Cowork project?"));
});

test("T2.1g: Vietnamese labels are used throughout", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: KNOWLEDGE_FIXTURE });

  // Check for Vietnamese section labels
  const labels = host.textContent ?? "";
  assert.ok(labels.includes("Trích dẫn") || labels.includes("Lập chỉ mục"), "Vietnamese labels present");
});
