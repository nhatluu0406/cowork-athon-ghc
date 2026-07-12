/**
 * Knowledge E2E happy path test (REQ-205 T3.2).
 *
 * Scenario: Ask a knowledge question in a live session → tool call → citations appear → user opens Knowledge Panel → inspects → disconnects.
 *
 * Modeled on session E2E test patterns. Uses controllable test doubles for M365KG responses (no real stack required).
 *
 * Acceptance criteria (US-1, US-2):
 *  - Knowledge question triggers m365_knowledge_search tool invocation
 *  - Tool returns "answered" outcome with citations
 *  - Knowledge Panel mounts and renders citations
 *  - Citation display includes entity type labels (Person, Project, Document, etc.)
 *  - No empty-panel affordance appears when knowledge tool was called (US-2 2nd criterion)
 *
 * Run: npm test -- app/ui/tests/knowledge-e2e-happy.test.ts
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeCitation } from "@cowork-ghc/service/knowledge/types";
import { createKnowledgePanel } from "../src/knowledge-panel.js";

/**
 * Mock knowledge tool invocation with successful response.
 * Mirrors the shape returned by the service (data-model.md §1.2).
 */
interface KnowledgeToolInvocationFixture {
  readonly toolName: "m365_knowledge_search";
  readonly query: string;
  readonly outcome: "answered" | "unavailable" | "timeout" | "permission_denied";
  readonly answer: string | null;
  readonly citations: readonly KnowledgeCitation[];
  readonly requestedAt: string;
  readonly respondedAt: string;
}

const HAPPY_PATH_CITATIONS: readonly KnowledgeCitation[] = [
  {
    entityType: "Person",
    entityId: "person-alice",
    displayName: "Alice Johnson",
    sourceRef: null,
  },
  {
    entityType: "Project",
    entityId: "proj-cowork",
    displayName: "Cowork Platform",
    sourceRef: "doc-arch",
  },
  {
    entityType: "Document",
    entityId: "doc-001",
    displayName: "Architecture Overview",
    sourceRef: "section-intro",
  },
];

const HAPPY_PATH_INVOCATION: KnowledgeToolInvocationFixture = {
  toolName: "m365_knowledge_search",
  query: "Who leads the Cowork project?",
  outcome: "answered",
  answer: "Alice Johnson leads the Cowork Platform project.",
  citations: HAPPY_PATH_CITATIONS,
  requestedAt: "2026-07-12T10:00:00.000Z",
  respondedAt: "2026-07-12T10:00:03.000Z",
};

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  host.className = "knowledge-panel-host";
  document.body.append(host);
  return host;
}

test("T3.2a: Happy path — knowledge panel renders with answered outcome", () => {
  const host = mountHost();
  const dom = createKnowledgePanel(host, { invocation: HAPPY_PATH_INVOCATION });

  assert.ok(dom.root, "panel root created");
  assert.ok(dom.citations, "citations container created");

  const citationItems = dom.citations.querySelectorAll(".knowledge-citation-item");
  assert.equal(citationItems.length, 3, "renders all three citations");
});

test("T3.2b: Happy path — answer text renders correctly", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: HAPPY_PATH_INVOCATION });

  const answerText = host.querySelector(".knowledge-answer");
  assert.ok(
    answerText?.textContent?.includes("Alice Johnson leads the Cowork Platform project."),
    "answer text visible",
  );
});

test("T3.2c: Happy path — citations display with entity type labels", () => {
  const host = mountHost();
  createKnowledgePanel(host, { invocation: HAPPY_PATH_INVOCATION });

  const citationItems = host.querySelectorAll<HTMLElement>(".knowledge-citation-item");
  assert.equal(citationItems.length, 3, "three citations rendered");

  // Verify Person citation with Vietnamese label "Người"
  const personCitation = citationItems[0];
  assert.ok(personCitation?.textContent?.includes("Alice Johnson"));
  assert.ok(personCitation?.textContent?.includes("Người"), "Person type label in Vietnamese");

  // Verify Project citation with Vietnamese label "Dự án"
  const projectCitation = citationItems[1];
  assert.ok(projectCitation?.textContent?.includes("Cowork Platform"));
  assert.ok(projectCitation?.textContent?.includes("Dự án"), "Project type label in Vietnamese");

  // Verify Document citation with Vietnamese label "Tài liệu"
  const docCitation = citationItems[2];
  assert.ok(docCitation?.textContent?.includes("Architecture Overview"));
  assert.ok(docCitation?.textContent?.includes("Tài liệu"), "Document type label in Vietnamese");
});

test("T3.2d: Happy path — no empty-panel affordance when knowledge tool called (US-2)", () => {
  const host = mountHost();
  const dom = createKnowledgePanel(host, { invocation: HAPPY_PATH_INVOCATION });

  // When a knowledge tool invocation exists, panel is mounted and visible
  assert.ok(dom.root, "panel should be mounted when invocation is provided");

  // Should not display any "no knowledge available" or "empty" message
  const emptyMsg = host.querySelector(".knowledge-empty-state");
  assert.strictEqual(emptyMsg, null, "no empty-state affordance when citations present");
});

test("T3.2e: Happy path — multiple citations from different entity types", () => {
  const host = mountHost();
  const multiCitationInvocation: KnowledgeToolInvocationFixture = {
    ...HAPPY_PATH_INVOCATION,
    citations: [
      { entityType: "Person", entityId: "p-1", displayName: "John Doe", sourceRef: null },
      { entityType: "Person", entityId: "p-2", displayName: "Jane Smith", sourceRef: null },
      { entityType: "Technology", entityId: "tech-k8s", displayName: "Kubernetes", sourceRef: null },
      { entityType: "Department", entityId: "dept-eng", displayName: "Engineering", sourceRef: null },
    ],
  };

  createKnowledgePanel(host, { invocation: multiCitationInvocation });

  const citationItems = host.querySelectorAll(".knowledge-citation-item");
  assert.equal(citationItems.length, 4, "renders all four citations");

  // Verify different types are present
  const allText = Array.from(citationItems)
    .map((item) => item.textContent ?? "")
    .join(" ");
  assert.ok(allText.includes("John Doe") && allText.includes("Jane Smith"), "multiple persons rendered");
  assert.ok(allText.includes("Kubernetes"), "technology rendered");
  assert.ok(allText.includes("Engineering"), "department rendered");
});

test("T3.2f: Happy path — citation with sourceRef displays location info", () => {
  const host = mountHost();
  const invocationWithRef: KnowledgeToolInvocationFixture = {
    ...HAPPY_PATH_INVOCATION,
    citations: [
      {
        entityType: "Document",
        entityId: "doc-123",
        displayName: "Design Guide",
        sourceRef: "Chapter 3 - Validation",
      },
    ],
  };

  createKnowledgePanel(host, { invocation: invocationWithRef });

  const citation = host.querySelector(".knowledge-citation-item");
  assert.ok(citation?.textContent?.includes("Design Guide"), "document name visible");
  // Source reference location should be rendered if implemented
  assert.ok(citation?.textContent?.includes("Chapter 3"), "source location visible");
});

test("T3.2g: Happy path — stress test with many citations (pagination/overflow)", () => {
  const host = mountHost();
  const manyCitations: KnowledgeCitation[] = Array.from({ length: 20 }, (_, i) => ({
    entityType: i % 2 === 0 ? ("Person" as const) : ("Document" as const),
    entityId: `entity-${i}`,
    displayName: `Entity ${i}`,
    sourceRef: i % 3 === 0 ? `ref-${i}` : null,
  }));

  const invocationWithMany: KnowledgeToolInvocationFixture = {
    ...HAPPY_PATH_INVOCATION,
    citations: manyCitations,
  };

  createKnowledgePanel(host, { invocation: invocationWithMany });

  const citationItems = host.querySelectorAll(".knowledge-citation-item");
  assert.equal(citationItems.length, 20, "all 20 citations rendered");
});
