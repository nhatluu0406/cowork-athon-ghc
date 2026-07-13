import { getIntegrationSurfaceAdapter } from "../integration-surface-adapters.js";
import type { ProductSurfaceDefinition } from "../surface-registry.js";
import { el, icon } from "./dom-utils.js";

export function createIntegrationView(): HTMLElement {
  const root = el("section", "view view--integration integration-surface");
  root.dataset["view"] = "integration";
  root.hidden = true;
  return root;
}

export function renderIntegrationSurface(container: HTMLElement, surface: ProductSurfaceDefinition): void {
  container.replaceChildren();
  const adapter = getIntegrationSurfaceAdapter(surface.id);

  const mount = el("div", "integration-surface__mount");
  if (adapter !== null) {
    mount.id = adapter.mountId;
    mount.dataset["integrationComponent"] = adapter.component;
    mount.dataset["integrationSurface"] = adapter.surfaceId;
  } else {
    mount.dataset["integrationSurface"] = surface.id;
  }

  const statusLabel =
    adapter?.statusLabel ??
    (surface.availability === "planned"
      ? "Đã lên kế hoạch"
      : surface.dependency !== undefined
        ? `Chờ tích hợp ${surface.dependency}`
        : "Chưa khả dụng");
  const description = adapter?.description ?? surface.description;

  const card = el("section", "integration-empty");
  const iconWrap = el("div", "integration-empty__icon");
  iconWrap.append(icon(surface.icon, surface.label));
  card.append(
    iconWrap,
    el("h1", "integration-empty__title", surface.label),
    el("span", "integration-empty__badge", statusLabel),
    el("p", "integration-empty__copy", description),
  );

  if (surface.availability === "awaiting_integration" && surface.dependency !== undefined) {
    card.append(
      el(
        "p",
        "integration-empty__note",
        `Mount point ${surface.dependency} đã sẵn sàng; không hiển thị dữ liệu giả trước khi team tích hợp bàn giao.`,
      ),
    );
  }

  mount.append(card);
  container.append(mount);
}
