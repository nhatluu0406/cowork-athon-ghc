import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKnowledgeView } from "../src/ui-shell/knowledge-view.js";
import { mountKnowledgeLocalPanel } from "../src/knowledge-local-panel.js";
import type { ServiceClient } from "../src/service-client.js";
import type { KnowledgeIndexView } from "@cowork-ghc/service/knowledge-local/types";

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

const view = (over: Partial<KnowledgeIndexView> = {}): KnowledgeIndexView => ({
  status: "ready",
  hasWorkspace: true,
  documentCount: 3,
  chunkCount: 9,
  nodeCount: 4,
  edgeCount: 3,
  lastIndexedAt: "2026-07-18T00:00:00.000Z",
  error: null,
  indexing: null,
  ...over,
});

function fakeClient(over: Partial<ServiceClient> = {}): ServiceClient {
  return {
    knowledgeLocalStatus: async () => view(),
    knowledgeLocalSync: async () => view({ status: "indexing", indexing: { processed: 0, total: null } }),
    knowledgeLocalCancel: async () => view({ status: "interrupted" }),
    knowledgeLocalClear: async () => view({ status: "not_initialized", documentCount: 0, chunkCount: 0, nodeCount: 0, edgeCount: 0 }),
    knowledgeLocalSearch: async () => [],
    knowledgeLocalGraph: async () => ({ nodes: [], edges: [], truncated: false }),
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

test("ready → search renders hits with Mở nguồn + Hỏi Cowork handoffs", async () => {
  const dom = createKnowledgeView();
  let opened: string | null = null;
  let asked: string | null = null;
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({
      knowledgeLocalSearch: async (q: string) =>
        q.includes("alpha")
          ? [
              {
                documentId: "d1",
                chunkId: "c1",
                relativePath: "docs/a.md",
                title: "a.md",
                kind: "markdown",
                ordinal: 0,
                snippet: "the «alpha» keyword here",
                score: -1,
              },
            ]
          : [],
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
  const open = [...dom.body.querySelectorAll("button")].find((b) => b.textContent === "Mở nguồn");
  const ask = [...dom.body.querySelectorAll("button")].find((b) => b.textContent === "Hỏi Cowork");
  open!.click();
  ask!.click();
  assert.equal(opened, "docs/a.md");
  assert.equal(asked, "docs/a.md");
  panel.dispose();
});

test("graph tab renders a graph host when nodes exist", async () => {
  const dom = createKnowledgeView();
  const panel = mountKnowledgeLocalPanel(
    dom,
    fakeClient({
      knowledgeLocalGraph: async () => ({
        nodes: [
          { id: "ws", label: "ws", kind: "workspace", relativePath: null },
          { id: "doc:a.md", label: "a.md", kind: "document", relativePath: "a.md" },
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
  panel.dispose();
});
