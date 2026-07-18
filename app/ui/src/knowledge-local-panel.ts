/**
 * Local Knowledge panel controller (renderer) — the real Knowledge surface content.
 *
 * Drives the local KB/KG over the typed service client: an honest status bar (not-initialized →
 * indexing → ready/stale/interrupted/error) with the right primary action + a "More" menu that keeps
 * the destructive clear behind a confirmation; a two-column Knowledge Base (document list + detail /
 * search results with provenance handoffs); and a graph tab with a real, fitted, zoomable node/edge
 * view plus a node-detail side panel. It never fabricates results — an empty index shows an empty
 * state. Polls status only while a job is running; stops when idle, hidden, or disposed.
 *
 * The panel owns a single `.klp` root inside `dom.body`; the status bar and the tab body are patched
 * region-by-region so the graph view (and the search caret) survive a status refresh.
 */

import type { ServiceClient } from "./service-client.js";
import type {
  KnowledgeDocumentView,
  KnowledgeGraphApiResult,
  KnowledgeIndexView,
  KnowledgeSearchHitView,
  KnowledgeSourceRef,
  KnowledgeSourceType,
} from "@cowork-ghc/service/knowledge-local/types";
import type { KnowledgeViewDom, KnowledgeTab } from "./ui-shell/knowledge-view.js";
import {
  createLocalKnowledgeGraph,
  type LocalGraphNodeInput,
  type LocalKnowledgeGraphHandle,
} from "./knowledge-local-graph.js";
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
  partial: "Đồng bộ một phần",
  interrupted: "Bị gián đoạn",
  error: "Lỗi",
};

/** Source-filter label; `all` is the "every source" option. */
const SOURCE_FILTER_ALL = "all" as const;
type SourceFilter = KnowledgeSourceType | typeof SOURCE_FILTER_ALL;

const KIND_BADGE: Record<KnowledgeDocumentView["kind"], string> = {
  markdown: "MD",
  text: "TXT",
  code: "{ }",
  docx: "DOC",
  xlsx: "XLS",
  pptx: "PPT",
};

const KIND_LABEL: Record<KnowledgeDocumentView["kind"], string> = {
  markdown: "Markdown",
  text: "Văn bản",
  code: "Mã nguồn",
  docx: "Word",
  xlsx: "Excel",
  pptx: "PowerPoint",
};

const SEARCH_DEBOUNCE_MS = 300;
const POLL_MS = 1000;

type BodyKind = "none" | "no_workspace" | "base" | "graph";

function formatTime(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d.toISOString();
  }
}

export function mountKnowledgeLocalPanel(
  dom: KnowledgeViewDom,
  client: ServiceClient,
  callbacks: KnowledgeLocalPanelCallbacks,
): KnowledgeLocalPanelHandle {
  let status: KnowledgeIndexView | null = null;
  let tab: KnowledgeTab = "base";
  let searchQuery = "";
  let hits: readonly KnowledgeSearchHitView[] = [];
  let searchState: "idle" | "loading" | "done" = "idle";
  let documents: readonly KnowledgeDocumentView[] = [];
  let documentsLoaded = false;
  let kindFilter: KnowledgeDocumentView["kind"] | "all" = "all";
  let sourceFilter: SourceFilter = SOURCE_FILTER_ALL;
  let selectedDocPath: string | null = null;
  let graph: KnowledgeGraphApiResult | null = null;
  let graphRenderedKey = "";
  let selectedNode: LocalGraphNodeInput | null = null;
  let menuOpen = false;
  let pendingClear = false;

  let disposed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let statusInFlight = false;
  let graphHandle: LocalKnowledgeGraphHandle | null = null;
  let bodyKind: BodyKind = "none";

  // Persistent skeleton — built once, patched region-by-region.
  const rootEl = el("div", "klp");
  const statusHost = el("div", "klp-status");
  const bodyHost = el("div", "klp-bodyhost");
  rootEl.append(statusHost, bodyHost);

  // ---- lifecycle helpers --------------------------------------------------------------------

  const disposeGraph = (): void => {
    graphHandle?.dispose();
    graphHandle = null;
    graphRenderedKey = "";
  };

  const stopPolling = (): void => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const schedulePollIfIndexing = (): void => {
    stopPolling();
    if (disposed || status?.status !== "indexing") return;
    pollTimer = setTimeout(() => void refreshStatus(), POLL_MS);
  };

  async function refreshStatus(): Promise<void> {
    if (disposed || statusInFlight) return;
    statusInFlight = true;
    try {
      status = await client.knowledgeLocalStatus();
    } catch {
      // keep the last known status; a transient hiccup should not blank the panel
    } finally {
      statusInFlight = false;
    }
    if (disposed) return;
    // A fresh index or a workspace change invalidates the cached document list.
    if (status !== null && (status.status === "not_initialized" || status.documentCount !== documents.length)) {
      documentsLoaded = false;
    }
    render();
    schedulePollIfIndexing();
  }

  async function runAction(action: () => Promise<KnowledgeIndexView>): Promise<void> {
    menuOpen = false;
    pendingClear = false;
    try {
      status = await action();
    } catch {
      // next refresh reflects reality
    }
    // These mutate the corpus — force a reload of docs/graph.
    documentsLoaded = false;
    documents = [];
    disposeGraph();
    graph = null;
    selectedDocPath = null;
    selectedNode = null;
    searchQuery = "";
    hits = [];
    searchState = "idle";
    render();
    schedulePollIfIndexing();
    // After a clear/rebuild the counts settle asynchronously; a follow-up refresh keeps it honest.
    if (status?.status !== "indexing") void reloadData();
  }

  async function loadDocuments(): Promise<void> {
    try {
      documents = await client.knowledgeLocalDocuments();
    } catch {
      documents = [];
    }
    documentsLoaded = true;
    if (!disposed && tab === "base") {
      patchDocList();
      patchKbMain();
    }
  }

  async function reloadData(): Promise<void> {
    await loadDocuments();
    if (tab === "graph") await loadGraph();
  }

  async function runSearch(query: string): Promise<void> {
    searchQuery = query;
    if (query.trim().length === 0) {
      hits = [];
      searchState = "idle";
      if (!disposed) patchKbMain();
      return;
    }
    searchState = "loading";
    if (!disposed) patchKbMain();
    try {
      hits = await client.knowledgeLocalSearch(query);
    } catch {
      hits = [];
    }
    searchState = "done";
    if (!disposed) patchKbMain();
  }

  async function loadGraph(): Promise<void> {
    try {
      graph = await client.knowledgeLocalGraph();
    } catch {
      graph = { nodes: [], edges: [], truncated: false };
    }
    if (!disposed && tab === "graph") patchGraph();
  }

  // ---- small builders -----------------------------------------------------------------------

  function button(
    label: string,
    variant: string,
    onClick: () => void,
    opts: { disabled?: boolean; title?: string } = {},
  ): HTMLButtonElement {
    const b = el("button", `klp-btn ${variant}`.trim(), label) as HTMLButtonElement;
    b.type = "button";
    if (opts.disabled) b.disabled = true;
    if (opts.title !== undefined) b.title = opts.title;
    b.addEventListener("click", onClick);
    return b;
  }

  function linkButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", "klp-link", label) as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  /** A compact provenance chip. Detail (OneDrive/SharePoint/…) refines the workspace/m365 type. */
  function sourceBadge(source: KnowledgeSourceRef): HTMLElement {
    const variant = source.detail ?? source.type;
    return el("span", `klp-source klp-source--${variant}`, source.label);
  }

  // ---- status bar ---------------------------------------------------------------------------

  function renderStatus(): void {
    statusHost.replaceChildren();
    const s = status?.status ?? "not_initialized";

    const left = el("div", "klp-status__info");
    const chip = el("span", `klp-chip klp-chip--${s}`);
    if (s === "indexing") chip.append(el("span", "klp-chip__spinner"));
    chip.append(el("span", "klp-chip__text", STATUS_LABEL[s]));
    left.append(chip);

    if (status !== null && status.documentCount > 0) {
      left.append(
        el(
          "span",
          "klp-status__counts",
          `${status.documentCount} tài liệu · ${status.chunkCount} đoạn · ${status.nodeCount} nút · ${status.edgeCount} liên kết`,
        ),
      );
    }
    if (s === "indexing" && status?.indexing != null) {
      const { processed, total } = status.indexing;
      left.append(
        el("span", "klp-status__progress", total === null ? `Đang quét… (${processed})` : `${processed}/${total} tệp`),
      );
    } else if ((s === "ready" || s === "stale" || s === "partial") && status?.lastIndexedAt != null) {
      const t = formatTime(status.lastIndexedAt);
      if (t !== null) left.append(el("span", "klp-status__sync", `Đồng bộ: ${t}`));
    }

    // Compact, honest per-source summary — Workspace has data; Microsoft 365 shows readiness only.
    if (status !== null && status.hasWorkspace) {
      const sources = el("span", "klp-status__sources");
      sources.append(el("span", "klp-status__sources-label", "Nguồn:"));
      status.sources.forEach((src, i) => {
        const item = el("span", `klp-status__source klp-status__source--${src.type}`);
        item.append(sourceBadge({ type: src.type, detail: null, label: src.label }));
        // Honest readiness (issue #19): connected-with-docs shows the count; connected-but-no-docs
        // (e.g. Microsoft 365 linked, but no importer yet) shows "Đã kết nối"; otherwise "Chưa kết nối".
        item.append(
          el(
            "span",
            "klp-status__source-note",
            src.connected
              ? src.documentCount > 0
                ? `${src.documentCount} tài liệu`
                : "Đã kết nối"
              : "Chưa kết nối",
          ),
        );
        sources.append(item);
        if (i < status!.sources.length - 1) sources.append(el("span", "klp-status__source-sep", "·"));
      });
      left.append(sources);
    }

    statusHost.append(left);

    // No workspace → the body owns the "Chọn Workspace" CTA; don't offer index actions that would
    // run against nothing ("không để action indexing chạy sai").
    if (status !== null && !status.hasWorkspace) return;

    if (pendingClear) {
      const confirm = el("div", "klp-status__confirm");
      confirm.append(el("span", "klp-status__confirm-text", "Xóa toàn bộ chỉ mục? File gốc được giữ nguyên."));
      confirm.append(
        button("Xóa chỉ mục", "klp-btn--danger", () => void runAction(() => client.knowledgeLocalClear())),
        button("Huỷ", "klp-btn--ghost", () => {
          pendingClear = false;
          renderStatus();
        }),
      );
      statusHost.append(confirm);
      return;
    }

    statusHost.append(renderActions(s));
  }

  function renderActions(s: KnowledgeIndexView["status"]): HTMLElement {
    const actions = el("div", "klp-status__actions");
    if (s === "indexing") {
      actions.append(button("Hủy", "klp-btn--ghost", () => void runAction(() => client.knowledgeLocalCancel())));
      return actions;
    }
    if (s === "not_initialized") {
      actions.append(
        button("Khởi tạo Knowledge", "klp-btn--primary", () => void runAction(() => client.knowledgeLocalSync())),
      );
      return actions;
    }
    const primaryLabel = s === "error" || s === "interrupted" ? "Thử lại" : "Đồng bộ";
    actions.append(button(primaryLabel, "klp-btn--primary", () => void runAction(() => client.knowledgeLocalSync())));
    actions.append(renderMoreMenu());
    return actions;
  }

  function renderMoreMenu(): HTMLElement {
    const wrap = el("div", "klp-menu");
    const trigger = button("Thêm ▾", "klp-btn--ghost", () => {
      menuOpen = !menuOpen;
      renderStatus();
    });
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", menuOpen ? "true" : "false");
    wrap.append(trigger);
    if (menuOpen) {
      const panel = el("div", "klp-menu__panel");
      panel.setAttribute("role", "menu");
      const rebuild = el("button", "klp-menu__item", "Xây dựng lại") as HTMLButtonElement;
      rebuild.type = "button";
      rebuild.addEventListener("click", () => {
        void runAction(async () => {
          await client.knowledgeLocalClear();
          return client.knowledgeLocalSync();
        });
      });
      const clear = el("button", "klp-menu__item klp-menu__item--danger", "Xóa chỉ mục") as HTMLButtonElement;
      clear.type = "button";
      clear.addEventListener("click", () => {
        menuOpen = false;
        pendingClear = true;
        renderStatus();
      });
      panel.append(rebuild, clear);
      wrap.append(panel);
    }
    return wrap;
  }

  // ---- body: no-workspace / base / graph ----------------------------------------------------

  function render(): void {
    if (disposed) return;
    if (dom.body.firstChild !== rootEl) dom.body.replaceChildren(rootEl);
    renderStatus();

    const desired: BodyKind =
      status !== null && !status.hasWorkspace ? "no_workspace" : tab === "graph" ? "graph" : "base";

    if (desired !== bodyKind) {
      disposeGraph();
      bodyHost.replaceChildren();
      bodyKind = desired;
      if (desired === "no_workspace") buildNoWorkspace();
      else if (desired === "base") buildBase();
      else buildGraph();
    } else {
      if (desired === "base") {
        patchDocList();
        patchKbMain();
      } else if (desired === "graph") {
        patchGraph();
      }
    }

    // Kick off the data loads the current view needs.
    if (desired === "base" && !documentsLoaded && status?.hasWorkspace) void loadDocuments();
    if (desired === "graph" && graph === null) void loadGraph();
  }

  function buildNoWorkspace(): void {
    const empty = el("div", "klp-empty");
    empty.append(
      el("div", "klp-empty__badge", "◎"),
      el("h2", "klp-empty__title", "Chọn workspace để khởi tạo Knowledge"),
      el(
        "p",
        "klp-empty__copy",
        "Knowledge Base lập chỉ mục tài liệu trong workspace đang hoạt động — dùng chung với Cowork và Workspace. Mọi xử lý đều cục bộ, không cần Internet.",
      ),
    );
    empty.append(button("Chọn Workspace", "klp-btn--primary", () => callbacks.onChooseWorkspace()));
    bodyHost.append(empty);
  }

  // ---- Kho tri thức -------------------------------------------------------------------------

  let docListHost: HTMLElement | null = null;
  let kbMainHost: HTMLElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  let filterSelect: HTMLSelectElement | null = null;
  let sourceSelect: HTMLSelectElement | null = null;

  function buildBase(): void {
    const kb = el("div", "klp-kb");

    const side = el("aside", "klp-kb__side");
    const searchWrap = el("div", "klp-search");
    const input = el("input", "klp-search__input knowledge-search__input") as HTMLInputElement;
    input.type = "search";
    input.placeholder = "Tìm trong tài liệu…";
    input.value = searchQuery;
    input.disabled = status === null || status.documentCount === 0;
    input.setAttribute("aria-label", "Tìm trong tài liệu");
    input.addEventListener("input", () => {
      if (searchTimer !== null) clearTimeout(searchTimer);
      const value = input.value;
      searchTimer = setTimeout(() => void runSearch(value), SEARCH_DEBOUNCE_MS);
    });
    searchInput = input;
    searchWrap.append(input);
    side.append(searchWrap);

    const filterRow = el("div", "klp-filter");

    // Source filter — Workspace has data today; Microsoft 365 appears as an honest, disabled option.
    const srcSel = document.createElement("select");
    srcSel.className = "klp-filter__select klp-filter__select--source";
    srcSel.setAttribute("aria-label", "Lọc theo nguồn dữ liệu");
    sourceSelect = srcSel;
    srcSel.addEventListener("change", () => {
      sourceFilter = (srcSel.value as SourceFilter) || SOURCE_FILTER_ALL;
      patchDocList();
      patchKbMain();
    });
    filterRow.append(srcSel);

    const select = document.createElement("select");
    select.className = "klp-filter__select";
    select.setAttribute("aria-label", "Lọc theo loại tài liệu");
    filterSelect = select;
    select.addEventListener("change", () => {
      kindFilter = (select.value as typeof kindFilter) || "all";
      patchDocList();
    });
    filterRow.append(select);
    side.append(filterRow);

    const list = el("div", "klp-docs");
    list.setAttribute("role", "list");
    docListHost = list;
    side.append(list);

    const main = el("div", "klp-kb__main");
    kbMainHost = main;

    kb.append(side, main);
    bodyHost.append(kb);

    patchDocList();
    patchKbMain();
  }

  function patchDocList(): void {
    if (docListHost === null || bodyKind !== "base") return;

    // Keep the search box enabled-state in sync with the live status (it is built before the first
    // status poll resolves, so it must be re-evaluated on every patch — not frozen at build time).
    if (searchInput !== null) searchInput.disabled = status === null || status.documentCount === 0;

    // Source filter options: "Tất cả nguồn" + one option per known source. A source with no data yet
    // (Microsoft 365 in the MVP) is shown but disabled — honest readiness, never a fake selectable count.
    if (sourceSelect !== null) {
      const summaries = status?.sources ?? [];
      // A source is only a *selectable filter* when it is connected AND actually has documents —
      // a connected-but-empty source (MS365 linked with no importer yet) must not offer an empty
      // filter (issue #19).
      const hasData = (s: (typeof summaries)[number]): boolean => s.connected && s.documentCount > 0;
      const selectable = new Set<string>([SOURCE_FILTER_ALL, ...summaries.filter(hasData).map((s) => s.type)]);
      if (!selectable.has(sourceFilter)) sourceFilter = SOURCE_FILTER_ALL;
      sourceSelect.replaceChildren();
      const allOpt = document.createElement("option");
      allOpt.value = SOURCE_FILTER_ALL;
      allOpt.textContent = "Tất cả nguồn";
      sourceSelect.append(allOpt);
      for (const src of summaries) {
        const opt = document.createElement("option");
        opt.value = src.type;
        opt.textContent = !src.connected
          ? `${src.label} · Chưa kết nối`
          : src.documentCount > 0
            ? src.label
            : `${src.label} · chưa đồng bộ`;
        opt.disabled = !hasData(src);
        sourceSelect.append(opt);
      }
      sourceSelect.value = sourceFilter;
    }

    // Refresh the filter options to reflect the kinds actually present.
    if (filterSelect !== null) {
      const present = [...new Set(documents.map((d) => d.kind))];
      const wanted = ["all", ...present];
      const current = filterSelect.value || "all";
      filterSelect.replaceChildren();
      const allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = `Tất cả loại (${documents.length})`;
      filterSelect.append(allOpt);
      for (const kind of present) {
        const opt = document.createElement("option");
        opt.value = kind;
        opt.textContent = KIND_LABEL[kind];
        filterSelect.append(opt);
      }
      if (!wanted.includes(kindFilter)) kindFilter = "all";
      filterSelect.value = wanted.includes(current) ? current : "all";
    }

    docListHost.replaceChildren();
    const filtered = documents.filter(
      (d) =>
        (kindFilter === "all" || d.kind === kindFilter) &&
        (sourceFilter === SOURCE_FILTER_ALL || d.source.type === sourceFilter),
    );

    if (!documentsLoaded && status?.status === "indexing") {
      docListHost.append(el("p", "klp-note", "Đang lập chỉ mục…"));
      return;
    }
    if (documents.length === 0) {
      docListHost.append(
        el("p", "klp-note", status?.documentCount === 0 ? "Chưa có tài liệu. Đồng bộ workspace để bắt đầu." : "Đang tải…"),
      );
      return;
    }
    if (filtered.length === 0) {
      docListHost.append(el("p", "klp-note", "Không có tài liệu thuộc loại này."));
      return;
    }
    for (const doc of filtered) {
      const item = el("button", "klp-doc") as HTMLButtonElement;
      item.type = "button";
      item.setAttribute("role", "listitem");
      if (doc.relativePath === selectedDocPath) item.classList.add("klp-doc--active");
      item.append(el("span", `klp-doc__badge klp-doc__badge--${doc.kind}`, KIND_BADGE[doc.kind]));
      const bodyCol = el("span", "klp-doc__body");
      bodyCol.append(el("span", "klp-doc__name", doc.title));
      bodyCol.append(el("span", "klp-doc__path", doc.relativePath));
      const meta = el("span", "klp-doc__meta");
      meta.append(sourceBadge(doc.source));
      meta.append(el("span", "klp-doc__meta-text", `${doc.chunkCount} đoạn`));
      bodyCol.append(meta);
      item.append(bodyCol);
      item.addEventListener("click", () => selectDocument(doc.relativePath));
      docListHost.append(item);
    }
  }

  function selectDocument(relativePath: string): void {
    selectedDocPath = relativePath;
    // Selecting a document leaves search mode so the detail is visible.
    if (searchQuery.trim().length > 0) {
      searchQuery = "";
      hits = [];
      searchState = "idle";
      if (searchInput !== null) searchInput.value = "";
    }
    patchDocList();
    patchKbMain();
  }

  function patchKbMain(): void {
    if (kbMainHost === null || bodyKind !== "base") return;
    kbMainHost.replaceChildren();

    if (searchQuery.trim().length > 0) {
      kbMainHost.append(renderSearchResults());
      return;
    }
    const doc = documents.find((d) => d.relativePath === selectedDocPath) ?? null;
    if (doc !== null) {
      kbMainHost.append(renderDocDetail(doc));
      return;
    }
    // nothing selected, not searching
    const empty = el("div", "klp-main-empty");
    if (status !== null && status.documentCount > 0) {
      empty.append(
        el("h3", "klp-main-empty__title", "Tra cứu tri thức cục bộ"),
        el("p", "klp-main-empty__copy", "Chọn một tài liệu bên trái để xem chi tiết, hoặc gõ từ khoá để tìm trong toàn bộ nội dung đã lập chỉ mục."),
      );
    } else {
      empty.append(
        el("h3", "klp-main-empty__title", "Chưa có gì trong Knowledge"),
        el("p", "klp-main-empty__copy", "Đồng bộ workspace hiện tại để lập chỉ mục tài liệu và bật tìm kiếm + đồ thị."),
      );
    }
    kbMainHost.append(empty);
  }

  function renderSearchResults(): HTMLElement {
    const wrap = el("div", "klp-results");
    if (searchState === "loading") {
      wrap.append(el("p", "klp-note", "Đang tìm…"));
      return wrap;
    }
    const shown = hits.filter((h) => sourceFilter === SOURCE_FILTER_ALL || h.source.type === sourceFilter);
    wrap.append(
      el(
        "p",
        "klp-results__head",
        shown.length === 0
          ? `Không tìm thấy kết quả cho “${searchQuery.trim()}”.`
          : `${shown.length} kết quả cho “${searchQuery.trim()}”`,
      ),
    );
    for (const hit of shown) {
      const row = el("div", "klp-hit");
      const head = el("div", "klp-hit__head");
      head.append(el("span", `klp-doc__badge klp-doc__badge--${hit.kind}`, KIND_BADGE[hit.kind]));
      head.append(el("span", "klp-hit__title", hit.title));
      head.append(el("span", "klp-hit__path", hit.relativePath));
      head.append(sourceBadge(hit.source));
      row.append(head);
      row.append(highlightSnippet(hit.snippet));
      const acts = el("div", "klp-hit__actions");
      acts.append(linkButton("Mở nguồn", () => callbacks.onOpenSource(hit.relativePath)));
      acts.append(linkButton("Hỏi Cowork", () => callbacks.onAskCowork(hit.relativePath)));
      row.append(acts);
      wrap.append(row);
    }
    return wrap;
  }

  function renderDocDetail(doc: KnowledgeDocumentView): HTMLElement {
    const card = el("div", "klp-detail");
    const head = el("div", "klp-detail__head");
    head.append(el("span", `klp-doc__badge klp-doc__badge--${doc.kind}`, KIND_BADGE[doc.kind]));
    head.append(el("h3", "klp-detail__title", doc.title));
    card.append(head);
    card.append(el("p", "klp-detail__path", doc.relativePath));

    const meta = el("dl", "klp-detail__meta");
    const addMeta = (k: string, v: string): void => {
      meta.append(el("dt", "klp-detail__dt", k), el("dd", "klp-detail__dd", v));
    };
    // Provenance first: which source + the safe location (relative path for workspace files).
    meta.append(el("dt", "klp-detail__dt", "Nguồn"));
    const srcDd = el("dd", "klp-detail__dd");
    srcDd.append(sourceBadge(doc.source));
    meta.append(srcDd);
    addMeta(doc.source.type === "workspace" ? "Đường dẫn" : "Vị trí", doc.relativePath);
    addMeta("Loại", KIND_LABEL[doc.kind]);
    addMeta("Số đoạn", String(doc.chunkCount));
    addMeta("Kích thước", `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB`);
    const t = formatTime(doc.indexedAt);
    if (t !== null) addMeta("Lập chỉ mục", t);
    card.append(meta);

    const acts = el("div", "klp-detail__actions");
    acts.append(button("Mở nguồn", "klp-btn--primary", () => callbacks.onOpenSource(doc.relativePath)));
    acts.append(button("Hỏi Cowork", "klp-btn--ghost", () => callbacks.onAskCowork(doc.relativePath)));
    card.append(acts);
    return card;
  }

  function highlightSnippet(snippet: string): HTMLElement {
    const p = el("p", "klp-hit__snippet");
    // Snippets arrive with «matched» markers; render them as <mark> without parsing any HTML.
    const parts = snippet.split(/(«[^»]*»)/g);
    for (const part of parts) {
      if (part.startsWith("«") && part.endsWith("»")) {
        p.append(el("mark", "klp-mark knowledge-hit__mark", part.slice(1, -1)));
      } else if (part.length > 0) {
        p.append(document.createTextNode(part));
      }
    }
    return p;
  }

  // ---- Đồ thị -------------------------------------------------------------------------------

  let graphStage: HTMLElement | null = null;
  let graphAside: HTMLElement | null = null;

  function buildGraph(): void {
    const wrap = el("div", "klp-graph");
    const stage = el("div", "klp-graph__stage knowledge-graph-host");
    const aside = el("aside", "klp-graph__aside");
    graphStage = stage;
    graphAside = aside;
    wrap.append(stage, aside);
    bodyHost.append(wrap);
    patchGraph();
  }

  function patchGraph(): void {
    if (graphStage === null || bodyKind !== "graph") return;

    if (graph === null) {
      disposeGraph();
      graphStage.replaceChildren(el("p", "klp-note klp-graph__msg", "Đang tải đồ thị…"));
      renderGraphAside();
      return;
    }
    if (graph.nodes.length === 0) {
      disposeGraph();
      const s = status?.status ?? "not_initialized";
      graphStage.replaceChildren(
        el(
          "p",
          "klp-note klp-graph__msg",
          s === "indexing" ? "Đang dựng đồ thị…" : "Chưa có đồ thị. Đồng bộ workspace để dựng đồ thị tài liệu.",
        ),
      );
      renderGraphAside();
      return;
    }

    // Only (re)build the SVG when the data actually changed — preserves zoom/pan/selection.
    const key = `${graph.nodes.length}:${graph.edges.length}:${graph.truncated ? 1 : 0}`;
    if (graphHandle !== null && key === graphRenderedKey) {
      graphHandle.refit();
      return;
    }
    disposeGraph();
    graphStage.replaceChildren();
    graphRenderedKey = key;
    graphHandle = createLocalKnowledgeGraph(graphStage, {
      nodes: graph.nodes,
      edges: graph.edges,
      truncated: graph.truncated,
      selectedId: selectedNode?.id ?? null,
      onSelect: (node) => {
        selectedNode = node;
        renderGraphAside();
      },
    });
    renderGraphAside();
  }

  function renderGraphAside(): void {
    if (graphAside === null) return;
    graphAside.replaceChildren();
    const node = selectedNode;
    if (node === null) {
      const empty = el("div", "klp-graph__aside-empty");
      empty.append(
        el("h4", "klp-graph__aside-title", "Chi tiết nút"),
        el("p", "klp-note", "Chọn một nút trong đồ thị để xem chi tiết và mở nguồn."),
      );
      graphAside.append(empty);
      return;
    }
    graphAside.append(el("h4", "klp-graph__aside-title", node.label));
    const kindLabel = node.kind === "workspace" ? "Workspace" : node.kind === "folder" ? "Thư mục" : "Tài liệu";
    const meta = el("dl", "klp-detail__meta");
    meta.append(el("dt", "klp-detail__dt", "Loại"), el("dd", "klp-detail__dd", kindLabel));
    const srcDd = el("dd", "klp-detail__dd");
    srcDd.append(sourceBadge(node.source));
    meta.append(el("dt", "klp-detail__dt", "Nguồn"), srcDd);
    if (node.relativePath !== null) {
      meta.append(el("dt", "klp-detail__dt", "Đường dẫn"), el("dd", "klp-detail__dd", node.relativePath));
    }
    if (graph !== null) {
      const links = graph.edges.filter((e) => e.from === node.id || e.to === node.id).length;
      meta.append(el("dt", "klp-detail__dt", "Liên kết"), el("dd", "klp-detail__dd", String(links)));
    }
    graphAside.append(meta);
    if (node.relativePath !== null && node.kind === "document") {
      const acts = el("div", "klp-detail__actions");
      acts.append(button("Mở nguồn", "klp-btn--primary", () => callbacks.onOpenSource(node.relativePath!)));
      acts.append(button("Hỏi Cowork", "klp-btn--ghost", () => callbacks.onAskCowork(node.relativePath!)));
      graphAside.append(acts);
    }
  }

  // ---- public handle ------------------------------------------------------------------------

  return {
    show(nextTab: KnowledgeTab): void {
      const tabChanged = nextTab !== tab;
      tab = nextTab;
      if (tab === "graph" && tabChanged) {
        graph = null; // fresh graph fetch on entering the tab
      }
      menuOpen = false;
      void refreshStatus();
      render();
    },
    dispose(): void {
      disposed = true;
      stopPolling();
      if (searchTimer !== null) clearTimeout(searchTimer);
      disposeGraph();
    },
  };
}
