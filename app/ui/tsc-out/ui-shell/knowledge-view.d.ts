import type { ProductSurfaceDefinition } from "../surface-registry.js";
export type KnowledgeTab = "base" | "graph";
export interface KnowledgeViewDom {
    readonly root: HTMLElement;
    readonly graphTab: HTMLButtonElement;
    readonly body: HTMLElement;
}
export declare function createKnowledgeView(): KnowledgeViewDom;
export declare function setKnowledgeGraphCapability(dom: KnowledgeViewDom, enabled: boolean): void;
export declare function renderKnowledgeTab(dom: KnowledgeViewDom, tab: KnowledgeTab): void;
export declare function renderIntegrationKnowledgeFallback(container: HTMLElement, surface: ProductSurfaceDefinition): void;
//# sourceMappingURL=knowledge-view.d.ts.map