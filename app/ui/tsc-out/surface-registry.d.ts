import type { ProductIconName } from "./product-icons.js";
export type ProductSurfaceId = "cowork" | "dispatch" | "gateway" | "knowledge" | "knowledge-graph" | "microsoft" | "code";
export type SurfaceAvailability = "available" | "awaiting_integration" | "planned" | "not_configured" | "backend_unavailable" | "coming_later" | "hidden";
export interface ProductSurfaceDefinition {
    readonly id: ProductSurfaceId;
    readonly label: string;
    readonly icon: ProductIconName;
    readonly featureFlag: string;
    readonly requiredCapability: string;
    readonly availability: SurfaceAvailability;
    readonly dependency?: "D1" | "D2" | "D3" | "D4";
    readonly description: string;
    readonly component: string;
}
export interface SurfaceRegistryEnv {
    readonly revealFutureSurfaces?: boolean;
}
export declare function createSurfaceRegistry(_env?: SurfaceRegistryEnv): readonly ProductSurfaceDefinition[];
export declare function visibleProductSurfaces(surfaces: readonly ProductSurfaceDefinition[]): readonly ProductSurfaceDefinition[];
export declare const PRODUCT_SURFACES: readonly ProductSurfaceDefinition[];
//# sourceMappingURL=surface-registry.d.ts.map