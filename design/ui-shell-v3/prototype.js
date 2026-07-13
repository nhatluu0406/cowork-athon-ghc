/**
 * Cowork GHC UI Shell V3 R2 — design prototype only.
 * Visibility invariants + screenshot validation harness.
 */

const ICONS = {
  cowork: '<path d="M5 12a7 7 0 0 1 14 0v4a2 2 0 0 1-2 2h-2.5l-1.5 1.5-1.5-1.5H7a2 2 0 0 1-2-2v-4"/><path d="M9 11h6M9 15h4"/>',
  dispatch: '<rect x="4" y="5" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/><path d="M10 8h4M10 17h4"/>',
  gateway: '<path d="M4 7h16M4 17h16"/><path d="M8 7v10M16 7v10M7 12h10"/>',
  knowledge: '<path d="M6 5h9a3 3 0 0 1 3 3v11H8a2 2 0 0 1-2-2V5Z"/><path d="M9 8h6M9 12h5"/>',
  "knowledge-graph": '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="17" r="2"/><path d="M8 8l3 7M16 8l-3 7"/>',
  microsoft: '<rect x="5" y="5" width="6" height="6"/><rect x="13" y="5" width="6" height="6"/><rect x="5" y="13" width="6" height="6"/><rect x="13" y="13" width="6" height="6"/>',
  code: '<path d="M9 7 5 12l4 5M15 7l4 5-4 5"/><path d="M13 5l-2 14"/>',
  "square-pen": '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414L12 14.414 9.586 12z"/>',
  "play-circle": '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
  "panel-left-close": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m14 10-2 2 2 2"/>',
  "panel-left-open": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m12 10 2 2-2 2"/>',
  "panel-right-open": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="m11 10 2 2-2 2"/>',
  "panel-right-close": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="m13 10-2 2 2 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a6 6 0 0 0-10-3L4 10M6 15a6 6 0 0 0 10 3l4-4"/>',
  attach: '<path d="M8 12l5.5-5.5a3 3 0 1 1 4.2 4.2L10.5 17.5a4 4 0 1 1-5.6-5.6l7-7"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6"/><path d="M12 7h.01"/>',
  more: '<circle cx="12" cy="6" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18" r="1.2"/>',
  folder: '<path d="M4 7h6l2 2h8v9H4V7Z"/>',
  file: '<path d="M7 4h7l4 4v12H7V4Z"/><path d="M14 4v5h5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

const SURFACES = [
  { id: "cowork", label: "Cowork", icon: "cowork", view: "cowork" },
  { id: "dispatch", label: "Dispatch", icon: "dispatch", awaiting: "D1", view: "integration" },
  { id: "gateway", label: "Gateway", icon: "gateway", awaiting: "D4", view: "integration" },
  { id: "knowledge", label: "Knowledge", icon: "knowledge", awaiting: "D3", view: "integration" },
  { id: "knowledge-graph", label: "Knowledge Graph", icon: "knowledge-graph", awaiting: "D3", view: "integration" },
  { id: "microsoft", label: "Microsoft 365", icon: "microsoft", awaiting: "D2", view: "integration" },
  { id: "code", label: "Code", icon: "code", awaiting: "planned", view: "integration" },
];

const CONVERSATIONS = [
  { id: "c1", title: "Chuẩn bị tài liệu tích hợp", meta: "Hôm nay · 12 tin" },
  { id: "c2", title: "Rà soát permission flow", meta: "Hôm qua · 8 tin" },
  { id: "c3", title: "Fixture workspace audit", meta: "3 ngày trước · 5 tin" },
];

const FILE_TREE = [
  { type: "folder", name: "src", depth: 0, path: "src" },
  { type: "file", name: "README.md", depth: 1, path: "src/README.md" },
  { type: "file", name: "app-shell-notes.md", depth: 1, path: "src/app-shell-notes.md" },
  { type: "folder", name: "docs", depth: 0, path: "docs" },
  { type: "file", name: "integration-readiness.md", depth: 1, path: "docs/integration-readiness.md" },
];

const FILE_CONTENT = {
  "src/README.md": "# README (prototype fixture)\n\nShell V3 R2: visibility invariants enforced.\n\nKhông phải production build.",
};

const TRANSCRIPT = [
  { role: "Bạn", user: true, text: "Tóm tắt checklist intake cho team D4." },
  { role: "Cowork", user: false, text: "Checklist gồm: track ID, commit hash, contract API, credential model, feature flag OFF, demo journey không backend thật." },
  { role: "Bạn", user: true, text: "Nhắc lại ranh giới keyring và permission." },
  { role: "Cowork", user: false, text: "Keyring chỉ ở service; permission modal không bypass bởi child task hay connector." },
];

const INTEGRATION_COPY = {
  dispatch: { title: "Dispatch", dep: "D1", copy: "Fan-out agent sẽ xuất hiện sau khi track D1 được tích hợp." },
  gateway: { title: "Gateway", dep: "D4", copy: "Gateway đa profile và failover sẽ kết nối sau intake D4." },
  knowledge: { title: "Knowledge", dep: "D3", copy: "RAG và retrieval có provenance sẽ bật khi backend D3 sẵn sàng." },
  "knowledge-graph": { title: "Knowledge Graph", dep: "D3", copy: "Graph explorer chỉ hiển thị dữ liệu thật sau tích hợp D3." },
  microsoft: { title: "Microsoft 365", dep: "D2", copy: "Graph connector sẽ thay thế trạng thái chờ này." },
  code: { title: "Code", dep: "planned", copy: "Surface Code được lên kế hoạch; chưa có backend." },
};

const STATES = [
  { id: "cowork-active", label: "Cowork active (DeepSeek)" },
  { id: "sidebar-cowork", label: "Sidebar Cowork tab" },
  { id: "sidebar-workspace", label: "Sidebar Workspace tab" },
  { id: "file-document", label: "File document tab" },
  { id: "cowork-inspector-open", label: "Inspector open" },
  { id: "gateway", label: "Gateway awaiting D4" },
  { id: "knowledge-graph", label: "Knowledge Graph awaiting D3" },
  { id: "provider-missing", label: "Provider missing" },
  { id: "waiting-permission", label: "Waiting permission" },
];

const SEQUENTIAL_TRANSITION_STATES = [
  "file-document",
  "gateway",
  "cowork-active",
  "provider-missing",
  "knowledge-graph",
];

const COWORK_CONVERSATION_STATES = new Set([
  "cowork-active",
  "sidebar-cowork",
  "cowork-inspector-open",
  "provider-missing",
  "waiting-permission",
]);

const INTEGRATION_STATES = new Set(["gateway", "knowledge-graph", "dispatch", "knowledge", "microsoft", "code"]);

const appState = {
  surface: "cowork",
  sidebarTab: "cowork",
  activeDoc: "conversation",
  openFiles: [],
  inspectorOpen: false,
  inspectorTab: "plan",
  sidebarHidden: false,
  drawer: "",
  provider: "configured",
  runtime: "idle",
};

let focusTrapHandler = null;

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.file}</svg>`;
}

function mountIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon);
}

function isNarrow() { return window.innerWidth <= 900; }
function isInspectorOverlay() { return window.innerWidth <= 1366; }

function isElementVisible(el) {
  if (!el || el.hidden) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function visibleViews() {
  return [...document.querySelectorAll(".view")]
    .filter(isElementVisible)
    .map((el) => el.dataset.view);
}

function visibleSidebarPanels() {
  return [...document.querySelectorAll(".sidebar__panel")]
    .filter(isElementVisible)
    .map((el) => el.dataset.sidebarTab);
}

function visibleDocPanels() {
  const panels = [];
  if (isElementVisible(document.getElementById("doc-conversation"))) panels.push("conversation");
  if (isElementVisible(document.getElementById("doc-file"))) panels.push("file");
  return panels;
}

function isSidebarVisible() {
  const sidebar = document.getElementById("sidebar");
  return isElementVisible(sidebar);
}

function isInspectorVisible() {
  const inspector = document.getElementById("inspector");
  return isElementVisible(inspector);
}

function hasHorizontalOverflow() {
  return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
}

function collectVisualState(stateId = document.getElementById("app").dataset.state) {
  return {
    state: stateId,
    visibleViews: visibleViews(),
    visibleSidebarPanels: visibleSidebarPanels(),
    visibleDocPanels: visibleDocPanels(),
    sidebarVisible: isSidebarVisible(),
    inspectorVisible: isInspectorVisible(),
    horizontalOverflow: hasHorizontalOverflow(),
    surface: appState.surface,
    sidebarTab: appState.sidebarTab,
    activeDoc: appState.activeDoc,
    openFiles: [...appState.openFiles],
    inspectorOpen: appState.inspectorOpen,
    provider: appState.provider,
    runtime: appState.runtime,
  };
}

function fail(errors, message) {
  errors.push(message);
}

function assertCoworkConversation(errors, snapshot, expectInspector = false) {
  if (snapshot.visibleViews.length !== 1) fail(errors, `expected 1 visible .view, got ${snapshot.visibleViews.length}: ${snapshot.visibleViews.join(", ")}`);
  else if (snapshot.visibleViews[0] !== "cowork") fail(errors, `expected visible view cowork, got ${snapshot.visibleViews[0]}`);
  if (snapshot.visibleSidebarPanels.length !== 1) fail(errors, `expected 1 visible sidebar panel, got ${snapshot.visibleSidebarPanels.length}`);
  if (snapshot.visibleDocPanels.length !== 1) fail(errors, `expected 1 visible doc panel, got ${snapshot.visibleDocPanels.length}: ${snapshot.visibleDocPanels.join(", ")}`);
  else if (snapshot.visibleDocPanels[0] !== "conversation") fail(errors, `expected conversation doc panel, got ${snapshot.visibleDocPanels[0]}`);
  if (isElementVisible(document.querySelector('.view[data-view="integration"]'))) fail(errors, "integration view must be hidden");
  if (isElementVisible(document.getElementById("doc-file"))) fail(errors, "file document must be hidden");
  if (!isElementVisible(document.getElementById("transcript"))) fail(errors, "transcript must be visible");
  if (!isElementVisible(document.querySelector(".composer"))) fail(errors, "composer must be visible");
  if (expectInspector) {
    if (!snapshot.inspectorVisible) fail(errors, "inspector must be visible");
  } else if (snapshot.inspectorVisible) {
    fail(errors, "inspector must be hidden");
  }
}

function assertFileDocument(errors, snapshot) {
  if (snapshot.visibleViews.length !== 1 || snapshot.visibleViews[0] !== "cowork") fail(errors, "file document requires single cowork view");
  if (snapshot.visibleDocPanels.length !== 1 || snapshot.visibleDocPanels[0] !== "file") {
    fail(errors, `expected file doc panel only, got ${snapshot.visibleDocPanels.join(", ")}`);
  }
  if (isElementVisible(document.getElementById("doc-conversation"))) fail(errors, "conversation panel must be hidden");
  if (isElementVisible(document.getElementById("transcript"))) fail(errors, "transcript must be hidden");
  if (isElementVisible(document.querySelector(".composer"))) fail(errors, "composer must be hidden");
  if (isElementVisible(document.getElementById("banner-permission"))) fail(errors, "permission banner must be hidden in file document");
  if (isElementVisible(document.getElementById("banner-recovery"))) fail(errors, "recovery banner must be hidden in file document");
}

function assertIntegration(errors, snapshot) {
  if (snapshot.visibleViews.length !== 1 || snapshot.visibleViews[0] !== "integration") {
    fail(errors, `expected integration view only, got ${snapshot.visibleViews.join(", ")}`);
  }
  if (snapshot.sidebarVisible) fail(errors, "sidebar must be hidden on integration surface");
  if (snapshot.visibleSidebarPanels.length) fail(errors, "no sidebar panel may be visible on integration surface");
  if (snapshot.visibleDocPanels.length) fail(errors, "no doc panel may be visible on integration surface");
  if (isElementVisible(document.querySelector(".view[data-view='cowork']"))) fail(errors, "cowork view must be hidden");
  if (isElementVisible(document.getElementById("doc-tabs"))) fail(errors, "document tabs must be hidden");
  if (isElementVisible(document.querySelector(".conv-header"))) fail(errors, "conversation header must be hidden");
  if (isElementVisible(document.getElementById("banner-permission"))) fail(errors, "permission banner must be hidden");
  if (isElementVisible(document.getElementById("banner-recovery"))) fail(errors, "recovery banner must be hidden");
  if (isElementVisible(document.querySelector(".composer"))) fail(errors, "composer must be hidden");
  if (snapshot.inspectorVisible) fail(errors, "inspector must be hidden on integration surface");
}

function assertSidebarTab(errors, snapshot, tab) {
  if (snapshot.visibleSidebarPanels.length !== 1 || snapshot.visibleSidebarPanels[0] !== tab) {
    fail(errors, `expected sidebar panel ${tab}, got ${snapshot.visibleSidebarPanels.join(", ")}`);
  }
  const other = tab === "cowork" ? "workspace" : "cowork";
  const otherPanel = document.querySelector(`.sidebar__panel[data-sidebar-tab="${other}"]`);
  if (isElementVisible(otherPanel)) fail(errors, `${other} sidebar panel must be hidden when ${tab} is active`);
}

function assertVisualState(stateId) {
  const snapshot = collectVisualState(stateId);
  const errors = [];

  if (INTEGRATION_STATES.has(stateId)) {
    assertIntegration(errors, snapshot);
  } else if (stateId === "file-document") {
    assertFileDocument(errors, snapshot);
    assertSidebarTab(errors, snapshot, "workspace");
  } else if (stateId === "sidebar-workspace") {
    assertCoworkConversation(errors, snapshot, false);
    assertSidebarTab(errors, snapshot, "workspace");
  } else if (stateId === "sidebar-cowork" || COWORK_CONVERSATION_STATES.has(stateId)) {
    assertCoworkConversation(errors, snapshot, stateId === "cowork-inspector-open");
    if (stateId === "sidebar-cowork") assertSidebarTab(errors, snapshot, "cowork");
  }

  if (stateId === "provider-missing" && appState.provider !== "missing") {
    fail(errors, "provider fixture must be missing");
  }
  if (stateId === "waiting-permission" && appState.runtime !== "permission") {
    fail(errors, "runtime fixture must be permission");
  }
  if (stateId === "waiting-permission" && !isElementVisible(document.getElementById("banner-permission"))) {
    fail(errors, "permission banner must be visible");
  }
  if (stateId === "provider-missing" && isElementVisible(document.getElementById("banner-recovery"))) {
    fail(errors, "recovery banner must not show for missing provider");
  }

  if (isNarrow()) {
    if (appState.drawer === "sidebar" && appState.drawer === "inspector") {
      fail(errors, "only one drawer may be open at 900px");
    }
    if (hasHorizontalOverflow()) fail(errors, "horizontal overflow at narrow viewport");
  }

  return { ...snapshot, passed: errors.length === 0, errors };
}

async function waitForStableFrames(count = 2) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

async function applyStateAndSettle(stateId) {
  applyState(stateId);
  await waitForStableFrames(2);
  return assertVisualState(stateId);
}

function runSequentialTransitionTest() {
  const results = [];
  for (const stateId of SEQUENTIAL_TRANSITION_STATES) {
    applyState(stateId);
    const check = assertVisualState(stateId);
    results.push(check);
    if (!check.passed) return { passed: false, results, failedAt: stateId };
  }
  return { passed: true, results, failedAt: null };
}

function resetApplicationState() {
  appState.surface = "cowork";
  appState.sidebarTab = "cowork";
  appState.activeDoc = "conversation";
  appState.openFiles = [];
  appState.inspectorOpen = false;
  appState.inspectorTab = "plan";
  appState.sidebarHidden = false;
  appState.drawer = "";
  appState.provider = "configured";
  appState.runtime = "idle";

  document.documentElement.style.width = "";
  document.documentElement.style.removeProperty("width");
  document.body.style.width = "";
  document.body.style.removeProperty("width");

  document.getElementById("banner-permission").hidden = true;
  document.getElementById("banner-recovery").hidden = true;
  document.getElementById("topbar-context").hidden = true;
  document.getElementById("topbar-context").textContent = "";
  document.getElementById("drawer-scrim").hidden = true;

  document.getElementById("main").scrollTop = 0;
  const transcript = document.getElementById("transcript");
  if (transcript) transcript.scrollTop = 0;

  releaseFocusTrap();
  selectInspectorTab("plan");
  setSidebarTab("cowork");
  setActiveDoc("conversation");
  renderDocTabs();
}

function renderRail() {
  const host = document.getElementById("rail-items");
  host.replaceChildren();
  for (const s of SURFACES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rail__btn${s.awaiting ? " rail__btn--awaiting" : ""}`;
    const tip = s.awaiting ? `${s.label} — Chờ tích hợp ${s.awaiting}` : s.label;
    btn.dataset.tooltip = tip;
    btn.setAttribute("aria-label", tip);
    if (s.id === appState.surface) btn.setAttribute("aria-current", "page");
    btn.innerHTML = `<span class="icon">${icon(s.icon)}</span>`;
    btn.addEventListener("click", () => activateSurface(s.id));
    host.append(btn);
  }
}

function setSidebarTab(tab) {
  appState.sidebarTab = tab;
  for (const btn of document.querySelectorAll(".sidebar-tabs__btn")) {
    const active = btn.dataset.sidebarTab === tab;
    btn.classList.toggle("sidebar-tabs__btn--active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const panel of document.querySelectorAll(".sidebar__panel")) {
    panel.hidden = panel.dataset.sidebarTab !== tab;
  }
}

function renderConversations() {
  const list = document.getElementById("conv-list");
  list.replaceChildren();
  for (const c of CONVERSATIONS) {
    const li = document.createElement("li");
    li.className = `conv-item${c.id === "c1" ? " conv-item--active" : ""}`;
    li.innerHTML = `<span class="conv-item__title">${c.title}</span>
      <button type="button" class="icon-btn icon-btn--sm" data-tooltip="Thêm hành động" aria-label="Thêm hành động cho ${c.title}">
        <span class="icon" data-icon="more"></span></button>
      <span class="conv-item__meta">${c.meta}</span>`;
    list.append(li);
  }
  mountIcons(list);
}

function renderTree(activePath = "src/README.md") {
  const tree = document.getElementById("file-tree");
  tree.replaceChildren();
  for (const row of FILE_TREE) {
    const div = document.createElement("div");
    div.className = `tree__row${row.path === activePath ? " tree__row--active" : ""}`;
    div.style.paddingLeft = `${8 + row.depth * 14}px`;
    div.innerHTML = `<span class="tree__indent"></span>
      <span class="icon icon--muted" data-icon="${row.type === "folder" ? "folder" : "file"}"></span><span>${row.name}</span>`;
    if (row.type === "file") div.addEventListener("click", () => openFileDocument(row.path, row.name));
    tree.append(div);
  }
  mountIcons(tree);
}

function renderDocTabs() {
  const host = document.getElementById("doc-tabs");
  host.replaceChildren();
  const convTab = document.createElement("button");
  convTab.type = "button";
  convTab.className = `doc-tab${appState.activeDoc === "conversation" ? " doc-tab--active" : ""}`;
  convTab.setAttribute("role", "tab");
  convTab.setAttribute("aria-selected", appState.activeDoc === "conversation" ? "true" : "false");
  convTab.textContent = "Cuộc trò chuyện";
  convTab.addEventListener("click", () => setActiveDoc("conversation"));
  host.append(convTab);
  for (const f of appState.openFiles) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `doc-tab${appState.activeDoc === f.path ? " doc-tab--active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", appState.activeDoc === f.path ? "true" : "false");
    tab.innerHTML = `<span>${f.name}</span><span class="doc-tab__close icon" data-icon="close" role="button" aria-label="Đóng ${f.name}"></span>`;
    tab.querySelector(".doc-tab__close").addEventListener("click", (e) => { e.stopPropagation(); closeFileDocument(f.path); });
    tab.addEventListener("click", () => setActiveDoc(f.path));
    host.append(tab);
  }
  mountIcons(host);
}

function updateFileBreadcrumb(docId) {
  const parts = docId.split("/");
  const name = parts.pop() ?? docId;
  const prefix = parts.length ? `${parts.join(" / ")} / ${name}` : name;
  document.getElementById("file-breadcrumb-path").textContent = prefix;
}

function setActiveDoc(docId) {
  appState.activeDoc = docId;
  const isConv = docId === "conversation";
  document.getElementById("doc-conversation").hidden = !isConv;
  document.getElementById("doc-file").hidden = isConv;
  document.getElementById("topbar-context").hidden = true;
  document.getElementById("topbar-context").textContent = "";
  renderDocTabs();
  if (!isConv) {
    document.getElementById("file-body").textContent = FILE_CONTENT[docId] ?? "(prototype fixture)";
    updateFileBreadcrumb(docId);
    selectInspectorTab("files");
  }
}

function openFileDocument(path, name) {
  if (!appState.openFiles.some((f) => f.path === path)) appState.openFiles.push({ path, name });
  setActiveDoc(path);
  renderTree(path);
}

function closeFileDocument(path) {
  appState.openFiles = appState.openFiles.filter((f) => f.path !== path);
  if (appState.activeDoc === path) setActiveDoc("conversation");
  else renderDocTabs();
  renderTree(appState.openFiles.at(-1)?.path);
}

function renderTranscript() {
  const inner = document.createElement("div");
  inner.className = "transcript__inner";
  for (const m of TRANSCRIPT) {
    const div = document.createElement("div");
    div.className = `msg${m.user ? " msg--user" : ""}`;
    div.innerHTML = `<div class="msg__role">${m.role}</div><div class="msg__body">${m.text}</div>`;
    inner.append(div);
  }
  document.getElementById("transcript").replaceChildren(inner);
}

function selectInspectorTab(tab) {
  appState.inspectorTab = tab;
  for (const btn of document.querySelectorAll(".inspector__tab")) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("inspector__tab--active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  const body = document.getElementById("inspector-body");
  body.replaceChildren();
  const panel = document.createElement("div");
  panel.className = "inspector-panel";
  if (tab === "plan") {
    const ol = document.createElement("ol");
    ol.style.cssText = "margin:0;padding-left:18px";
    for (const s of ["Thu thập intake D4", "Kiểm tra contract gateway", "Focused test integration/d4-gateway"]) {
      const li = document.createElement("li");
      li.className = "inspector-panel__line";
      li.textContent = s;
      ol.append(li);
    }
    panel.append(ol);
  } else if (tab === "activity") {
    panel.innerHTML = `<p class="inspector-panel__line"><strong>Soạn prototype V3 R2</strong> — visibility fix</p>
      <p class="inspector-panel__line"><strong>Chờ merge D4</strong> — đang chờ</p>`;
  } else if (tab === "files") {
    const pth = appState.activeDoc !== "conversation" ? appState.activeDoc : "docs/integration/external-systems-integration-readiness.md";
    panel.innerHTML = `<p class="inspector-panel__line"><code>${pth}</code></p>`;
  } else {
    const pth = appState.activeDoc !== "conversation" ? appState.activeDoc : "design/ui-shell-v3/styles.css";
    panel.innerHTML = `<p class="inspector-panel__line"><strong>${pth}</strong><br>Prototype fixture — bounded diff khi có backend.</p>`;
  }
  body.append(panel);
}

function renderIntegration(surfaceId) {
  const copy = INTEGRATION_COPY[surfaceId] ?? INTEGRATION_COPY.gateway;
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[2];
  const host = document.getElementById("integration-empty");
  host.innerHTML = `<div class="integration-empty__icon icon" data-icon="${surface.icon}"></div>
    <h1 class="integration-empty__title">${copy.title}</h1>
    <p class="integration-empty__copy">${copy.copy}</p>
    <span class="integration-empty__badge">Chờ tích hợp ${copy.dep}</span>`;
  mountIcons(host);
}

function setMainView(view, surfaceId = "cowork") {
  const coworkView = document.querySelector('.view[data-view="cowork"]');
  const integrationView = document.querySelector('.view[data-view="integration"]');
  const shell = document.getElementById("shell");
  const sidebar = document.getElementById("sidebar");
  const inspector = document.getElementById("inspector");
  const btnInspector = document.getElementById("btn-inspector");

  coworkView.hidden = view !== "cowork";
  integrationView.hidden = view !== "integration";

  if (view === "integration") {
    shell.classList.add("shell--integration");
    sidebar.hidden = true;
    btnInspector.hidden = true;
    appState.inspectorOpen = false;
    appState.drawer = "";
    renderIntegration(surfaceId);
  } else {
    shell.classList.remove("shell--integration");
    sidebar.hidden = false;
    btnInspector.hidden = false;
  }
  syncChrome();
}

function updateStatusBar() {
  const providerBtn = document.getElementById("status-provider");
  const runtimeEl = document.getElementById("status-runtime");
  providerBtn.classList.remove("statusbar__item--warn", "statusbar__item--pulse");
  if (appState.provider === "missing") {
    providerBtn.querySelector(".statusbar__value").textContent = "Provider · Chưa cấu hình";
    providerBtn.dataset.tooltip = "Provider: Chưa cấu hình — nhấn để mở cài đặt";
    providerBtn.querySelector(".status-dot").className = "status-dot status-dot--warn";
    providerBtn.classList.add("statusbar__item--warn", "statusbar__item--pulse");
  } else {
    providerBtn.querySelector(".statusbar__value").textContent = "DeepSeek · Sẵn sàng";
    providerBtn.dataset.tooltip = "DeepSeek: Sẵn sàng";
    providerBtn.querySelector(".status-dot").className = "status-dot status-dot--ok";
  }
  const rtMap = { idle: "Nhàn rỗi", starting: "Đang khởi động", running: "Đang chạy", permission: "Chờ quyền", error: "Lỗi" };
  const rt = rtMap[appState.runtime] ?? "Nhàn rỗi";
  runtimeEl.querySelector(".statusbar__value").textContent = `Runtime · ${rt}`;
  runtimeEl.dataset.tooltip = `OpenCode runtime: ${rt.toLowerCase()}`;
  const dot = runtimeEl.querySelector(".status-dot");
  dot.className = "status-dot" + (appState.runtime === "permission" ? " status-dot--warn" : appState.runtime === "running" ? " status-dot--ok" : " status-dot--idle");
}

function closeDrawer() {
  appState.drawer = "";
  appState.sidebarHidden = true;
  appState.inspectorOpen = false;
  syncChrome();
}

function openDrawer(kind) {
  if (appState.drawer === kind) { closeDrawer(); return; }
  appState.drawer = kind;
  appState.sidebarHidden = kind !== "sidebar";
  appState.inspectorOpen = kind === "inspector";
  syncChrome();
}

function trapFocus(container) {
  releaseFocusTrap();
  if (!container) return;
  focusTrapHandler = (e) => {
    if (e.key === "Escape") { closeDrawer(); return; }
    if (e.key !== "Tab") return;
    const nodes = container.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", focusTrapHandler);
}

function releaseFocusTrap() {
  if (focusTrapHandler) { document.removeEventListener("keydown", focusTrapHandler); focusTrapHandler = null; }
}

function syncChrome() {
  const app = document.getElementById("app");
  const narrow = isNarrow();
  const overlayInspector = isInspectorOverlay();
  const onCowork = appState.surface === "cowork";

  app.dataset.surface = appState.surface;
  app.dataset.sidebarHidden = appState.sidebarHidden ? "true" : "false";
  app.dataset.inspectorOpen = appState.inspectorOpen ? "true" : "false";
  app.dataset.drawer = appState.drawer;

  document.getElementById("drawer-scrim").hidden = !(narrow && appState.drawer);

  const sidebar = document.getElementById("sidebar");
  const inspector = document.getElementById("inspector");
  sidebar.classList.toggle("sidebar--drawer", narrow && onCowork);
  inspector.classList.toggle("inspector--drawer", overlayInspector && onCowork);

  let inspectorShown = false;
  if (onCowork) {
    if (narrow) inspectorShown = appState.drawer === "inspector";
    else inspectorShown = appState.inspectorOpen;
  }
  inspector.hidden = !inspectorShown;

  if (!onCowork) {
    inspector.classList.remove("inspector--open");
    sidebar.classList.remove("sidebar--open");
    releaseFocusTrap();
  } else if (narrow) {
    sidebar.classList.toggle("sidebar--open", appState.drawer === "sidebar");
    inspector.classList.toggle("inspector--open", appState.drawer === "inspector");
    if (appState.drawer) trapFocus(appState.drawer === "sidebar" ? sidebar : inspector);
    else releaseFocusTrap();
  } else {
    sidebar.classList.remove("sidebar--open");
    inspector.classList.toggle("inspector--open", appState.inspectorOpen && overlayInspector);
    releaseFocusTrap();
  }

  const btnSidebar = document.getElementById("btn-sidebar");
  const showOpen = appState.sidebarHidden || (narrow && appState.drawer !== "sidebar");
  btnSidebar.dataset.tooltip = showOpen ? "Mở sidebar" : "Thu gọn sidebar";
  btnSidebar.setAttribute("aria-label", btnSidebar.dataset.tooltip);
  btnSidebar.querySelector("[data-icon]").dataset.icon = showOpen ? "panel-left-open" : "panel-left-close";
  mountIcons(btnSidebar);
  btnSidebar.hidden = !onCowork;

  const btnInspector = document.getElementById("btn-inspector");
  if (onCowork) {
    btnInspector.dataset.tooltip = appState.inspectorOpen ? "Đóng inspector" : "Mở inspector";
    btnInspector.setAttribute("aria-label", btnInspector.dataset.tooltip);
    btnInspector.querySelector("[data-icon]").dataset.icon = appState.inspectorOpen ? "panel-right-close" : "panel-right-open";
    mountIcons(btnInspector);
  }
}

function activateSurface(surfaceId) {
  appState.surface = surfaceId;
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[0];
  renderRail();
  setMainView(surface.view, surface.id);
  if (surface.view === "cowork") {
    setSidebarTab(appState.sidebarTab);
    renderDocTabs();
    setActiveDoc(appState.activeDoc);
    applyFixtureFlags();
  } else {
    appState.drawer = "";
    appState.sidebarHidden = true;
    appState.inspectorOpen = false;
    appState.openFiles = [];
    appState.activeDoc = "conversation";
    document.getElementById("banner-permission").hidden = true;
    document.getElementById("banner-recovery").hidden = true;
    document.getElementById("doc-conversation").hidden = true;
    document.getElementById("doc-file").hidden = true;
  }
  syncChrome();
  updateStatusBar();
}

function applyFixtureFlags() {
  if (appState.surface !== "cowork" || appState.activeDoc !== "conversation") {
    document.getElementById("banner-permission").hidden = true;
    document.getElementById("banner-recovery").hidden = true;
    updateStatusBar();
    return;
  }
  document.getElementById("banner-permission").hidden = appState.runtime !== "permission";
  document.getElementById("banner-recovery").hidden = appState.provider !== "failed";
  updateStatusBar();
}

function applyState(stateId) {
  resetApplicationState();

  document.getElementById("proto-state-label").textContent = stateId;
  document.getElementById("app").dataset.state = stateId;
  const url = new URL(window.location.href);
  url.searchParams.set("state", stateId);
  window.history.replaceState({}, "", url);

  switch (stateId) {
    case "cowork-active":
      activateSurface("cowork");
      break;
    case "sidebar-cowork":
      activateSurface("cowork");
      setSidebarTab("cowork");
      break;
    case "sidebar-workspace":
      activateSurface("cowork");
      setSidebarTab("workspace");
      renderTree();
      break;
    case "file-document":
      activateSurface("cowork");
      setSidebarTab("workspace");
      openFileDocument("src/README.md", "README.md");
      selectInspectorTab("review");
      break;
    case "cowork-inspector-open":
      activateSurface("cowork");
      appState.inspectorOpen = true;
      if (isNarrow()) appState.drawer = "inspector";
      syncChrome();
      selectInspectorTab("activity");
      break;
    case "gateway":
      activateSurface("gateway");
      break;
    case "knowledge-graph":
      activateSurface("knowledge-graph");
      break;
    case "provider-missing":
      activateSurface("cowork");
      appState.provider = "missing";
      applyFixtureFlags();
      break;
    case "waiting-permission":
      activateSurface("cowork");
      appState.runtime = "permission";
      applyFixtureFlags();
      break;
    default:
      activateSurface("cowork");
  }
}

function bindEvents() {
  document.getElementById("btn-sidebar").addEventListener("click", () => {
    if (appState.surface !== "cowork") return;
    if (isNarrow()) { openDrawer(appState.drawer === "sidebar" ? "" : "sidebar"); return; }
    appState.sidebarHidden = !appState.sidebarHidden;
    syncChrome();
  });
  document.getElementById("btn-inspector").addEventListener("click", () => {
    if (appState.surface !== "cowork") return;
    if (isNarrow() || isInspectorOverlay()) { openDrawer(appState.drawer === "inspector" ? "" : "inspector"); return; }
    appState.inspectorOpen = !appState.inspectorOpen;
    syncChrome();
  });
  document.getElementById("btn-inspector-close").addEventListener("click", () => {
    appState.inspectorOpen = false;
    appState.drawer = "";
    syncChrome();
  });
  document.getElementById("drawer-scrim").addEventListener("click", closeDrawer);
  document.getElementById("tab-cowork").addEventListener("click", () => setSidebarTab("cowork"));
  document.getElementById("tab-workspace").addEventListener("click", () => { setSidebarTab("workspace"); renderTree(); });
  for (const tab of document.querySelectorAll(".inspector__tab")) {
    tab.addEventListener("click", () => selectInspectorTab(tab.dataset.tab));
  }
  window.addEventListener("resize", syncChrome);
}

function init() {
  mountIcons();
  renderRail();
  renderConversations();
  renderTree();
  renderTranscript();
  renderDocTabs();
  selectInspectorTab("plan");
  bindEvents();
  const host = document.getElementById("state-buttons");
  for (const s of STATES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = s.label;
    btn.addEventListener("click", () => applyState(s.id));
    host.append(btn);
  }
  const initial = new URLSearchParams(window.location.search).get("state") ?? "cowork-active";
  applyState(STATES.some((s) => s.id === initial) ? initial : "cowork-active");
}

init();

window.__cghcV3Prototype = {
  applyState,
  applyStateAndSettle,
  assertVisualState,
  collectVisualState,
  runSequentialTransitionTest,
  STATES,
  activateSurface,
  setSidebarTab,
  openFileDocument,
  isElementVisible,
  visibleViews,
};
