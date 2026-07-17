/**
 * Knowledge graph view component tests (T2.2).
 *
 * Tests truncation at KNOWLEDGE_PANEL_MAX_NODES = 50,
 * explicit "N more not shown" affordance, and render performance budget (300ms on >50-node fixture).
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_PANEL_MAX_NODES,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  type KnowledgeGraphResult,
} from "@cowork-ghc/service/knowledge/types";
import { createKnowledgeGraphView } from "../src/knowledge-graph-view.js";

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  host.className = "knowledge-graph-host";
  document.body.append(host);
  return host;
}

/**
 * Create a fixture graph with N nodes and edges.
 * Useful for testing truncation boundary.
 */
function createGraphFixture(nodeCount: number): KnowledgeGraphResult {
  const nodes: KnowledgeGraphNode[] = [];
  const edges: KnowledgeGraphEdge[] = [];

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node-${i}`,
      label: `Entity ${i}`,
      properties: { type: i % 3 === 0 ? "Person" : i % 3 === 1 ? "Project" : "Document" },
    });

    // Add edges between consecutive nodes for a chain-like graph
    if (i > 0) {
      edges.push({
        from: `node-${i - 1}`,
        to: `node-${i}`,
        type: "relatedTo",
      });
    }
  }

  return {
    nodes,
    edges,
    truncated: nodeCount > KNOWLEDGE_PANEL_MAX_NODES,
  };
}

test("T2.2a: renders graph with nodes under 50", () => {
  const host = mountHost();
  const fixture = createGraphFixture(30);

  const dom = createKnowledgeGraphView(host, { graph: fixture });

  assert.ok(dom.svg, "SVG canvas created");
  assert.ok(dom.nodeContainer, "node container created");

  const nodeElements = dom.nodeContainer.querySelectorAll(".knowledge-graph-node");
  assert.equal(nodeElements.length, 30, "renders all 30 nodes");
  assert.ok(!host.textContent?.includes("more not shown"), "no truncation message");
});

test("T2.2b: truncates at KNOWLEDGE_PANEL_MAX_NODES = 50", () => {
  const host = mountHost();
  const fixture = createGraphFixture(75);

  const dom = createKnowledgeGraphView(host, { graph: fixture });

  const nodeElements = dom.nodeContainer.querySelectorAll(".knowledge-graph-node");
  assert.equal(nodeElements.length, KNOWLEDGE_PANEL_MAX_NODES, `renders max ${KNOWLEDGE_PANEL_MAX_NODES} nodes`);
});

test("T2.2c: shows explicit 'N more not shown' affordance when truncated", () => {
  const host = mountHost();
  const fixture = createGraphFixture(95); // 95 total, will truncate to 50, showing 45 more

  createKnowledgeGraphView(host, { graph: fixture });

  const truncationMessage = host.querySelector(".knowledge-graph-truncation-message");
  assert.ok(truncationMessage, "truncation message exists");

  const messageText = truncationMessage.textContent ?? "";
  assert.ok(messageText.includes("45"), "shows correct count of hidden nodes (95 - 50 = 45)");
  assert.ok(messageText.includes("Không hiển thị") || messageText.includes("thêm"), "Vietnamese truncation message");
});

test("T2.2d: renders edges between nodes", () => {
  const host = mountHost();
  const fixture = createGraphFixture(20);

  const dom = createKnowledgeGraphView(host, { graph: fixture });

  const edgeElements = dom.edgeContainer.querySelectorAll(".knowledge-graph-edge");
  assert.equal(edgeElements.length, 19, "renders all edges (20 nodes = 19 edges in chain)");
});

test("T2.2e: truncates edges when nodes are truncated", () => {
  const host = mountHost();
  const fixture = createGraphFixture(75); // 75 nodes, 74 edges

  const dom = createKnowledgeGraphView(host, { graph: fixture });

  const edgeElements = dom.edgeContainer.querySelectorAll(".knowledge-graph-edge");
  // Only edges that connect to nodes within the first 50 should be rendered
  assert.ok(edgeElements.length <= 49, "edges are truncated along with nodes");
});

test("T2.2f: performance: renders 50+ nodes within 300ms budget", async () => {
  const host = mountHost();
  const largeFixture = createGraphFixture(100);

  const startTime = performance.now();
  createKnowledgeGraphView(host, { graph: largeFixture });
  const endTime = performance.now();

  const renderTime = endTime - startTime;
  assert.ok(renderTime < 300, `render completed in ${renderTime.toFixed(1)}ms (budget: 300ms)`);
});

test("T2.2g: empty graph renders gracefully", () => {
  const host = mountHost();
  const emptyFixture: KnowledgeGraphResult = {
    nodes: [],
    edges: [],
    truncated: false,
  };

  const dom = createKnowledgeGraphView(host, { graph: emptyFixture });

  const nodeElements = dom.nodeContainer.querySelectorAll(".knowledge-graph-node");
  assert.equal(nodeElements.length, 0, "no nodes rendered");

  const edgeElements = dom.edgeContainer.querySelectorAll(".knowledge-graph-edge");
  assert.equal(edgeElements.length, 0, "no edges rendered");
});

test("T2.2h: graph result with truncated flag false does not show truncation message", () => {
  const host = mountHost();
  const fixture = createGraphFixture(30);
  assert.equal(fixture.truncated, false, "fixture is not truncated");

  createKnowledgeGraphView(host, { graph: fixture });

  const truncationMessage = host.querySelector(".knowledge-graph-truncation-message");
  assert.equal(truncationMessage, null, "no truncation message when truncated=false");
});

test("T2.2i: renders node labels correctly", () => {
  const host = mountHost();
  const fixture = createGraphFixture(5);

  const dom = createKnowledgeGraphView(host, { graph: fixture });

  const labelElements = dom.nodeContainer.querySelectorAll(".knowledge-graph-node-label");
  assert.equal(labelElements.length, 5, "renders label for each node");

  // Check first node label
  assert.ok(labelElements[0]?.textContent?.includes("Entity 0"));
});

test("T2.2j: boundary test: exactly 50 nodes shows no truncation message", () => {
  const host = mountHost();
  const fixture = createGraphFixture(50);

  createKnowledgeGraphView(host, { graph: fixture });

  const truncationMessage = host.querySelector(".knowledge-graph-truncation-message");
  assert.equal(truncationMessage, null, "no truncation message at boundary (50 nodes)");

  const nodeElements = host.querySelectorAll(".knowledge-graph-node");
  assert.equal(nodeElements.length, 50, "renders exactly 50 nodes");
});
