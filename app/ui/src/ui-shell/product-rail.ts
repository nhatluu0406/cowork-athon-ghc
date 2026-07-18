import { PRODUCT_SURFACES, visibleProductSurfaces, type ProductSurfaceDefinition, type ProductSurfaceId } from "../surface-registry.js";
import { el, icon } from "./dom-utils.js";

export interface ProductRailDom {
  readonly root: HTMLElement;
  readonly sidebarToggle: HTMLButtonElement;
  readonly surfaceButtons: Map<ProductSurfaceId, HTMLButtonElement>;
}

export function createProductRail(): ProductRailDom {
  const root = el("nav", "product-rail rail");
  root.setAttribute("aria-label", "Product surfaces");

  const nav = el("div", "product-rail__nav rail__items");
  const surfaceButtons = new Map<ProductSurfaceId, HTMLButtonElement>();
  for (const surface of visibleProductSurfaces(PRODUCT_SURFACES)) {
    const item = el("button", `product-rail__item product-rail__item--${surface.availability}`) as HTMLButtonElement;
    item.type = "button";
    item.dataset["surfaceId"] = surface.id;
    const tooltip = railTooltip(surface);
    item.dataset["tooltip"] = tooltip;
    item.setAttribute("aria-label", tooltip);
    item.setAttribute("aria-current", surface.id === "cowork" ? "page" : "false");
    item.append(icon(surface.icon, surface.label));
    nav.append(item);
    surfaceButtons.set(surface.id, item);
  }

  const sidebarToggle = el("button", "product-rail__sidebar-toggle") as HTMLButtonElement;
  sidebarToggle.type = "button";
  sidebarToggle.dataset["tooltip"] = "Mở sidebar";
  sidebarToggle.setAttribute("aria-label", "Mở sidebar");
  sidebarToggle.setAttribute("aria-expanded", "false");
  sidebarToggle.append(icon("conversation", "Mở sidebar"));

  root.append(nav, sidebarToggle);
  return { root, sidebarToggle, surfaceButtons };
}

function railTooltip(surface: ProductSurfaceDefinition): string {
  if (surface.dependency !== undefined) return `${surface.label} — Chờ tích hợp ${surface.dependency}`;
  return surface.label;
}
