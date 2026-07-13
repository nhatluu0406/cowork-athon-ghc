import type { ProductIconName } from "./product-icons.js";

export type ProductSurfaceId =
  | "cowork"
  | "dispatch"
  | "gateway"
  | "knowledge"
  | "microsoft"
  | "code";

export type SurfaceAvailability =
  | "available"
  | "awaiting_integration"
  | "planned"
  | "not_configured"
  | "backend_unavailable"
  | "coming_later"
  | "hidden";

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

const BASE_SURFACES: readonly ProductSurfaceDefinition[] = Object.freeze([
  {
    id: "cowork",
    label: "Cowork",
    icon: "cowork",
    featureFlag: "core.cowork",
    requiredCapability: "conversation_runtime",
    availability: "available",
    description: "Conversation workspace với runtime OpenCode hiện tại.",
    component: "CoworkShellSurface",
  },
  {
    id: "dispatch",
    label: "Dispatch",
    icon: "dispatch",
    featureFlag: "d1.dispatch",
    requiredCapability: "external_dispatch_backend",
    availability: "awaiting_integration",
    dependency: "D1",
    description: "Surface này đã sẵn sàng về giao diện và contract. Backend Dispatch chưa được merge vào Cowork GHC.",
    component: "DispatchIntegrationSlot",
  },
  {
    id: "gateway",
    label: "Gateway",
    icon: "gateway",
    featureFlag: "d4.gateway",
    requiredCapability: "advanced_gateway_backend",
    availability: "awaiting_integration",
    dependency: "D4",
    description: "Surface này đã sẵn sàng về giao diện và contract. Backend Gateway chưa được merge vào Cowork GHC.",
    component: "GatewayIntegrationSlot",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: "knowledge",
    featureFlag: "d3.knowledge",
    requiredCapability: "knowledge_index_backend",
    availability: "awaiting_integration",
    dependency: "D3",
    description: "Surface này đã sẵn sàng về giao diện và contract. Backend Knowledge chưa được merge vào Cowork GHC.",
    component: "KnowledgeIntegrationSlot",
  },
  {
    id: "microsoft",
    label: "Microsoft 365",
    icon: "microsoft",
    featureFlag: "d2.microsoft",
    requiredCapability: "microsoft_connector_backend",
    availability: "awaiting_integration",
    dependency: "D2",
    description: "Surface này đã sẵn sàng về giao diện và contract. Backend Microsoft 365 chưa được merge vào Cowork GHC.",
    component: "MicrosoftIntegrationSlot",
  },
  {
    id: "code",
    label: "Code",
    icon: "code",
    featureFlag: "code.workspace",
    requiredCapability: "workspace_code_surface",
    availability: "planned",
    description: "Surface Code được lên kế hoạch sau navigator/preview read-only; chưa có editor hoặc terminal.",
    component: "CodeIntegrationSlot",
  },
]);

export function createSurfaceRegistry(
  _env: SurfaceRegistryEnv = {},
): readonly ProductSurfaceDefinition[] {
  return BASE_SURFACES;
}

export function visibleProductSurfaces(
  surfaces: readonly ProductSurfaceDefinition[],
): readonly ProductSurfaceDefinition[] {
  return surfaces.filter((surface) => surface.availability !== "hidden");
}

export const PRODUCT_SURFACES = createSurfaceRegistry();

/** V3 shows the graph tab as an internal Knowledge placeholder; D3 data remains unintegrated. */
export function hasKnowledgeGraphCapability(_env: SurfaceRegistryEnv = {}): boolean {
  return true;
}
