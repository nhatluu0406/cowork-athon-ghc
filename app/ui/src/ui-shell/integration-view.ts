import { getIntegrationSurfaceAdapter } from "../integration-surface-adapters.js";
import type { ProductSurfaceDefinition } from "../surface-registry.js";
import { renderRemotePairing, type RemotePairingClient } from "../remote-pairing-view.js";
import { renderDispatchBoard, type DispatchBoardClient, type DispatchRunGate } from "../dispatch-board.js";
import { appendWorkflowCreator, type WorkflowCreatorClient } from "../workflow-creator.js";
import { el, icon } from "./dom-utils.js";

/** The client surface the Dispatch panel needs: phone pairing + the dispatch board + workflow creator. */
export type IntegrationSurfaceClient = RemotePairingClient & DispatchBoardClient & WorkflowCreatorClient;

export function createIntegrationView(): HTMLElement {
  const root = el("section", "view view--integration integration-surface");
  root.dataset["view"] = "integration";
  root.hidden = true;
  return root;
}

/**
 * The dispatch board: the stored task catalog + live fan-out runs from `/v1/dispatch`. This is
 * REAL local-service data (agent-harness-plan.md Tasks 4.1/5.1/5.2), not the external D1 backend
 * — the D1 dependency badge above stays honest about what has not landed.
 */
function appendDispatchBoard(
  mount: HTMLElement,
  client: DispatchBoardClient,
  gate: DispatchRunGate,
): () => void {
  const section = el("section", "integration-dispatch");
  section.append(el("h2", "integration-dispatch__title", "Dispatch nội bộ"));
  const body = el("div", "integration-dispatch__body", "Đang tải danh sách task…");
  section.append(body);
  mount.append(section);
  const refresh = (): void => void renderDispatchBoard(client, body, gate);
  refresh();
  return refresh;
}

/**
 * The Dispatch surface waits on the D1 backend, but phone access does not: the remote gateway
 * is built and running, so this surface doubles as the quick way to pair a phone without
 * typing `/remote`. The D1 status stays honest — pairing a phone does not mean D1 is
 * integrated, and nothing here renders D1 data.
 */
function appendRemoteQuickAccess(mount: HTMLElement, client: RemotePairingClient): void {
  const section = el("section", "integration-remote");
  section.append(
    el("h2", "integration-remote__title", "Truy cập nhanh bằng điện thoại"),
    el(
      "p",
      "integration-remote__copy",
      "Ghép nối điện thoại với gateway remote của máy này để theo dõi phiên và duyệt quyền. Độc lập với backend D1.",
    ),
  );
  const body = el("div", "integration-remote__body", "Đang tải trạng thái remote…");
  section.append(body);
  mount.append(section);
  void renderRemotePairing(client, body);
}

export function renderIntegrationSurface(
  container: HTMLElement,
  surface: ProductSurfaceDefinition,
  remoteClient?: IntegrationSurfaceClient | null,
  dispatchGate: DispatchRunGate = { canRun: true, reason: "" },
): void {
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

  // D1 fan-out is INTEGRATED (ADR 0011): the Dispatch surface's real content is the local
  // dispatch board (task catalog + live fan-out runs) plus the phone quick-access — NOT the
  // "awaiting integration" placeholder that still fits the genuinely-empty surfaces (D2/D3/D4,
  // code). The board queries `/v1/tasks` + `/v1/dispatch` on the local service and needs no
  // remote; the quick-access renders its own honest "remote chưa bật" note when the gateway is
  // off, so nothing here pretends to be connectable when it is not.
  if (surface.id === "dispatch" && remoteClient != null) {
    // Two-column dispatch layout (pr14): phone pairing on the left (main), the task board on
    // the right (a sidebar). The board KEEPS the F3 DispatchRunGate (main-wins) — pr14 dropped
    // that arg; we restore it so the provider/readiness gate still governs runs.
    mount.classList.add("integration-surface__mount--dispatch");
    const mainCol = el("div", "integration-surface__col integration-surface__col--main");
    const asideCol = el("aside", "integration-surface__col integration-surface__col--aside");
    appendRemoteQuickAccess(mainCol, remoteClient);
    // Right column: create-from-description panel on top, the live board below. onCreated refreshes
    // the board so a just-saved workflow appears immediately (and is 1-touch runnable on the phone).
    let refreshBoard = (): void => {};
    appendWorkflowCreator(asideCol, remoteClient, () => refreshBoard());
    refreshBoard = appendDispatchBoard(asideCol, remoteClient, dispatchGate);
    mount.append(mainCol, asideCol);
  } else {
    mount.append(card);
  }
  container.append(mount);
}
