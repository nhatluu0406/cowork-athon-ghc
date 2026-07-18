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
    // Fallback label/description for the shared adapter shape. In the running app the Dispatch
    // surface always renders the real local dispatch board + phone quick-access (a client is
    // always supplied — see ui-shell/integration-view.ts), so this "awaiting" copy is NOT shown
    // for dispatch; it only appears in the no-client rendering path (tests).
    statusLabel: "Chờ tích hợp D1",
    description:
      "Điều phối fan-out agent và theo dõi tác vụ con. Backend D1 chưa được tích hợp; mount boundary sẵn sàng cho team UI.",
  },
  gateway: {
    surfaceId: "gateway",
    mountId: "d4-gateway-root",
    component: "GatewayIntegrationSlot",
    // PR #16 integrated the Gateway backend, so the running app renders the real Gateway surface
    // (mountGatewayIntegrationSlot) — this adapter's fallback copy is never shown for gateway. Keep
    // it honest anyway: no "chưa tích hợp".
    statusLabel: "Đã tích hợp",
    description:
      "Gateway đa provider, failover và key pool. Quản lý API key và kích hoạt tài khoản theo provider.",
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
    // Code is a fully implemented surface (Project Explorer, multi-tab editor, Web Preview); the
    // running app renders the real ClaudeCodeSurface, so this adapter fallback is never user-visible.
    // Kept honest: no longer "planned".
    statusLabel: "Đã tích hợp",
    description:
      "Surface project-centric: Project Explorer, editor nhiều tab (sửa + lưu), Web Preview và panel Agent dùng chung phiên với Cowork.",
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
