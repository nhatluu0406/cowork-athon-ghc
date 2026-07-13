/**
 * Knowledge graph view — minimal custom SVG renderer (T2.5).
 *
 * Displays M365 Knowledge Graph nodes and edges as a network visualization.
 * - Truncates at KNOWLEDGE_PANEL_MAX_NODES = 50 (R4)
 * - Shows explicit "N more not shown" message
 * - Renders within 300ms budget on post-truncation fixture (R4 performance)
 * - No external graph layout library (R7 — no reactflow, pure DOM/SVG)
 */
import { type KnowledgeGraphResult } from "@cowork-ghc/service/knowledge/types";
export interface KnowledgeGraphViewDom {
    readonly root: HTMLElement;
    readonly svg: SVGElement;
    readonly nodeContainer: SVGGElement;
    readonly edgeContainer: SVGGElement;
}
export declare function createKnowledgeGraphView(host: HTMLElement, config: {
    graph: KnowledgeGraphResult;
}): KnowledgeGraphViewDom;
//# sourceMappingURL=knowledge-graph-view.d.ts.map