import { PRODUCT_SURFACES, visibleProductSurfaces } from "../surface-registry.js";
import { el, icon } from "./dom-utils.js";
export function createProductRail() {
    const root = el("nav", "product-rail rail");
    root.setAttribute("aria-label", "Product surfaces");
    const nav = el("div", "product-rail__nav rail__items");
    const surfaceButtons = new Map();
    for (const surface of visibleProductSurfaces(PRODUCT_SURFACES)) {
        const item = el("button", `product-rail__item product-rail__item--${surface.availability}`);
        item.type = "button";
        item.dataset["surfaceId"] = surface.id;
        item.title = railTooltip(surface);
        item.dataset["tooltip"] = item.title;
        item.setAttribute("aria-label", item.title);
        item.setAttribute("aria-current", surface.id === "cowork" ? "page" : "false");
        item.append(icon(surface.icon, surface.label));
        nav.append(item);
        surfaceButtons.set(surface.id, item);
    }
    const sidebarToggle = el("button", "product-rail__sidebar-toggle");
    sidebarToggle.type = "button";
    sidebarToggle.title = "Mở sidebar";
    sidebarToggle.dataset["tooltip"] = "Mở sidebar";
    sidebarToggle.setAttribute("aria-label", "Mở sidebar");
    sidebarToggle.setAttribute("aria-expanded", "false");
    sidebarToggle.append(icon("conversation", "Mở sidebar"));
    root.append(nav, sidebarToggle);
    return { root, sidebarToggle, surfaceButtons };
}
function railTooltip(surface) {
    if (surface.id === "code")
        return "Code — Đã lên kế hoạch";
    if (surface.dependency !== undefined)
        return `${surface.label} — Chờ tích hợp ${surface.dependency}`;
    return surface.label;
}
//# sourceMappingURL=product-rail.js.map