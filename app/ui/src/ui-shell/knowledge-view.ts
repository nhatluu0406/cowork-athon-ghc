import { getIntegrationSurfaceAdapter } from "../integration-surface-adapters.js";
import type { ProductSurfaceDefinition } from "../surface-registry.js";
import { el, icon } from "./dom-utils.js";

export type KnowledgeTab = "base" | "graph";

export interface KnowledgeViewDom {
  readonly root: HTMLElement;
  readonly graphTab: HTMLButtonElement;
  readonly body: HTMLElement;
}

export function createKnowledgeView(): KnowledgeViewDom {
  const root = el("section", "view view--knowledge knowledge-view");
  root.dataset["view"] = "knowledge";
  root.id = getIntegrationSurfaceAdapter("knowledge")!.mountId;
  root.dataset["integrationComponent"] = "KnowledgeIntegrationSlot";
  root.dataset["integrationSurface"] = "knowledge";
  root.hidden = true;
  const header = el("header", "knowledge-header");
  header.append(el("h1", "knowledge-header__title", "Knowledge"));
  const tabs = el("div", "knowledge-tabs");
  tabs.setAttribute("role", "tablist");
  const baseTab = el("button", "knowledge-tabs__btn knowledge-tabs__btn--active", "Kho tri thức") as HTMLButtonElement;
  baseTab.type = "button";
  baseTab.dataset["knowledgeTab"] = "base";
  baseTab.setAttribute("role", "tab");
  baseTab.setAttribute("aria-selected", "true");
  const graphTab = el("button", "knowledge-tabs__btn", "Đồ thị") as HTMLButtonElement;
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

export function setKnowledgeGraphCapability(dom: KnowledgeViewDom, enabled: boolean): void {
  dom.graphTab.hidden = !enabled;
}

export function renderKnowledgeTab(dom: KnowledgeViewDom, tab: KnowledgeTab): void {
  for (const btn of dom.root.querySelectorAll<HTMLButtonElement>("[data-knowledge-tab]")) {
    const active = btn.dataset["knowledgeTab"] === tab;
    btn.classList.toggle("knowledge-tabs__btn--active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  dom.body.replaceChildren();
  const empty = el("div", "knowledge-empty");
  if (tab === "graph") {
    empty.append(
      el("h2", "knowledge-empty__title", "Đồ thị tri thức"),
      el("p", "knowledge-empty__copy", "Graph explorer chỉ hiển thị dữ liệu thật sau tích hợp D3."),
      el("span", "integration-empty__badge", "Chờ tích hợp D3"),
    );
  } else {
    empty.append(
      el("h2", "knowledge-empty__title", "Kho tri thức"),
      el("p", "knowledge-empty__copy", "RAG và retrieval có provenance sẽ bật khi backend D3 sẵn sàng."),
      el("span", "integration-empty__badge", "Chờ tích hợp D3"),
    );
  }
  dom.body.append(empty);
}

export function renderIntegrationKnowledgeFallback(
  container: HTMLElement,
  surface: ProductSurfaceDefinition,
): void {
  container.replaceChildren();
  const card = el("section", "integration-empty");
  const iconWrap = el("div", "integration-empty__icon");
  iconWrap.append(icon(surface.icon, surface.label));
  card.append(
    iconWrap,
    el("p", "integration-empty__eyebrow", surface.dependency ? `Chờ tích hợp ${surface.dependency}` : "Chưa khả dụng"),
    el("h1", "integration-empty__title", surface.label),
    el("p", "integration-empty__copy", surface.description),
  );
  container.append(card);
}
