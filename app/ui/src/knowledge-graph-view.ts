/**
 * Knowledge graph view — minimal custom SVG renderer (T2.5).
 *
 * Displays M365 Knowledge Graph nodes and edges as a network visualization.
 * - Truncates at KNOWLEDGE_PANEL_MAX_NODES = 50 (R4)
 * - Shows explicit "N more not shown" message
 * - Renders within 300ms budget on post-truncation fixture (R4 performance)
 * - No external graph layout library (R7 — no reactflow, pure DOM/SVG)
 */

import {
  KNOWLEDGE_PANEL_MAX_NODES,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  type KnowledgeGraphResult,
} from "@cowork-ghc/service/knowledge/types";

export interface KnowledgeGraphViewDom {
  readonly root: HTMLElement;
  readonly svg: SVGElement;
  readonly nodeContainer: SVGGElement;
  readonly edgeContainer: SVGGElement;
}

/**
 * Simple force-directed layout in 2D using very basic physics simulation.
 * Runs for a fixed number of iterations to keep it predictable and fast.
 */
interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  label: string;
}

interface LayoutEdge {
  source: LayoutNode;
  target: LayoutNode;
}

function initializeLayout(
  nodes: readonly KnowledgeGraphNode[],
  width: number,
  height: number,
): Map<string, LayoutNode> {
  const map = new Map<string, LayoutNode>();
  const centerX = width / 2;
  const centerY = height / 2;

  nodes.forEach((node, index) => {
    // Distribute initial positions in a circle
    const angle = (index / nodes.length) * Math.PI * 2;
    const radius = Math.min(width, height) / 3;

    map.set(node.id, {
      id: node.id,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      label: node.label,
    });
  });

  return map;
}

function simulateLayout(
  layoutNodes: LayoutNode[],
  edges: LayoutEdge[],
  iterations: number = 30,
): void {
  const k = 50; // Repulsion constant
  const c = 0.1; // Damping factor

  for (let iter = 0; iter < iterations; iter++) {
    // Reset forces
    layoutNodes.forEach((node) => {
      node.vx = 0;
      node.vy = 0;
    });

    // Repulsive forces (node-to-node)
    for (let i = 0; i < layoutNodes.length; i++) {
      for (let j = i + 1; j < layoutNodes.length; j++) {
        const dx = layoutNodes[j]!.x - layoutNodes[i]!.x;
        const dy = layoutNodes[j]!.y - layoutNodes[i]!.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const force = (k * k) / (dist * dist);
        layoutNodes[i]!.vx -= (force * dx) / dist;
        layoutNodes[i]!.vy -= (force * dy) / dist;
        layoutNodes[j]!.vx += (force * dx) / dist;
        layoutNodes[j]!.vy += (force * dy) / dist;
      }
    }

    // Attractive forces (edges)
    edges.forEach(({ source, target }) => {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist * dist) / k;

      source.vx += (force * dx) / dist;
      source.vy += (force * dy) / dist;
      target.vx -= (force * dx) / dist;
      target.vy -= (force * dy) / dist;
    });

    // Update positions with damping
    layoutNodes.forEach((node) => {
      node.x += node.vx * c;
      node.y += node.vy * c;
    });
  }
}

function svg(tag: string, attrs?: Record<string, string | number>): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
      el.setAttribute(key, String(value));
    });
  }
  return el;
}

export function createKnowledgeGraphView(
  host: HTMLElement,
  config: { graph: KnowledgeGraphResult },
): KnowledgeGraphViewDom {
  const root = document.createElement("div");
  root.className = "knowledge-graph-view";

  const width = 600;
  const height = 400;

  // Truncate if necessary
  const nodesToShow = config.graph.nodes.slice(0, KNOWLEDGE_PANEL_MAX_NODES);
  const nodeIdSet = new Set(nodesToShow.map((n) => n.id));
  const edgesToShow = config.graph.edges.filter((e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to));

  const svgElement = svg("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    class: "knowledge-graph-canvas",
  }) as SVGSVGElement;

  const background = svg("rect", {
    width,
    height,
    fill: "#f5f5f5",
  });
  svgElement.append(background);

  const edgeContainer = svg("g", { class: "knowledge-graph-edges" }) as SVGGElement;
  const nodeContainer = svg("g", { class: "knowledge-graph-nodes" }) as SVGGElement;

  svgElement.append(edgeContainer);
  svgElement.append(nodeContainer);

  // Compute layout
  if (nodesToShow.length > 0) {
    const layoutMap = initializeLayout(nodesToShow, width, height);
    const layoutNodes = Array.from(layoutMap.values());
    const layoutEdges: LayoutEdge[] = edgesToShow
      .map((e) => ({
        source: layoutMap.get(e.from)!,
        target: layoutMap.get(e.to)!,
      }))
      .filter((le) => le.source && le.target);

    simulateLayout(layoutNodes, layoutEdges);

    // Render edges
    edgesToShow.forEach((edge) => {
      const sourceNode = layoutMap.get(edge.from);
      const targetNode = layoutMap.get(edge.to);
      if (!sourceNode || !targetNode) return;

      const line = svg("line", {
        x1: sourceNode.x,
        y1: sourceNode.y,
        x2: targetNode.x,
        y2: targetNode.y,
        class: "knowledge-graph-edge",
        stroke: "#ccc",
        "stroke-width": 1,
      });
      edgeContainer.append(line);
    });

    // Render nodes
    nodesToShow.forEach((node) => {
      const layoutNode = layoutMap.get(node.id);
      if (!layoutNode) return;

      const group = svg("g", {
        class: "knowledge-graph-node-group",
        transform: `translate(${layoutNode.x}, ${layoutNode.y})`,
      }) as SVGGElement;

      const circle = svg("circle", {
        r: 20,
        fill: "#4a90e2",
        class: "knowledge-graph-node",
        "data-id": node.id,
      });

      const label = svg("text", {
        "text-anchor": "middle",
        dy: "0.3em",
        class: "knowledge-graph-node-label",
        fill: "white",
        "font-size": "11",
      });
      label.textContent = node.label.substring(0, 15);

      group.append(circle);
      group.append(label);
      nodeContainer.append(group);
    });
  }

  root.append(svgElement);

  // Show truncation message if needed
  if (config.graph.truncated && config.graph.nodes.length > KNOWLEDGE_PANEL_MAX_NODES) {
    const hidden = config.graph.nodes.length - KNOWLEDGE_PANEL_MAX_NODES;
    const message = document.createElement("div");
    message.className = "knowledge-graph-truncation-message";
    message.textContent = `Không hiển thị ${hidden} nút khác`;
    root.append(message);
  }

  host.append(root);

  return {
    root,
    svg: svgElement,
    nodeContainer,
    edgeContainer,
  };
}
