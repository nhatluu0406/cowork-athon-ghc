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
  /** Demo-only: hide awaiting/planned surfaces and show Cowork alone. */
  readonly onlyAvailable?: boolean;
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
    description:
      "Điều phối fan-out agent và theo dõi tác vụ con. Backend D1 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
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
    description:
      "Gateway đa provider, failover và key pool. Backend D4 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
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
    description:
      "RAG, chỉ mục và truy vấn có provenance. Backend D3 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
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
    description:
      "Kết nối Microsoft 365 (Teams, SharePoint, OneDrive, Graph). Backend D2 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
    component: "MicrosoftIntegrationSlot",
  },
  {
    id: "code",
    label: "Code",
    icon: "code",
    featureFlag: "code.workspace",
    requiredCapability: "workspace_code_surface",
    availability: "planned",
    description:
      "Surface làm việc mã nguồn nâng cao. Đã lên kế hoạch sau navigator/preview; chưa có backend hay dữ liệu giả.",
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
  env: SurfaceRegistryEnv = {},
): readonly ProductSurfaceDefinition[] {
  const base = surfaces.filter((surface) => surface.availability !== "hidden");
  if (env.onlyAvailable === true) {
    return base.filter((surface) => surface.availability === "available");
  }
  return base;
}

export const PRODUCT_SURFACES = createSurfaceRegistry();

/** V3 shows the graph tab as an internal Knowledge placeholder; D3 data remains unintegrated. */
export function hasKnowledgeGraphCapability(_env: SurfaceRegistryEnv = {}): boolean {
  return true;
}
