/**
 * Minimal Workspace Navigator.
 *
 * Renderer-only tree state. Filesystem reads stay behind the typed service client.
 */

import type { ServiceClient, WorkspaceListEntry } from "./service-client.js";
import { createProductIcon } from "./product-icons.js";

interface WorkspaceNavigatorOptions {
  readonly client: ServiceClient;
  readonly getWorkspaceRoot: () => string | null;
  readonly onFileSelected: (relativePath: string) => void;
  readonly onChooseWorkspace?: () => void;
}

interface TreeNode {
  readonly entry: WorkspaceListEntry;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  children: readonly WorkspaceListEntry[] | null;
}

type FilterMode = "all" | "recent" | "changed";

interface NavigatorState {
  rootName: string;
  entries: readonly WorkspaceListEntry[];
  nodes: Map<string, TreeNode>;
  filter: string;
  filterMode: FilterMode;
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  truncated: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: Parameters<typeof createProductIcon>[0], label?: string): SVGSVGElement {
  return createProductIcon(name, label);
}

function fileIconFor(entry: WorkspaceListEntry): Parameters<typeof createProductIcon>[0] {
  if (entry.kind === "folder") return "folder";
  const ext = entry.extension?.toLowerCase();
  if (ext === ".md" || ext === ".json" || ext === ".yml" || ext === ".yaml" || ext === ".ts" || ext === ".tsx") {
    return "code";
  }
  return "file";
}

function matchesFilter(entry: WorkspaceListEntry, filter: string, mode: FilterMode): boolean {
  if (filter.length > 0 && !entry.name.toLowerCase().includes(filter.toLowerCase())) {
    return false;
  }
  if (mode === "all" || entry.kind === "folder") return true;
  if (entry.modifiedTime === undefined) return false;
  const modified = Date.parse(entry.modifiedTime);
  if (Number.isNaN(modified)) return true;
  const ageMs = Date.now() - modified;
  if (mode === "recent") return ageMs <= 7 * 24 * 60 * 60 * 1000;
  return ageMs <= 24 * 60 * 60 * 1000;
}

export interface WorkspaceNavigatorHandle {
  refresh(): Promise<void>;
  selectPath(relativePath: string): void;
}
export function mountWorkspaceNavigator(
  container: HTMLElement,
  options: WorkspaceNavigatorOptions,
): WorkspaceNavigatorHandle {
  const state: NavigatorState = {
    rootName: "Workspace",
    entries: [],
    nodes: new Map(),
    filter: "",
    filterMode: "all",
    loading: false,
    error: null,
    selectedPath: null,
    truncated: false,
  };

  container.replaceChildren();
  const header = el("div", "workspace-nav__header");
  const title = el("div", "workspace-nav__title");
  title.append(icon("workspace"), el("span", "icon-label", "Workspace"));
  const headerActions = el("div", "workspace-nav__actions");
  const chooseButton = el("button", "workspace-nav__choose") as HTMLButtonElement;
  chooseButton.type = "button";
  chooseButton.dataset["tooltip"] = "Mở thư mục workspace";
  chooseButton.setAttribute("aria-label", "Mở thư mục workspace");
  chooseButton.append(icon("folder-open", "Mở thư mục workspace"));
  chooseButton.addEventListener("click", () => options.onChooseWorkspace?.());
  const refreshButton = el("button", "workspace-nav__refresh") as HTMLButtonElement;
  refreshButton.type = "button";
  refreshButton.dataset["tooltip"] = "Làm mới workspace";
  refreshButton.setAttribute("aria-label", "Làm mới workspace");
  refreshButton.append(icon("refresh", "Làm mới"));
  headerActions.append(chooseButton, refreshButton);
  header.append(title, headerActions);

  const rootLabel = el("div", "workspace-nav__root", "Chưa chọn workspace");
  const search = el("input", "workspace-nav__filter") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Tìm tệp…";
  search.setAttribute("aria-label", "Tìm tệp trong workspace");
  const segments = el("div", "workspace-filter-segments");
  segments.setAttribute("role", "group");
  segments.setAttribute("aria-label", "Bộ lọc workspace");
  const segmentButtons = new Map<FilterMode, HTMLButtonElement>();
  for (const [label, mode] of [
    ["Tất cả", "all"],
    ["Gần đây", "recent"],
    ["Đã đổi", "changed"],
  ] as const) {
    const btn = el("button", "workspace-filter-segments__btn", label) as HTMLButtonElement;
    btn.type = "button";
    btn.dataset["filterMode"] = mode;
    btn.setAttribute("aria-pressed", mode === "all" ? "true" : "false");
    segments.append(btn);
    segmentButtons.set(mode, btn);
  }
  const body = el("div", "workspace-nav__body");
  container.append(header, rootLabel, search, segments, body);

  const renderEntries = (
    entries: readonly WorkspaceListEntry[],
    parent: HTMLElement,
    depth: number,
  ): void => {
    for (const entry of entries.filter((item) => matchesFilter(item, state.filter, state.filterMode))) {
      const node = state.nodes.get(entry.relativePath);
      const row = el("button", `workspace-tree__row workspace-tree__row--${entry.kind}`) as HTMLButtonElement;
      row.type = "button";
      row.style.setProperty("--tree-depth", String(depth));
      row.title = entry.relativePath;
      if (state.selectedPath === entry.relativePath) row.classList.add("workspace-tree__row--selected");
      const disclosure = el("span", "workspace-tree__disclosure");
      if (entry.kind === "folder") {
        disclosure.append(icon(node?.expanded === true ? "collapse" : "expand"));
      }
      row.append(disclosure, icon(fileIconFor(entry)), el("span", "workspace-tree__name", entry.name));
      if (entry.kind === "file" && entry.sizeBytes !== undefined) {
        row.append(el("span", "workspace-tree__meta", `${entry.sizeBytes} B`));
      }
      row.addEventListener("click", () => {
        if (entry.kind === "folder") {
          void toggleFolder(entry);
          return;
        }
        state.selectedPath = entry.relativePath;
        options.onFileSelected(entry.relativePath);
        render();
      });
      parent.append(row);

      if (entry.kind === "folder" && node?.expanded === true) {
        const group = el("div", "workspace-tree__group");
        if (node.loading) {
          group.append(el("p", "workspace-tree__state", "Đang tải..."));
        } else if (node.error !== null) {
          group.append(el("p", "workspace-tree__state workspace-tree__state--error", node.error));
        } else if (node.children !== null && node.children.length > 0) {
          renderEntries(node.children, group, depth + 1);
        } else {
          group.append(el("p", "workspace-tree__state", "Thư mục trống."));
        }
        parent.append(group);
      }
    }
  };

  const render = (): void => {
    const workspaceRoot = options.getWorkspaceRoot();
    rootLabel.textContent = workspaceRoot === null ? "Chưa chọn workspace" : state.rootName;
    rootLabel.title = workspaceRoot ?? "";
    body.replaceChildren();
    if (workspaceRoot === null) {
      body.append(el("p", "workspace-tree__state", "Chọn workspace để xem tệp."));
      return;
    }
    if (state.loading) {
      body.append(el("p", "workspace-tree__state", "Đang tải workspace..."));
      return;
    }
    if (state.error !== null) {
      body.append(el("p", "workspace-tree__state workspace-tree__state--error", state.error));
      return;
    }
    if (state.entries.length === 0) {
      body.append(el("p", "workspace-tree__state", "Workspace trống hoặc chưa có tệp đã tải."));
      return;
    }
    const tree = el("div", "workspace-tree");
    renderEntries(state.entries, tree, 0);
    body.append(tree);
    if (state.truncated) {
      body.append(el("p", "workspace-tree__state", `Đang hiển thị ${state.entries.length} mục đầu tiên.`));
    }
  };

  const refresh = async (): Promise<void> => {
    if (options.getWorkspaceRoot() === null) {
      state.entries = [];
      state.nodes.clear();
      state.error = null;
      state.selectedPath = null;
      render();
      return;
    }
    state.loading = true;
    state.error = null;
    render();
    try {
      const result = await options.client.listWorkspaceChildren("");
      state.rootName = result.rootName;
      state.entries = result.entries;
      state.nodes = new Map(result.entries.map((entry) => [entry.relativePath, {
        entry,
        expanded: false,
        loading: false,
        error: null,
        children: null,
      }]));
      state.truncated = result.truncated;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Không tải được workspace.";
    } finally {
      state.loading = false;
      render();
    }
  };

  const toggleFolder = async (entry: WorkspaceListEntry): Promise<void> => {
    let node = state.nodes.get(entry.relativePath);
    if (node === undefined) {
      node = { entry, expanded: false, loading: false, error: null, children: null };
      state.nodes.set(entry.relativePath, node);
    }
    node.expanded = !node.expanded;
    if (!node.expanded || node.children !== null) {
      render();
      return;
    }
    node.loading = true;
    render();
    try {
      const result = await options.client.listWorkspaceChildren(entry.relativePath);
      node.children = result.entries;
      for (const child of result.entries) {
        if (!state.nodes.has(child.relativePath)) {
          state.nodes.set(child.relativePath, {
            entry: child,
            expanded: false,
            loading: false,
            error: null,
            children: null,
          });
        }
      }
      node.error = null;
    } catch (error) {
      node.error = error instanceof Error ? error.message : "Không tải được thư mục.";
    } finally {
      node.loading = false;
      render();
    }
  };

  const selectPath = (relativePath: string): void => {
    state.selectedPath = relativePath;
    render();
  };

  refreshButton.addEventListener("click", () => {
    void refresh();
  });
  search.addEventListener("input", () => {
    state.filter = search.value.trim();
    render();
  });
  for (const [mode, btn] of segmentButtons) {
    btn.addEventListener("click", () => {
      state.filterMode = mode;
      for (const [m, b] of segmentButtons) {
        b.setAttribute("aria-pressed", m === mode ? "true" : "false");
      }
      render();
    });
    btn.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const modes: FilterMode[] = ["all", "recent", "changed"];
      const idx = modes.indexOf(mode);
      if (event.key === "ArrowRight" && idx < modes.length - 1) {
        segmentButtons.get(modes[idx + 1]!)?.focus();
      }
      if (event.key === "ArrowLeft" && idx > 0) {
        segmentButtons.get(modes[idx - 1]!)?.focus();
      }
    });
  }

  void refresh();
  return { refresh, selectPath };
}
