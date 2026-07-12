import type { ProductIconName } from "./product-icons.js";

export type ProductSurfaceId =
  | "cowork"
  | "dispatch"
  | "gateway"
  | "knowledge"
  | "knowledge-graph"
  | "microsoft"
  | "code";

export type SurfaceAvailability =
  | "available"
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
    component: "CoworkShellSurface",
  },
  {
    id: "dispatch",
    label: "Dispatch",
    icon: "dispatch",
    featureFlag: "d1.dispatch",
    requiredCapability: "external_dispatch_backend",
    availability: "hidden",
    component: "DispatchIntegrationSlot",
  },
  {
    id: "gateway",
    label: "Gateway",
    icon: "gateway",
    featureFlag: "d4.gateway",
    requiredCapability: "advanced_gateway_backend",
    availability: "hidden",
    component: "GatewayIntegrationSlot",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: "knowledge",
    featureFlag: "d3.knowledge",
    requiredCapability: "knowledge_index_backend",
    availability: "hidden",
    component: "KnowledgeIntegrationSlot",
  },
  {
    id: "knowledge-graph",
    label: "Graph",
    icon: "knowledge-graph",
    featureFlag: "d3.knowledge_graph",
    requiredCapability: "knowledge_graph_backend",
    availability: "hidden",
    component: "KnowledgeGraphIntegrationSlot",
  },
  {
    id: "microsoft",
    label: "Microsoft",
    icon: "microsoft",
    featureFlag: "d2.microsoft",
    requiredCapability: "microsoft_connector_backend",
    availability: "hidden",
    component: "MicrosoftIntegrationSlot",
  },
  {
    id: "code",
    label: "Code",
    icon: "code",
    featureFlag: "code.workspace",
    requiredCapability: "workspace_code_surface",
    availability: "hidden",
    component: "CodeIntegrationSlot",
  },
]);

export function createSurfaceRegistry(
  env: SurfaceRegistryEnv = {},
): readonly ProductSurfaceDefinition[] {
  if (env.revealFutureSurfaces !== true) return BASE_SURFACES;
  return BASE_SURFACES.map((surface) =>
    surface.id === "cowork" ? surface : { ...surface, availability: "coming_later" },
  );
}

export function visibleProductSurfaces(
  surfaces: readonly ProductSurfaceDefinition[],
): readonly ProductSurfaceDefinition[] {
  return surfaces.filter((surface) => surface.availability !== "hidden");
}

export const PRODUCT_SURFACES = createSurfaceRegistry();
