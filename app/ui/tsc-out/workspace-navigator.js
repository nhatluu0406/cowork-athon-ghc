/**
 * Minimal Workspace Navigator.
 *
 * Renderer-only tree state. Filesystem reads stay behind the typed service client.
 */
import { createProductIcon } from "./product-icons.js";
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function icon(name, label) {
    return createProductIcon(name, label);
}
function fileIconFor(entry) {
    if (entry.kind === "folder")
        return "folder";
    const ext = entry.extension?.toLowerCase();
    if (ext === ".md" || ext === ".json" || ext === ".yml" || ext === ".yaml" || ext === ".ts" || ext === ".tsx") {
        return "code";
    }
    return "file";
}
function matchesFilter(entry, filter) {
    return filter.length === 0 || entry.name.toLowerCase().includes(filter.toLowerCase());
}
export function mountWorkspaceNavigator(container, options) {
    const state = {
        rootName: "Workspace",
        entries: [],
        nodes: new Map(),
        filter: "",
        loading: false,
        error: null,
        selectedPath: null,
        truncated: false,
    };
    container.replaceChildren();
    const header = el("div", "workspace-nav__header");
    const title = el("div", "workspace-nav__title");
    title.append(icon("workspace"), el("span", "icon-label", "Workspace"));
    const refreshButton = el("button", "workspace-nav__refresh");
    refreshButton.type = "button";
    refreshButton.title = "Làm mới workspace";
    refreshButton.setAttribute("aria-label", "Làm mới workspace");
    refreshButton.append(icon("refresh", "Làm mới"));
    header.append(title, refreshButton);
    const rootLabel = el("div", "workspace-nav__root", "Chưa chọn workspace");
    const filter = el("input", "workspace-nav__filter");
    filter.type = "search";
    filter.placeholder = "Lọc tệp đã tải...";
    filter.setAttribute("aria-label", "Lọc tệp trong workspace đã tải");
    const body = el("div", "workspace-nav__body");
    container.append(header, rootLabel, filter, body);
    const renderEntries = (entries, parent, depth) => {
        for (const entry of entries.filter((item) => matchesFilter(item, state.filter))) {
            const node = state.nodes.get(entry.relativePath);
            const row = el("button", `workspace-tree__row workspace-tree__row--${entry.kind}`);
            row.type = "button";
            row.style.setProperty("--tree-depth", String(depth));
            row.title = entry.relativePath;
            if (state.selectedPath === entry.relativePath)
                row.classList.add("workspace-tree__row--selected");
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
                }
                else if (node.error !== null) {
                    group.append(el("p", "workspace-tree__state workspace-tree__state--error", node.error));
                }
                else if (node.children !== null && node.children.length > 0) {
                    renderEntries(node.children, group, depth + 1);
                }
                else {
                    group.append(el("p", "workspace-tree__state", "Thư mục trống."));
                }
                parent.append(group);
            }
        }
    };
    const render = () => {
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
    const refresh = async () => {
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
        }
        catch (error) {
            state.error = error instanceof Error ? error.message : "Không tải được workspace.";
        }
        finally {
            state.loading = false;
            render();
        }
    };
    const toggleFolder = async (entry) => {
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
        }
        catch (error) {
            node.error = error instanceof Error ? error.message : "Không tải được thư mục.";
        }
        finally {
            node.loading = false;
            render();
        }
    };
    refreshButton.addEventListener("click", () => {
        void refresh();
    });
    filter.addEventListener("input", () => {
        state.filter = filter.value.trim();
        render();
    });
    void refresh();
    return { refresh };
}
//# sourceMappingURL=workspace-navigator.js.map