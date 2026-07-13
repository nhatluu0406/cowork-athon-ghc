import { type ProductSurfaceId } from "../surface-registry.js";
export interface ProductRailDom {
    readonly root: HTMLElement;
    readonly sidebarToggle: HTMLButtonElement;
    readonly surfaceButtons: Map<ProductSurfaceId, HTMLButtonElement>;
}
export declare function createProductRail(): ProductRailDom;
//# sourceMappingURL=product-rail.d.ts.map