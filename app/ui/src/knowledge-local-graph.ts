/**
 * Local Knowledge Graph renderer (Phase 2).
 *
 * A self-contained SVG view over the deterministic local node/edge data (workspace → folder → file
 * + Markdown links). Distinct from the dormant M365 `knowledge-graph-view.ts`. It never fabricates
 * data — the caller passes the real graph.
 *
 * Sizing is layout-independent: the force simulation runs in a fixed virtual coordinate space and
 * the SVG fills its container via `width/height:100%` + a `viewBox`, so it renders correctly even
 * where `getBoundingClientRect()` reports 0 (tests, hidden tab). Zoom / pan / fit / reset all just
 * move the `viewBox`; a `refit()` re-fits to the graph bounds (called on data load, tab entry, and
 * window resize while the view is untouched). Nodes are selectable (drives the side detail panel).
 */

export interface LocalGraphNodeInput {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly relativePath: string | null;
}
export interface LocalGraphEdgeInput {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}
export interface LocalKnowledgeGraphConfig {
  readonly nodes: readonly LocalGraphNodeInput[];
  readonly edges: readonly LocalGraphEdgeInput[];
  readonly truncated: boolean;
  readonly selectedId?: string | null;
  readonly onSelect?: (node: LocalGraphNodeInput | null) => void;
}
export interface LocalKnowledgeGraphHandle {
  readonly root: HTMLElement;
  /** Re-fit the viewBox to the whole graph. */
  refit(): void;
  /** Highlight the node with this id (null clears), without a full re-render. */
  setSelected(id: string | null): void;
  dispose(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Virtual coordinate space the layout runs in (independent of on-screen pixels). */
const SPACE_W = 1000;
const SPACE_H = 640;
const LAYOUT_ITERATIONS = 70;

interface LayoutNode {
  readonly id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function radiusFor(kind: string): number {
  if (kind === "workspace") return 26;
  if (kind === "folder") return 19;
  return 14;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  }
  return node;
}

/** Deterministic circular seed → fixed-iteration force relaxation. No RNG (kept reproducible). */
function computeLayout(
  nodes: readonly LocalGraphNodeInput[],
  edges: readonly LocalGraphEdgeInput[],
): Map<string, LayoutNode> {
  const map = new Map<string, LayoutNode>();
  const cx = SPACE_W / 2;
  const cy = SPACE_H / 2;
  const seedRadius = Math.min(SPACE_W, SPACE_H) / 2.6;
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    map.set(n.id, {
      id: n.id,
      x: cx + seedRadius * Math.cos(angle),
      y: cy + seedRadius * Math.sin(angle),
      vx: 0,
      vy: 0,
    });
  });

  const layoutNodes = [...map.values()];
  const layoutEdges = edges
    .map((e) => ({ a: map.get(e.from), b: map.get(e.to) }))
    .filter((e): e is { a: LayoutNode; b: LayoutNode } => e.a !== undefined && e.b !== undefined);

  const k = 90; // ideal edge length
  const damping = 0.85;
  for (let iter = 0; iter < LAYOUT_ITERATIONS; iter++) {
    for (const n of layoutNodes) {
      n.vx = 0;
      n.vy = 0;
    }
    // repulsion
    for (let i = 0; i < layoutNodes.length; i++) {
      for (let j = i + 1; j < layoutNodes.length; j++) {
        const a = layoutNodes[i]!;
        const b = layoutNodes[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          dx = (i - j) * 0.5 + 0.1;
          dy = (j - i) * 0.5 + 0.1;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    // attraction along edges
    for (const { a, b } of layoutEdges) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // integrate + gentle pull to centre so disconnected nodes don't drift off
    const cooling = 0.02 * damping;
    for (const n of layoutNodes) {
      n.x += Math.max(-40, Math.min(40, n.vx * cooling));
      n.y += Math.max(-40, Math.min(40, n.vy * cooling));
      n.x += (cx - n.x) * 0.003;
      n.y += (cy - n.y) * 0.003;
    }
  }
  return map;
}

export function createLocalKnowledgeGraph(
  host: HTMLElement,
  config: LocalKnowledgeGraphConfig,
): LocalKnowledgeGraphHandle {
  const nodes = config.nodes;
  const layout = computeLayout(nodes, config.edges);

  const root = document.createElement("div");
  root.className = "klg";

  const svg = svgEl("svg", {
    class: "klg__svg",
    width: "100%",
    height: "100%",
    preserveAspectRatio: "xMidYMid meet",
  });
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Đồ thị tri thức");

  const edgeG = svgEl("g", { class: "klg__edges" });
  const nodeG = svgEl("g", { class: "klg__nodes" });
  svg.append(edgeG, nodeG);

  // ---- viewBox state (fit / zoom / pan) ------------------------------------------------------
  let vx = 0;
  let vy = 0;
  let vw = SPACE_W;
  let vh = SPACE_H;
  let userAdjusted = false;

  const applyViewBox = (): void => {
    svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  };

  const fit = (): void => {
    if (nodes.length === 0) {
      vx = 0;
      vy = 0;
      vw = SPACE_W;
      vh = SPACE_H;
      applyViewBox();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const p = layout.get(n.id);
      if (p === undefined) continue;
      const r = radiusFor(n.kind) + 26; // include label/margin
      minX = Math.min(minX, p.x - r);
      minY = Math.min(minY, p.y - r);
      maxX = Math.max(maxX, p.x + r);
      maxY = Math.max(maxY, p.y + r);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = SPACE_W;
      maxY = SPACE_H;
    }
    const padX = (maxX - minX) * 0.06 + 20;
    const padY = (maxY - minY) * 0.06 + 20;
    vx = minX - padX;
    vy = minY - padY;
    vw = Math.max(120, maxX - minX + padX * 2);
    vh = Math.max(80, maxY - minY + padY * 2);
    applyViewBox();
  };

  const zoomBy = (factor: number): void => {
    userAdjusted = true;
    const cx = vx + vw / 2;
    const cy = vy + vh / 2;
    vw = Math.max(80, Math.min(SPACE_W * 4, vw * factor));
    vh = Math.max(50, Math.min(SPACE_H * 4, vh * factor));
    vx = cx - vw / 2;
    vy = cy - vh / 2;
    applyViewBox();
  };

  // ---- render edges + nodes ------------------------------------------------------------------
  const nodeById = new Map<string, LocalGraphNodeInput>(nodes.map((n) => [n.id, n]));
  for (const e of config.edges) {
    const a = layout.get(e.from);
    const b = layout.get(e.to);
    if (a === undefined || b === undefined) continue;
    edgeG.append(
      svgEl("line", { class: `klg__edge klg__edge--${e.type}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y }),
    );
  }

  const groups = new Map<string, SVGGElement>();
  let selectedId = config.selectedId ?? null;

  const select = (id: string | null): void => {
    selectedId = id;
    for (const [gid, g] of groups) {
      g.classList.toggle("klg__node--selected", gid === id);
    }
  };

  for (const n of nodes) {
    const p = layout.get(n.id);
    if (p === undefined) continue;
    const g = svgEl("g", {
      class: `klg__node klg__node--${n.kind}`,
      transform: `translate(${p.x}, ${p.y})`,
      "data-node-id": n.id,
    });
    const r = radiusFor(n.kind);
    g.append(svgEl("circle", { class: "klg__dot", r }));
    const label = svgEl("text", { class: "klg__label", "text-anchor": "middle", y: r + 14 });
    label.textContent = n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label;
    g.append(label);
    g.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const next = selectedId === n.id ? null : n.id;
      select(next);
      config.onSelect?.(next === null ? null : (nodeById.get(n.id) ?? null));
    });
    groups.set(n.id, g);
    nodeG.append(g);
  }

  // ---- pan (pointer drag on the background) --------------------------------------------------
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (ev: PointerEvent): void => {
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    userAdjusted = true;
  };
  const onPointerMove = (ev: PointerEvent): void => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width > 0 ? vw / rect.width : 1;
    const scaleY = rect.height > 0 ? vh / rect.height : 1;
    vx -= (ev.clientX - lastX) * scaleX;
    vy -= (ev.clientY - lastY) * scaleY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    applyViewBox();
  };
  const onPointerUp = (): void => {
    dragging = false;
  };
  svg.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("wheel", (ev: WheelEvent) => {
    ev.preventDefault();
    zoomBy(ev.deltaY > 0 ? 1.12 : 0.89);
  });

  const onResize = (): void => {
    if (!userAdjusted) fit();
  };
  window.addEventListener("resize", onResize);

  // ---- controls + legend overlays ------------------------------------------------------------
  const controls = document.createElement("div");
  controls.className = "klg__controls";
  const ctrlBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "klg__ctrl";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", onClick);
    return b;
  };
  controls.append(
    ctrlBtn("+", "Phóng to", () => zoomBy(0.8)),
    ctrlBtn("−", "Thu nhỏ", () => zoomBy(1.25)),
    ctrlBtn("⤢", "Vừa khung", () => {
      userAdjusted = false;
      fit();
    }),
  );

  const legend = document.createElement("div");
  legend.className = "klg__legend";
  const kinds: { kind: string; label: string }[] = [
    { kind: "workspace", label: "Workspace" },
    { kind: "folder", label: "Thư mục" },
    { kind: "document", label: "Tài liệu" },
  ];
  for (const { kind, label } of kinds) {
    const item = document.createElement("span");
    item.className = "klg__legend-item";
    const dot = document.createElement("span");
    dot.className = `klg__legend-dot klg__legend-dot--${kind}`;
    item.append(dot, document.createTextNode(label));
    legend.append(item);
  }

  root.append(svg, controls, legend);

  if (config.truncated) {
    const trunc = document.createElement("p");
    trunc.className = "klg__trunc";
    trunc.textContent = "Đồ thị lớn — chỉ hiển thị một phần các nút.";
    root.append(trunc);
  }

  host.append(root);
  fit();
  if (selectedId !== null) select(selectedId);

  return {
    root,
    refit(): void {
      userAdjusted = false;
      fit();
    },
    setSelected(id: string | null): void {
      select(id);
    },
    dispose(): void {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", onResize);
      root.remove();
    },
  };
}
