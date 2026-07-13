import { el, icon } from "./dom-utils.js";
export function createKnowledgeView() {
    const root = el("section", "view view--knowledge knowledge-view");
    root.dataset["view"] = "knowledge";
    root.hidden = true;
    const header = el("header", "knowledge-header");
    header.append(el("h1", "knowledge-header__title", "Knowledge"));
    const tabs = el("div", "knowledge-tabs");
    tabs.setAttribute("role", "tablist");
    const baseTab = el("button", "knowledge-tabs__btn knowledge-tabs__btn--active", "Kho tri thức");
    baseTab.type = "button";
    baseTab.dataset["knowledgeTab"] = "base";
    baseTab.setAttribute("role", "tab");
    baseTab.setAttribute("aria-selected", "true");
    const graphTab = el("button", "knowledge-tabs__btn", "Đồ thị");
    graphTab.type = "button";
    graphTab.dataset["knowledgeTab"] = "graph";
    graphTab.setAttribute("role", "tab");
    graphTab.setAttribute("aria-selected", "false");
    graphTab.hidden = true;
    tabs.append(baseTab, graphTab);
    header.append(tabs);
    const body = el("div", "knowledge-body");
    root.append(header, body);
    return { root, graphTab, body };
}
export function setKnowledgeGraphCapability(dom, enabled) {
    dom.graphTab.hidden = !enabled;
}
export function renderKnowledgeTab(dom, tab) {
    for (const btn of dom.root.querySelectorAll("[data-knowledge-tab]")) {
        const active = btn.dataset["knowledgeTab"] === tab;
        btn.classList.toggle("knowledge-tabs__btn--active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    }
    dom.body.replaceChildren();
    const empty = el("div", "knowledge-empty");
    if (tab === "graph") {
        empty.append(el("h2", "knowledge-empty__title", "Đồ thị tri thức"), el("p", "knowledge-empty__copy", "Graph explorer chỉ hiển thị dữ liệu thật sau tích hợp D3."), el("span", "integration-empty__badge", "Chờ tích hợp D3"));
    }
    else {
        empty.append(el("h2", "knowledge-empty__title", "Kho tri thức"), el("p", "knowledge-empty__copy", "RAG và retrieval có provenance sẽ bật khi backend D3 sẵn sàng."), el("span", "integration-empty__badge", "Chờ tích hợp D3"));
    }
    dom.body.append(empty);
}
export function renderIntegrationKnowledgeFallback(container, surface) {
    container.replaceChildren();
    const card = el("section", "integration-empty");
    const iconWrap = el("div", "integration-empty__icon");
    iconWrap.append(icon(surface.icon, surface.label));
    card.append(iconWrap, el("p", "integration-empty__eyebrow", surface.dependency ? `Chờ tích hợp ${surface.dependency}` : "Chưa khả dụng"), el("h1", "integration-empty__title", surface.label), el("p", "integration-empty__copy", surface.description));
    container.append(card);
}
//# sourceMappingURL=knowledge-view.js.map