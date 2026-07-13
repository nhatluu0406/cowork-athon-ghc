import { el, icon } from "./dom-utils.js";
export function createIntegrationView() {
    const root = el("section", "view view--integration integration-surface");
    root.dataset["view"] = "integration";
    root.hidden = true;
    return root;
}
export function renderIntegrationSurface(container, surface) {
    container.replaceChildren();
    const empty = el("div", "integration-empty");
    const iconWrap = el("div", "integration-empty__icon");
    iconWrap.append(icon(surface.icon, surface.label));
    const dependency = surface.availability === "planned" ? "planned" : (surface.dependency ?? "integration");
    empty.append(iconWrap, el("h1", "integration-empty__title", surface.label), el("p", "integration-empty__copy", surface.description), el("span", "integration-empty__badge", `Chờ tích hợp ${dependency}`));
    container.append(empty);
}
//# sourceMappingURL=integration-view.js.map