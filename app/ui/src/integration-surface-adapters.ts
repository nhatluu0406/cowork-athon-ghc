/**
 * Mount boundaries for external product surfaces (D1–D4, Code).
 *
 * Team integrations replace the placeholder inside the stable mount node without
 * changing the product rail or shell navigation.
 */

import type { ProductSurfaceId } from "./surface-registry.js";

export type ExternalSurfaceId = "dispatch" | "gateway" | "knowledge" | "microsoft" | "code";

export interface IntegrationSurfaceAdapter {
  readonly surfaceId: ExternalSurfaceId;
  readonly mountId: string;
  readonly component: string;
  readonly statusLabel: string;
  readonly description: string;
}

const ADAPTERS: Readonly<Record<ExternalSurfaceId, IntegrationSurfaceAdapter>> = Object.freeze({
  dispatch: {
    surfaceId: "dispatch",
    mountId: "d1-dispatch-root",
    component: "DispatchIntegrationSlot",
    statusLabel: "Chờ tích hợp D1",
    description:
      "Điều phối fan-out agent và theo dõi tác vụ con. Backend D1 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
  },
  gateway: {
    surfaceId: "gateway",
    mountId: "d4-gateway-root",
    component: "GatewayIntegrationSlot",
    statusLabel: "Chờ tích hợp D4",
    description:
      "Gateway đa provider, failover và key pool. Backend D4 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
  },
  knowledge: {
    surfaceId: "knowledge",
    mountId: "d3-knowledge-root",
    component: "KnowledgeIntegrationSlot",
    statusLabel: "Chờ tích hợp D3",
    description:
      "RAG, chỉ mục và truy vấn có provenance. Backend D3 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
  },
  microsoft: {
    surfaceId: "microsoft",
    mountId: "d2-microsoft-root",
    component: "MicrosoftIntegrationSlot",
    statusLabel: "Chờ tích hợp D2",
    description:
      "Kết nối Microsoft 365 (Teams, SharePoint, OneDrive, Graph). Backend D2 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
  },
  code: {
    surfaceId: "code",
    mountId: "code-surface-root",
    component: "CodeIntegrationSlot",
    statusLabel: "Đã lên kế hoạch",
    description:
      "Surface làm việc mã nguồn nâng cao. Đã lên kế hoạch sau navigator/preview; chưa có backend hay dữ liệu giả.",
  },
});

export function getIntegrationSurfaceAdapter(
  surfaceId: ProductSurfaceId,
): IntegrationSurfaceAdapter | null {
  if (surfaceId in ADAPTERS) return ADAPTERS[surfaceId as ExternalSurfaceId];
  return null;
}

export function integrationMountIdFor(surfaceId: ProductSurfaceId): string | null {
  return getIntegrationSurfaceAdapter(surfaceId)?.mountId ?? null;
}
