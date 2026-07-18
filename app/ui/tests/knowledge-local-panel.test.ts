import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKnowledgeView } from "../src/ui-shell/knowledge-view.js";
import { mountKnowledgeLocalPanel } from "../src/knowledge-local-panel.js";
import type { ServiceClient } from "../src/service-client.js";
import type {
  KnowledgeDocumentView,
  KnowledgeIndexView,
  KnowledgeSearchHitView,
} from "@cowork-ghc/service/knowledge-local/types";
import { WORKSPACE_SOURCE } from "@cowork-ghc/service/knowledge-local/types";

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Honest source rollup: Workspace connected, Microsoft 365 present-but-not-connected. */
const sources = (workspaceDocs: number): KnowledgeIndexView["sources"] => [
  { type: "workspace", label: "Workspace", connected: true, documentCount: workspaceDocs },
  { type: "microsoft365", label: "Microsoft 365", connected: false, documentCount: 0 },
];

const view = (over: Partial<KnowledgeIndexView> = {}): KnowledgeIndexView => {
  const base: KnowledgeIndexView = {
    status: "ready",
    hasWorkspace: true,
    documentCount: 3,
    chunkCount: 9,
    nodeCount: 4,
    edgeCount: 3,
    lastIndexedAt: "2026-07-18T00:00:00.000Z",
    error: null,
    indexing: null,
    sources: sources(3),
    ...over,
  };
  return over.sources ? base : { ...base, sources: sources(base.documentCount) };
};

const doc = (over: Partial<KnowledgeDocumentView> = {}): KnowledgeDocumentView => ({
  id: "d1",
  relativePath: "docs/a.md",
  title: "a.md",
  kind: "markdown",
  chunkCount: 2,
  sizeBytes: 2048,
  indexedAt: "2026-07-18T00:00:00.000Z",
  source: WORKSPACE_SOURCE,
  ...over,
});

const hit = (over: Partial<KnowledgeSearchHitView> = {}): KnowledgeSearchHitView => ({
  documentId: "d1",
  chunkId: "c1",
  relativePath: "docs/a.md",
  title: "a.md",
  kind: "markdown",
  ordinal: 0,
  snippet: "the «alpha» keyword here",
  score: -1,
  source: WORKSPACE_SOURCE,
  ...over,
});

function fakeClient(over: Partial<ServiceClient> = {}): ServiceClient {
  return {
    knowledgeLocalStatus: async () => view(),
    knowledgeLocalSync: async () => view({ status: "indexing", indexing: { processed: 0, total: null } }),
    knowledgeLocalCancel: async () => view({ status: "interrupted" }),
    knowledgeLocalClear: async () =>
      view({ status: "not_initialized", documentCount: 0, chunkCount: 0, nodeCount: 0, edgeCount: 0 }),
    knowledgeLocalSearch: async () => [],
    knowledgeLocalGraph: async () => ({ nodes: [], edges: [], truncated: false }),
    knowledgeLocalDocuments: async () => [],
    ...over,
  } as unknown as ServiceClient;
}

function noopCallbacks(over: Partial<Parameters<typeof mountKnowledgeLocalPanel>[2]> = {}) {
  return {
    onOpenSource: () => undefined,
    onAskCowork: () => undefined,
    onChooseWorkspace: () => undefined,
    ...over,
  };
}

// ---- product model: exactly two top-level tabs, no source tabs -------------------------------

test("Knowledge has exactly two top-level tabs (Kho tri thức | Đồ thị) and no source tabs", () => {
  const dom = createKnowledgeView();
  const tabs = [...dom.root.querySelectorAll<HTMLButtonElement>("[data-knowledge-tab]")];
  assert.deepEqual(
    tabs.map((b) => b.dataset["knowledgeTab"]),
    ["base", "graph"],
    "only the base + graph view tabs exist",
  );
  // The revised model forbids Workspace | Microsoft 365 SOURCE tabs.
  assert.equal(dom.root.querySelector("[data-knowledge-source]"), null, "no source-tab layer");
  const tabText = tabs.map((b) => b.textContent ?? "").join(" ");
  assert.doesNotMatch(tabText, /Microsoft 365/, "Microsoft 365 is not a tab");
});

test("no workspace → renders a Chọn Workspace primary action", async () => {
  const dom = createKnowledgeView();
  let chose = false;
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({ knowledgeLocalStatus: async () => view({ hasWorkspace: false, status: "not_initialized", documentCount: 0 }) }),
    noopCallbacks({ onChooseWorkspace: () => (chose = true) }),
  );
  panel.show("base");
  await flush();
  const btn = [...dom.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Chọn Workspace"));
  assert.ok(btn, "no-workspace state offers a workspace picker action");
  btn!.click();
  assert.equal(chose, true);
  panel.dispose();
});

test("not_initialized → offers Khởi tạo Knowledge which starts a sync", async () => {
  const dom = createKnowledgeView();
  let synced = false;
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({
      knowledgeLocalStatus: async () => view({ status: "not_initialized", documentCount: 0 }),
      knowledgeLocalSync: async () => {
        synced = true;
        return view({ status: "indexing", indexing: { processed: 0, total: null } });
      },
    }),
    noopCallbacks(),
  );
  panel.show("base");
  await flush();
  const init = [...dom.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Khởi tạo"));
  assert.ok(init, "not-initialized state offers an init action");
  init!.click();
  await flush();
  assert.equal(synced, true);
  panel.dispose();
});

// ---- document list + provenance --------------------------------------------------------------

test("ready → document list renders indexed docs with a source badge; selecting shows detail + provenance", async () => {
  const dom = createKnowledgeView();
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({
      knowledgeLocalDocuments: async () => [doc({ title: "a.md", relativePath: "docs/a.md" })],
    }),
    noopCallbacks(),
  );
  panel.show("base");
  await flush();
  await flush(); // documents load is a follow-up fetch

  const item = dom.body.querySelector(".klp-doc");
  assert.ok(item, "document list renders the indexed document");
  assert.ok(item!.querySelector(".klp-source--workspace"), "document carries a Workspace provenance badge");

  (item as HTMLButtonElement).click();
  await flush();
  const detail = dom.body.querySelector(".klp-detail");
  assert.ok(detail, "selecting a document shows its detail");
  assert.match(detail!.textContent ?? "", /Nguồn/, "detail shows a source line");
  assert.match(detail!.textContent ?? "", /docs\/a\.md/, "detail shows the safe relative path");
  panel.dispose();
});

test("ready → search renders hits with snippet highlight, provenance, and Mở nguồn + Hỏi Cowork handoffs", async () => {
  const dom = createKnowledgeView();
  let opened: string | null = null;
  let asked: string | null = null;
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({
      knowledgeLocalSearch: async (q: string) => (q.includes("alpha") ? [hit()] : []),
    }),
    noopCallbacks({ onOpenSource: (p) => (opened = p), onAskCowork: (p) => (asked = p) }),
  );
  panel.show("base");
  await flush();
  const input = dom.body.querySelector<HTMLInputElement>(".knowledge-search__input");
  assert.ok(input, "ready state shows a search box");
  assert.equal(input!.disabled, false);
  input!.value = "alpha";
  input!.dispatchEvent(new Event("input"));
  await flush(350); // debounce

  assert.match(dom.body.textContent ?? "", /docs\/a\.md/);
  assert.ok(dom.body.querySelector(".knowledge-hit__mark"), "matched term is highlighted");
  assert.ok(dom.body.querySelector(".klp-hit .klp-source--workspace"), "each hit shows its provenance badge");
  const open = [...dom.body.querySelectorAll("button")].find((b) => b.textContent === "Mở nguồn");
  const ask = [...dom.body.querySelectorAll("button")].find((b) => b.textContent === "Hỏi Cowork");
  open!.click();
  ask!.click();
  assert.equal(opened, "docs/a.md");
  assert.equal(asked, "docs/a.md");
  panel.dispose();
});

test("empty search → honest no-results message, no fabricated hits", async () => {
  const dom = createKnowledgeView();
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({ knowledgeLocalSearch: async () => [] }),
    noopCallbacks(),
  );
  panel.show("base");
  await flush();
  const input = dom.body.querySelector<HTMLInputElement>(".knowledge-search__input")!;
  input.value = "zzz-nothing";
  input.dispatchEvent(new Event("input"));
  await flush(350);
  assert.match(dom.body.textContent ?? "", /Không tìm thấy kết quả/);
  assert.equal(dom.body.querySelector(".klp-hit"), null, "no hit rows fabricated");
  panel.dispose();
});

// ---- source filter + honest Microsoft 365 readiness (no tab, no fake) ------------------------

test("source filter offers Workspace + a disabled Microsoft 365 option; MS365 readiness shows in the summary", async () => {
  const dom = createKnowledgeView();
  const panel = mountKnowledgeLocalPanel(dom, fakeClient({ knowledgeLocalDocuments: async () => [doc()] }), noopCallbacks());
  panel.show("base");
  await flush();
  await flush();

  const srcSel = dom.body.querySelector<HTMLSelectElement>(".klp-filter__select--source");
  assert.ok(srcSel, "a source filter select is present in the toolbar");
  const opts = [...srcSel!.options];
  assert.deepEqual(opts.map((o) => o.value), ["all", "workspace", "microsoft365"]);
  const ms = opts.find((o) => o.value === "microsoft365")!;
  assert.equal(ms.disabled, true, "Microsoft 365 has no data yet → disabled option (honest, not fake)");
  assert.match(ms.textContent ?? "", /Chưa kết nối/);

  // Compact source summary: Workspace has a count; Microsoft 365 reads "Chưa kết nối".
  const summary = dom.body.querySelector(".klp-status__sources");
  assert.ok(summary, "status bar shows a compact per-source summary");
  assert.match(summary!.textContent ?? "", /Microsoft 365/);
  assert.match(summary!.textContent ?? "", /Chưa kết nối/);

  // No fake "Run"/"Chạy" action for the dormant Microsoft 365 backend anywhere in the surface.
  const runBtn = [...dom.body.querySelectorAll("button")].find((b) => /(^|\b)(Run|Chạy)\b/i.test(b.textContent ?? ""));
  assert.equal(runBtn, undefined, "no fake Microsoft 365 Run action");
  panel.dispose();
});

test("panel never reaches the network / Microsoft 365 backend — only local knowledge routes are used", async () => {
  const dom = createKnowledgeView();
  const accessed = new Set<string>();
  const impls = fakeClient({
    knowledgeLocalSearch: async () => [hit()],
    knowledgeLocalDocuments: async () => [doc()],
    knowledgeLocalGraph: async () => ({
      nodes: [{ id: "ws", label: "ws", kind: "workspace", relativePath: null, source: WORKSPACE_SOURCE }],
      edges: [],
      truncated: false,
    }),
  });
  const recording = new Proxy(impls as Record<string, unknown>, {
    get(target, prop: string) {
      accessed.add(prop);
      return target[prop];
    },
  }) as unknown as ServiceClient;

  const panel = mountKnowledgeLocalPanel(dom, recording, noopCallbacks());
  panel.show("base");
  await flush();
  await flush();
  const input = dom.body.querySelector<HTMLInputElement>(".knowledge-search__input")!;
  input.value = "alpha";
  input.dispatchEvent(new Event("input"));
  await flush(350);
  panel.show("graph");
  await flush();
  await flush();

  for (const name of accessed) {
    assert.ok(
      name.startsWith("knowledgeLocal"),
      `panel only calls local-knowledge routes, but touched "${name}"`,
    );
  }
  panel.dispose();
});

// ---- safe destructive action -----------------------------------------------------------------

test("Xóa chỉ mục is destructive-behind-confirmation and only clears the index (workspace kept)", async () => {
  const dom = createKnowledgeView();
  let cleared = false;
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({
      knowledgeLocalClear: async () => {
        cleared = true;
        return view({ status: "not_initialized", documentCount: 0, chunkCount: 0, nodeCount: 0, edgeCount: 0 });
      },
    }),
    noopCallbacks(),
  );
  panel.show("base");
  await flush();

  // Open the More menu → the clear action must NOT fire immediately.
  const more = [...dom.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Thêm"));
  assert.ok(more, "ready state exposes a More menu");
  more!.click();
  const clearItem = [...dom.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Xóa chỉ mục"));
  assert.ok(clearItem, "More menu offers Xóa chỉ mục");
  clearItem!.click();
  assert.equal(cleared, false, "clicking the menu item only asks for confirmation");

  // Confirmation must state that source files are preserved.
  assert.match(dom.body.textContent ?? "", /File gốc được giữ nguyên/);
  const confirm = [...dom.body.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "") === "Xóa chỉ mục" && b.classList.contains("klp-btn--danger"),
  );
  assert.ok(confirm, "an explicit destructive confirm button is shown");
  confirm!.click();
  await flush();
  assert.equal(cleared, true, "confirming performs the clear");
  panel.dispose();
});

// ---- graph -----------------------------------------------------------------------------------

test("graph tab renders a real node/edge host and node selection shows provenance in the detail", async () => {
  const dom = createKnowledgeView();
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({
      knowledgeLocalGraph: async () => ({
        nodes: [
          { id: "ws", label: "workspace", kind: "workspace", relativePath: null, source: WORKSPACE_SOURCE },
          { id: "doc:a.md", label: "a.md", kind: "document", relativePath: "a.md", source: WORKSPACE_SOURCE },
        ],
        edges: [{ from: "ws", to: "doc:a.md", type: "contains" }],
        truncated: false,
      }),
    }),
    noopCallbacks(),
  );
  panel.show("graph");
  await flush();
  await flush(); // graph load is a follow-up fetch
  assert.ok(dom.body.querySelector(".knowledge-graph-host"), "graph tab renders the SVG host");
  const nodeEl = dom.body.querySelector<SVGGElement>("[data-node-id='doc:a.md']");
  assert.ok(nodeEl, "a real document node is rendered");

  nodeEl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();
  const aside = dom.body.querySelector(".klp-graph__aside");
  assert.match(aside!.textContent ?? "", /Nguồn/, "node detail shows source provenance");
  assert.ok(aside!.querySelector(".klp-source"), "node detail renders a source badge");
  panel.dispose();
});

test("empty graph → honest empty state, not a blank canvas", async () => {
  const dom = createKnowledgeView();
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({ knowledgeLocalGraph: async () => ({ nodes: [], edges: [], truncated: false }) }),
    noopCallbacks(),
  );
  panel.show("graph");
  await flush();
  await flush();
  assert.match(dom.body.textContent ?? "", /Chưa có đồ thị|Đang dựng đồ thị/);
  panel.dispose();
});

// ---- workspace isolation / no fake data ------------------------------------------------------

test("empty index → empty document state, no fabricated documents", async () => {
  const dom = createKnowledgeView();
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({
      knowledgeLocalStatus: async () => view({ status: "not_initialized", documentCount: 0, chunkCount: 0, nodeCount: 0, edgeCount: 0 }),
      knowledgeLocalDocuments: async () => [],
    }),
    noopCallbacks(),
  );
  panel.show("base");
  await flush();
  await flush();
  assert.equal(dom.body.querySelector(".klp-doc"), null, "no document rows fabricated for an empty index");
  assert.match(dom.body.textContent ?? "", /Chưa có tài liệu|Đồng bộ workspace/);
  panel.dispose();
});
