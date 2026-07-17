/**
 * Local Knowledge panel controller (renderer) — the real Knowledge surface content.
 *
 * Drives the local KB/KG over the typed service client: honest status/lifecycle (not-initialized →
 * indexing → ready/stale/interrupted/error) with the right next action, FTS keyword search with
 * provenance (open the source file in Workspace, or ask Cowork about it), and a graph view fed by the
 * deterministic node/edge data. It never fabricates results — an empty index shows an empty state.
 * Polls status only while a job is running; stops when idle, hidden, or disposed.
 */

import type { ServiceClient } from "./service-client.js";
import type {
  KnowledgeGraphApiResult,
  KnowledgeIndexView,
  KnowledgeSearchHit,
} from "@cowork-ghc/service/knowledge-local/types";
import type { KnowledgeViewDom, KnowledgeTab } from "./ui-shell/knowledge-view.js";
import { createKnowledgeGraphView } from "./knowledge-graph-view.js";
import { el } from "./ui-shell/dom-utils.js";

export interface KnowledgeLocalPanelCallbacks {
  /** Open a workspace-relative source file (hand off to Workspace). */
  readonly onOpenSource: (relativePath: string) => void;
  /** Ask Cowork about a workspace-relative source file. */
  readonly onAskCowork: (relativePath: string) => void;
  /** Open the workspace picker (no-workspace state primary action). */
  readonly onChooseWorkspace: () => void;
}

export interface KnowledgeLocalPanelHandle {
  /** Render the panel for the given tab, refreshing status from the service when needed. */
  show(tab: KnowledgeTab): void;
  dispose(): void;
}

const STATUS_LABEL: Record<KnowledgeIndexView["status"], string> = {
  not_initialized: "Chưa khởi tạo",
  indexing: "Đang lập chỉ mục",
  ready: "Sẵn sàng",
  stale: "Cần đồng bộ",
  interrupted: "Bị gián đoạn",
  error: "Lỗi",
};

const SEARCH_DEBOUNCE_MS = 300;
const POLL_MS = 1000;

export function mountKnowledgeLocalPanel(
  dom: KnowledgeViewDom,
  client: ServiceClient,
  callbacks: KnowledgeLocalPanelCallbacks,
): KnowledgeLocalPanelHandle {
  let status: KnowledgeIndexView | null = null;
  let tab: KnowledgeTab = "base";
  let searchQuery = "";
  let hits: readonly KnowledgeSearchHit[] = [];
  let graph: KnowledgeGraphApiResult | null = null;
  let disposed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let statusInFlight = false;

  const stopPolling = (): void => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const schedulePollIfIndexing = (): void => {
    stopPolling();
    if (disposed || status?.status !== "indexing") return;
    pollTimer = setTimeout(() => {
      void refreshStatus();
    }, POLL_MS);
  };

  async function refreshStatus(): Promise<void> {
    if (disposed || statusInFlight) return;
    statusInFlight = true;
    try {
      status = await client.knowledgeLocalStatus();
    } catch {
      // Leave the last known status; a transient service hiccup should not blank the panel.
    } finally {
      statusInFlight = false;
    }
    if (disposed) return;
    render();
    schedulePollIfIndexing();
  }

  async function runAction(action: () => Promise<KnowledgeIndexView>): Promise<void> {
    try {
      status = await action();
    } catch {
      // ignore — next status refresh reflects reality
    }
    render();
    schedulePollIfIndexing();
  }

  async function runSearch(query: string): Promise<void> {
    searchQuery = query;
    if (query.trim().length === 0) {
      hits = [];
      renderBaseResults();
      return;
    }
    try {
      hits = await client.knowledgeLocalSearch(query);
    } catch {
      hits = [];
    }
    if (!disposed) renderBaseResults();
  }

  async function loadGraph(): Promise<void> {
    try {
      graph = await client.knowledgeLocalGraph();
    } catch {
      graph = { nodes: [], edges: [], truncated: false };
    }
    if (!disposed && tab === "graph") render();
  }

  // ---- rendering ----------------------------------------------------------------------------

  function actionButton(label: string, onClick: () => void, variant = ""): HTMLButtonElement {
    const btn = el("button", `knowledge-action ${variant}`.trim(), label) as HTMLButtonElement;
    btn.type = "button";
    btn.addEventListener("click", onClick);
    return btn;
  }

  function renderStatusBar(): HTMLElement {
    const bar = el("div", "knowledge-statusbar");
    const s = status?.status ?? "not_initialized";
    const chip = el("span", `knowledge-chip knowledge-chip--${s}`, STATUS_LABEL[s]);
    bar.append(chip);
    if (status !== null && status.documentCount > 0) {
      bar.append(
        el(
          "span",
          "knowledge-statusbar__counts",
          `${status.documentCount} tài liệu · ${status.chunkCount} đoạn · ${status.nodeCount} nút · ${status.edgeCount} liên kết`,
        ),
      );
    }
    if (status?.indexing != null) {
      const { processed, total } = status.indexing;
      bar.append(
        el("span", "knowledge-statusbar__progress", total === null ? `Đang quét… (${processed})` : `${processed}/${total}`),
      );
    }
    return bar;
  }

  function renderActions(): HTMLElement {
    const row = el("div", "knowledge-actions");
    const s = status?.status ?? "not_initialized";
    if (s === "indexing") {
      row.append(actionButton("Hủy", () => void runAction(() => client.knowledgeLocalCancel()), "knowledge-action--ghost"));
      return row;
    }
    if (s === "not_initialized") {
      row.append(actionButton("Khởi tạo Knowledge", () => void runAction(() => client.knowledgeLocalSync()), "knowledge-action--primary"));
      return row;
    }
    if (s === "error" || s === "interrupted") {
      row.append(actionButton("Thử lại", () => void runAction(() => client.knowledgeLocalSync()), "knowledge-action--primary"));
    } else {
      row.append(actionButton("Đồng bộ", () => void runAction(() => client.knowledgeLocalSync()), "knowledge-action--primary"));
    }
    row.append(
      actionButton("Xây dựng lại", () => {
        void runAction(async () => {
          await client.knowledgeLocalClear();
          return client.knowledgeLocalSync();
        });
      }, "knowledge-action--ghost"),
    );
    row.append(
      actionButton("Xóa chỉ mục", () => void runAction(() => client.knowledgeLocalClear()), "knowledge-action--ghost"),
    );
    return row;
  }

  function renderNoWorkspace(): void {
    dom.body.replaceChildren();
    const empty = el("div", "knowledge-empty");
    empty.append(
      el("h2", "knowledge-empty__title", "Chọn workspace để khởi tạo Knowledge"),
      el(
        "p",
        "knowledge-empty__copy",
        "Knowledge Base lập chỉ mục các tài liệu trong workspace đang hoạt động — dùng chung với Cowork và Workspace. Tất cả xử lý cục bộ, không cần Internet.",
      ),
    );
    const cta = el("button", "knowledge-action knowledge-action--primary", "Chọn Workspace") as HTMLButtonElement;
    cta.type = "button";
    cta.addEventListener("click", () => callbacks.onChooseWorkspace());
    empty.append(cta);
    dom.body.append(empty);
  }

  function highlightSnippet(snippet: string): HTMLElement {
    const p = el("p", "knowledge-hit__snippet");
    // Snippets arrive with «matched» markers; render them as <mark> without parsing any HTML.
    const parts = snippet.split(/(«[^»]*»)/g);
    for (const part of parts) {
      if (part.startsWith("«") && part.endsWith("»")) {
        p.append(el("mark", "knowledge-hit__mark", part.slice(1, -1)));
      } else if (part.length > 0) {
        p.append(document.createTextNode(part));
      }
    }
    return p;
  }

  function renderBaseResults(): void {
    const existing = dom.body.querySelector(".knowledge-results");
    const list = el("div", "knowledge-results");
    if (searchQuery.trim().length === 0) {
      list.append(
        el(
          "p",
          "knowledge-note",
          status !== null && status.documentCount > 0
            ? "Nhập từ khoá để tìm trong tài liệu đã lập chỉ mục."
            : "Chưa có tài liệu nào — Đồng bộ workspace để bắt đầu.",
        ),
      );
    } else if (hits.length === 0) {
      list.append(el("p", "knowledge-note", `Không tìm thấy kết quả cho “${searchQuery}”.`));
    } else {
      for (const hit of hits) {
        const row = el("div", "knowledge-hit");
        const head = el("div", "knowledge-hit__head");
        head.append(el("span", "knowledge-hit__title", hit.title));
        head.append(el("span", "knowledge-hit__path", hit.relativePath));
        row.append(head);
        row.append(highlightSnippet(hit.snippet));
        const actions = el("div", "knowledge-hit__actions");
        const open = el("button", "knowledge-hit__btn", "Mở nguồn") as HTMLButtonElement;
        open.type = "button";
        open.addEventListener("click", () => callbacks.onOpenSource(hit.relativePath));
        const ask = el("button", "knowledge-hit__btn", "Hỏi Cowork") as HTMLButtonElement;
        ask.type = "button";
        ask.addEventListener("click", () => callbacks.onAskCowork(hit.relativePath));
        actions.append(open, ask);
        row.append(actions);
        list.append(row);
      }
    }
    if (existing !== null) existing.replaceWith(list);
    else dom.body.append(list);
  }

  function renderBase(): void {
    dom.body.replaceChildren();
    dom.body.append(renderStatusBar(), renderActions());
    if (status?.error != null && status.error.length > 0) {
      dom.body.append(el("p", "knowledge-error", status.error));
    }
    const searchWrap = el("div", "knowledge-search");
    const input = el("input", "knowledge-search__input") as HTMLInputElement;
    input.type = "search";
    input.placeholder = "Tìm trong tài liệu…";
    input.value = searchQuery;
    input.disabled = status === null || status.documentCount === 0;
    input.addEventListener("input", () => {
      if (searchTimer !== null) clearTimeout(searchTimer);
      const value = input.value;
      searchTimer = setTimeout(() => void runSearch(value), SEARCH_DEBOUNCE_MS);
    });
    searchWrap.append(input);
    dom.body.append(searchWrap);
    renderBaseResults();
  }

  function renderGraph(): void {
    dom.body.replaceChildren();
    dom.body.append(renderStatusBar(), renderActions());
    if (graph === null) {
      dom.body.append(el("p", "knowledge-note", "Đang tải đồ thị…"));
      void loadGraph();
      return;
    }
    if (graph.nodes.length === 0) {
      dom.body.append(
        el("p", "knowledge-note", "Chưa có đồ thị — Đồng bộ workspace để dựng đồ thị tài liệu."),
      );
      return;
    }
    const host = el("div", "knowledge-graph-host");
    createKnowledgeGraphView(host, {
      graph: {
        nodes: graph.nodes.map((n) => ({ id: n.id, label: n.label, properties: { kind: n.kind } })),
        edges: graph.edges.map((e) => ({ from: e.from, to: e.to, type: e.type })),
        truncated: graph.truncated,
      },
    });
    dom.body.append(host);
    if (graph.truncated) {
      dom.body.append(el("p", "knowledge-note", "Đồ thị lớn — chỉ hiển thị một phần các nút."));
    }
  }

  function render(): void {
    if (disposed) return;
    if (status !== null && !status.hasWorkspace) {
      renderNoWorkspace();
      return;
    }
    if (tab === "graph") renderGraph();
    else renderBase();
  }

  return {
    show(nextTab: KnowledgeTab): void {
      const tabChanged = nextTab !== tab;
      tab = nextTab;
      if (tab === "graph" && (graph === null || tabChanged)) {
        graph = null; // force a fresh graph load on entering the tab
      }
      // Always refresh status when shown (cheap) so counts/state are current after cross-surface work.
      void refreshStatus();
      render();
    },
    dispose(): void {
      disposed = true;
      stopPolling();
      if (searchTimer !== null) clearTimeout(searchTimer);
    },
  };
}
