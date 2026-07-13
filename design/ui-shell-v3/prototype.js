/**
 * Cowork GHC UI Shell V3 R3 — design prototype only.
 * Work modes, Knowledge surface, provider/skills controls, visibility harness.
 */

const ICONS = {
  cowork: '<path d="M5 12a7 7 0 0 1 14 0v4a2 2 0 0 1-2 2h-2.5l-1.5 1.5-1.5-1.5H7a2 2 0 0 1-2-2v-4"/><path d="M9 11h6M9 15h4"/>',
  dispatch: '<rect x="4" y="5" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/><path d="M10 8h4M10 17h4"/>',
  gateway: '<path d="M4 7h16M4 17h16"/><path d="M8 7v10M16 7v10M7 12h10"/>',
  knowledge: '<path d="M6 5h9a3 3 0 0 1 3 3v11H8a2 2 0 0 1-2-2V5Z"/><path d="M9 8h6M9 12h5"/>',
  microsoft: '<rect x="5" y="5" width="6" height="6"/><rect x="13" y="5" width="6" height="6"/><rect x="5" y="13" width="6" height="6"/><rect x="13" y="13" width="6" height="6"/>',
  code: '<path d="M9 7 5 12l4 5M15 7l4 5-4 5"/><path d="M13 5l-2 14"/>',
  "square-pen": '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414L12 14.414 9.586 12z"/>',
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
  { id: "cowork", label: "Cowork", icon: "cowork", view: "work" },
  { id: "dispatch", label: "Dispatch", icon: "dispatch", awaiting: "D1", view: "integration" },
  { id: "gateway", label: "Gateway", icon: "gateway", awaiting: "D4", view: "integration" },
  { id: "knowledge", label: "Knowledge", icon: "knowledge", awaiting: "D3", view: "knowledge" },
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
  "src/README.md": "# README (prototype fixture)\n\nShell V3 R3: Cowork/Workspace work modes.\n\nKhông phải production build.",
  "docs/integration-readiness.md": "# Integration readiness\n\nFixture preview only.",
};

const TRANSCRIPT = [
  { role: "Bạn", user: true, text: "Tóm tắt checklist intake cho team D4." },
  { role: "Cowork", user: false, text: "Checklist gồm: track ID, commit hash, contract API, credential model, feature flag OFF, demo journey không backend thật." },
  { role: "Bạn", user: true, text: "Mở file README trong workspace." },
  {
    role: "Cowork",
    user: false,
    text: 'Đã tạo bản nháp tại <button type="button" class="file-link" data-file-path="src/README.md" data-file-name="README.md">src/README.md</button>.',
    html: true,
  },
];

const INTEGRATION_COPY = {
  dispatch: { title: "Dispatch", dep: "D1", copy: "Fan-out agent sẽ xuất hiện sau khi track D1 được tích hợp." },
  gateway: { title: "Gateway", dep: "D4", copy: "Gateway đa profile và failover sẽ kết nối sau intake D4." },
  microsoft: { title: "Microsoft 365", dep: "D2", copy: "Graph connector sẽ thay thế trạng thái chờ này." },
  code: { title: "Code", dep: "planned", copy: "Surface Code được lên kế hoạch; chưa có backend." },
};

const STATES = [
  { id: "cowork-active", label: "Cowork active" },
  { id: "cowork-inspector-open", label: "Cowork inspector" },
  { id: "workspace-empty", label: "Workspace empty" },
  { id: "workspace-file", label: "Workspace file" },
  { id: "workspace-file-review", label: "Workspace + File Review" },
  { id: "knowledge-no-graph", label: "Knowledge (no graph)" },
  { id: "knowledge-base", label: "Knowledge base tab" },
  { id: "knowledge-graph", label: "Knowledge graph tab" },
  { id: "gateway", label: "Gateway" },
  { id: "provider-missing", label: "Provider missing" },
  { id: "provider-failed", label: "Provider failed" },
  { id: "waiting-permission", label: "Waiting permission" },
  { id: "cowork-900", label: "Cowork 900px" },
  { id: "workspace-900", label: "Workspace 900px" },
];

const SEQUENTIAL_TRANSITION_STATES = [
  "workspace-file",
  "gateway",
  "cowork-active",
  "provider-missing",
  "knowledge-graph",
];

const WORK_SURFACE = "cowork";
const COWORK_STATES = new Set([
  "cowork-active",
  "cowork-inspector-open",
  "provider-missing",
  "provider-failed",
  "waiting-permission",
  "cowork-900",
]);
const WORKSPACE_STATES = new Set(["workspace-empty", "workspace-file", "workspace-file-review", "workspace-900"]);
const KNOWLEDGE_STATES = new Set(["knowledge-no-graph", "knowledge-base", "knowledge-graph"]);
const INTEGRATION_STATES = new Set(["gateway", "dispatch", "microsoft", "code"]);

const appState = {
  surface: WORK_SURFACE,
  workMode: "cowork",
  activeFile: null,
  openFiles: [],
  inspectorOpen: false,
  inspectorTab: "plan",
  sidebarHidden: false,
  drawer: "",
  provider: "configured",
  runtime: "idle",
  knowledgeTab: "base",
  d3GraphCapability: false,
  skillsCount: 1,
  skillsPopoverOpen: false,
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
function onWorkSurface() { return appState.surface === WORK_SURFACE; }

function isElementVisible(el) {
  if (!el || el.hidden) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function visibleViews() {
  return [...document.querySelectorAll(".view")].filter(isElementVisible).map((el) => el.dataset.view);
}

function visibleSidebarPanels() {
  return [...document.querySelectorAll(".sidebar__panel")].filter(isElementVisible).map((el) => el.dataset.workMode);
}

function visibleDocTabLabels() {
  return [...document.querySelectorAll(".doc-tab")].filter(isElementVisible).map((el) => el.textContent?.trim() ?? "");
}

function isSidebarVisible() { return isElementVisible(document.getElementById("sidebar")); }
function isInspectorVisible() { return isElementVisible(document.getElementById("inspector")); }
function hasHorizontalOverflow() { return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1; }

function collectVisualState(stateId = document.getElementById("app").dataset.state) {
  return {
    state: stateId,
    workMode: appState.workMode,
    visibleViews: visibleViews(),
    visibleSidebarPanels: visibleSidebarPanels(),
    visibleDocTabLabels: visibleDocTabLabels(),
    sidebarVisible: isSidebarVisible(),
    inspectorVisible: isInspectorVisible(),
    horizontalOverflow: hasHorizontalOverflow(),
    surface: appState.surface,
    activeFile: appState.activeFile,
    openFiles: [...appState.openFiles],
    inspectorOpen: appState.inspectorOpen,
    provider: appState.provider,
    runtime: appState.runtime,
    knowledgeTab: appState.knowledgeTab,
    d3GraphCapability: appState.d3GraphCapability,
  };
}

function fail(errors, message) { errors.push(message); }

function assertCoworkMode(errors) {
  if (appState.workMode !== "cowork") fail(errors, "work mode must be cowork");
  if (!isElementVisible(document.querySelector('.view[data-view="cowork"]'))) fail(errors, "cowork main must be visible");
  if (isElementVisible(document.querySelector('.view[data-view="workspace"]'))) fail(errors, "workspace main must be hidden");
  if (!isElementVisible(document.getElementById("conv-list"))) fail(errors, "conversation list must be visible");
  if (!isElementVisible(document.getElementById("transcript"))) fail(errors, "transcript must be visible");
  if (!isElementVisible(document.querySelector(".composer"))) fail(errors, "composer must be visible");
  if (isElementVisible(document.getElementById("doc-tabs"))) fail(errors, "file tabs must be hidden in cowork mode");
  if (isElementVisible(document.getElementById("workspace-empty"))) fail(errors, "workspace empty must be hidden");
  if (isElementVisible(document.getElementById("doc-file"))) fail(errors, "file preview must be hidden in cowork mode");
  for (const label of visibleDocTabLabels()) {
    if (label.includes("Cuộc trò chuyện")) fail(errors, "no Cuộc trò chuyện document tab");
  }
}

function assertWorkspaceMode(errors) {
  if (appState.workMode !== "workspace") fail(errors, "work mode must be workspace");
  if (!isElementVisible(document.querySelector('.view[data-view="workspace"]'))) fail(errors, "workspace main must be visible");
  if (isElementVisible(document.querySelector('.view[data-view="cowork"]'))) fail(errors, "cowork main must be hidden");
  if (!isElementVisible(document.getElementById("file-tree"))) fail(errors, "file tree must be visible");
  if (isElementVisible(document.getElementById("conv-list"))) fail(errors, "conversation list must be hidden");
  if (isElementVisible(document.getElementById("transcript"))) fail(errors, "transcript must be hidden");
  if (isElementVisible(document.querySelector(".composer"))) fail(errors, "composer must be hidden");
  if (isElementVisible(document.getElementById("banner-permission"))) fail(errors, "permission banner must be hidden in workspace");
  for (const label of visibleDocTabLabels()) {
    if (label.includes("Cuộc trò chuyện")) fail(errors, "workspace tabs must not include Cuộc trò chuyện");
  }
}

function assertKnowledge(errors) {
  if (visibleViews().length !== 1 || visibleViews()[0] !== "knowledge") {
    fail(errors, `expected knowledge view only, got ${visibleViews().join(", ")}`);
  }
  if (document.querySelector('.rail__btn[aria-current="page"]')?.getAttribute("aria-label")?.includes("Knowledge Graph")) {
    fail(errors, "no separate Knowledge Graph rail item");
  }
  if (!isElementVisible(document.getElementById("k-tab-base"))) fail(errors, "Kho tri thức tab must be visible");
  if (isElementVisible(document.getElementById("conv-list"))) fail(errors, "no Cowork sidebar on knowledge");
  if (isElementVisible(document.querySelector(".composer"))) fail(errors, "no composer on knowledge");
  if (isInspectorVisible()) fail(errors, "no Cowork inspector on knowledge");
}

function assertIntegration(errors) {
  if (visibleViews().length !== 1 || visibleViews()[0] !== "integration") {
    fail(errors, `expected integration view only, got ${visibleViews().join(", ")}`);
  }
  if (isSidebarVisible()) fail(errors, "sidebar must be hidden");
  if (isInspectorVisible()) fail(errors, "inspector must be hidden");
  if (isElementVisible(document.querySelector('.view[data-view="cowork"]'))) fail(errors, "cowork view hidden");
  if (isElementVisible(document.querySelector('.view[data-view="workspace"]'))) fail(errors, "workspace view hidden");
}

function assertProvider(errors, stateId) {
  const selector = document.getElementById("provider-select");
  const dot = document.getElementById("status-provider-dot");
  if (stateId === "provider-missing") {
    if (!selector.hidden && !selector.disabled) fail(errors, "provider selector must be hidden/disabled when missing");
    if (!dot.classList.contains("status-dot--warn")) fail(errors, "bottom status must be amber when missing");
  } else if (stateId === "provider-failed") {
    if (!dot.classList.contains("status-dot--danger")) fail(errors, "bottom status must be red when failed");
    if (!isElementVisible(document.getElementById("provider-select-fail"))) fail(errors, "failed provider needs explicit text");
  } else if (COWORK_STATES.has(stateId) && appState.provider === "configured") {
    if (!isElementVisible(selector)) fail(errors, "provider selector visible when configured");
    if (!dot.classList.contains("status-dot--ok")) fail(errors, "bottom status green when configured");
  }
}

function assertVisualState(stateId) {
  const snapshot = collectVisualState(stateId);
  const errors = [];

  if (COWORK_STATES.has(stateId)) {
    assertCoworkMode(errors);
    if (stateId === "cowork-inspector-open" && !snapshot.inspectorVisible) fail(errors, "inspector must be open");
    else if (stateId !== "cowork-inspector-open" && snapshot.inspectorVisible) fail(errors, "inspector must be closed");
  } else if (WORKSPACE_STATES.has(stateId)) {
    assertWorkspaceMode(errors);
    if (stateId === "workspace-empty" && appState.activeFile) fail(errors, "workspace-empty must have no active file");
    if ((stateId === "workspace-file" || stateId === "workspace-file-review") && !appState.activeFile) {
      fail(errors, "workspace file state needs active file");
    }
    if (stateId === "workspace-file-review" && !snapshot.inspectorVisible) fail(errors, "file review needs inspector");
  } else if (KNOWLEDGE_STATES.has(stateId)) {
    assertKnowledge(errors);
    if (stateId === "knowledge-no-graph" && isElementVisible(document.getElementById("k-tab-graph"))) {
      fail(errors, "Đồ thị tab must be hidden without capability");
    }
    if ((stateId === "knowledge-graph" || stateId === "knowledge-base") && !appState.d3GraphCapability && stateId === "knowledge-graph") {
      fail(errors, "graph tab requires D3 capability");
    }
    if (stateId === "knowledge-graph" && appState.knowledgeTab !== "graph") fail(errors, "knowledge-graph state needs graph tab");
  } else if (INTEGRATION_STATES.has(stateId)) {
    assertIntegration(errors);
  }

  if (stateId === "waiting-permission") {
    if (!isElementVisible(document.getElementById("banner-permission"))) fail(errors, "permission banner visible");
  }
  if (["provider-missing", "provider-failed", ...COWORK_STATES].includes(stateId)) {
    assertProvider(errors, stateId);
  }
  if (isNarrow() && hasHorizontalOverflow()) fail(errors, "horizontal overflow at narrow viewport");

  return { ...snapshot, passed: errors.length === 0, errors };
}

async function waitForStableFrames(count = 2) {
  for (let i = 0; i < count; i += 1) await new Promise((r) => requestAnimationFrame(r));
}

async function applyStateAndSettle(stateId) {
  applyState(stateId);
  await waitForStableFrames(2);
  return assertVisualState(stateId);
}

function assertClickFromChat() {
  const errors = [];
  assertWorkspaceMode(errors);
  if (appState.activeFile !== "src/README.md") fail(errors, "click-from-chat must open src/README.md");
  if (!appState.openFiles.some((f) => f.path === "src/README.md")) fail(errors, "README tab must be open");
  return { passed: errors.length === 0, errors };
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
  Object.assign(appState, {
    surface: WORK_SURFACE,
    workMode: "cowork",
    activeFile: null,
    openFiles: [],
    inspectorOpen: false,
    inspectorTab: "plan",
    sidebarHidden: false,
    drawer: "",
    provider: "configured",
    runtime: "idle",
    knowledgeTab: "base",
    d3GraphCapability: false,
    skillsCount: 1,
    skillsPopoverOpen: false,
  });

  document.documentElement.style.width = "";
  document.body.style.width = "";
  document.getElementById("banner-permission").hidden = true;
  document.getElementById("banner-recovery").hidden = true;
  document.getElementById("drawer-scrim").hidden = true;
  document.getElementById("skills-popover").hidden = true;
  document.getElementById("provider-select-fail").hidden = true;
  document.getElementById("provider-select").hidden = false;
  document.getElementById("provider-select").disabled = false;

  releaseFocusTrap();
  selectInspectorTab("plan");
  setWorkMode("cowork");
  renderFileTabs();
  updateWorkspaceMain();
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

function setWorkMode(mode) {
  appState.workMode = mode;
  document.getElementById("app").dataset.workMode = mode;
  for (const btn of document.querySelectorAll(".sidebar-tabs__btn")) {
    const active = btn.dataset.workMode === mode;
    btn.classList.toggle("sidebar-tabs__btn--active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const panel of document.querySelectorAll(".sidebar__panel")) {
    panel.hidden = panel.dataset.workMode !== mode;
  }
  document.querySelector('.view[data-view="cowork"]').hidden = mode !== "cowork";
  document.querySelector('.view[data-view="workspace"]').hidden = mode !== "workspace";
  updateWorkspaceMain();
  updateInspectorTabsForMode();
  syncChrome();
}

function updateInspectorTabsForMode() {
  const plan = document.querySelector('.inspector__tab[data-tab="plan"]');
  const activity = document.querySelector('.inspector__tab[data-tab="activity"]');
  const files = document.querySelector('.inspector__tab[data-tab="files"]');
  const review = document.querySelector('.inspector__tab[data-tab="review"]');
  const inWorkspace = onWorkSurface() && appState.workMode === "workspace";
  plan.hidden = inWorkspace;
  activity.hidden = inWorkspace;
  files.hidden = false;
  review.hidden = false;
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

function renderTree(activePath = null) {
  const tree = document.getElementById("file-tree");
  tree.replaceChildren();
  for (const row of FILE_TREE) {
    const div = document.createElement("div");
    div.className = `tree__row${row.path === activePath ? " tree__row--active" : ""}`;
    div.style.paddingLeft = `${8 + row.depth * 14}px`;
    div.innerHTML = `<span class="tree__indent"></span>
      <span class="icon icon--muted" data-icon="${row.type === "folder" ? "folder" : "file"}"></span><span>${row.name}</span>`;
    if (row.type === "file") div.addEventListener("click", () => openFileInWorkspace(row.path, row.name));
    tree.append(div);
  }
  mountIcons(tree);
}

function renderFileTabs() {
  const host = document.getElementById("doc-tabs");
  host.replaceChildren();
  if (!appState.openFiles.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  for (const f of appState.openFiles) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `doc-tab${appState.activeFile === f.path ? " doc-tab--active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", appState.activeFile === f.path ? "true" : "false");
    tab.innerHTML = `<span>${f.name}</span><span class="doc-tab__close icon" data-icon="close" role="button" aria-label="Đóng ${f.name}"></span>`;
    tab.querySelector(".doc-tab__close").addEventListener("click", (e) => { e.stopPropagation(); closeFile(f.path); });
    tab.addEventListener("click", () => selectFile(f.path));
    host.append(tab);
  }
  mountIcons(host);
}

function updateFileBreadcrumb(docId) {
  const parts = docId.split("/");
  const name = parts.pop() ?? docId;
  document.getElementById("file-breadcrumb-path").textContent = parts.length ? `${parts.join(" / ")} / ${name}` : name;
}

function updateWorkspaceMain() {
  const hasFile = Boolean(appState.activeFile);
  document.getElementById("workspace-empty").hidden = hasFile;
  document.getElementById("doc-file").hidden = !hasFile;
  renderFileTabs();
  if (hasFile) {
    document.getElementById("file-body").textContent = FILE_CONTENT[appState.activeFile] ?? "(prototype fixture)";
    updateFileBreadcrumb(appState.activeFile);
  }
}

function selectFile(path) {
  appState.activeFile = path;
  updateWorkspaceMain();
  renderTree(path);
}

function openFileInWorkspace(path, name) {
  if (!appState.openFiles.some((f) => f.path === path)) appState.openFiles.push({ path, name });
  setWorkMode("workspace");
  selectFile(path);
  selectInspectorTab("files");
}

function openFileFromChat(path, name) {
  activateSurface(WORK_SURFACE);
  openFileInWorkspace(path, name);
}

function closeFile(path) {
  appState.openFiles = appState.openFiles.filter((f) => f.path !== path);
  if (appState.activeFile === path) {
    appState.activeFile = appState.openFiles.at(-1)?.path ?? null;
  }
  updateWorkspaceMain();
  renderTree(appState.activeFile);
}

function renderTranscript() {
  const inner = document.createElement("div");
  inner.className = "transcript__inner";
  for (const m of TRANSCRIPT) {
    const div = document.createElement("div");
    div.className = `msg${m.user ? " msg--user" : ""}`;
    if (m.html) {
      div.innerHTML = `<div class="msg__role">${m.role}</div><div class="msg__body">${m.text}</div>`;
    } else {
      div.innerHTML = `<div class="msg__role">${m.role}</div><div class="msg__body">${m.text}</div>`;
    }
    inner.append(div);
  }
  inner.querySelectorAll(".file-link").forEach((btn) => {
    btn.addEventListener("click", () => openFileFromChat(btn.dataset.filePath, btn.dataset.fileName));
  });
  document.getElementById("transcript").replaceChildren(inner);
}

function selectInspectorTab(tab) {
  appState.inspectorTab = tab;
  for (const btn of document.querySelectorAll(".inspector__tab")) {
    if (btn.hidden) continue;
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
    panel.innerHTML = `<p class="inspector-panel__line"><strong>Prototype V3 R3</strong> — work modes</p>`;
  } else if (tab === "files") {
    const pth = appState.activeFile ?? "docs/integration/external-systems-integration-readiness.md";
    panel.innerHTML = `<p class="inspector-panel__line"><code>${pth}</code></p>`;
  } else {
    const pth = appState.activeFile ?? "design/ui-shell-v3/styles.css";
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

function renderKnowledgeBody() {
  const host = document.getElementById("knowledge-body");
  if (appState.knowledgeTab === "graph") {
    host.innerHTML = `<div class="knowledge-empty">
      <h2 class="knowledge-empty__title">Đồ thị tri thức</h2>
      <p class="knowledge-empty__copy">Graph explorer chỉ hiển thị dữ liệu thật sau tích hợp D3.</p>
      <span class="integration-empty__badge">Chờ tích hợp D3</span>
    </div>`;
  } else {
    host.innerHTML = `<div class="knowledge-empty">
      <h2 class="knowledge-empty__title">Kho tri thức</h2>
      <p class="knowledge-empty__copy">RAG và retrieval có provenance sẽ bật khi backend D3 sẵn sàng.</p>
      <span class="integration-empty__badge">Chờ tích hợp D3</span>
    </div>`;
  }
}

function setKnowledgeTab(tab) {
  appState.knowledgeTab = tab;
  for (const btn of document.querySelectorAll(".knowledge-tabs__btn")) {
    const active = btn.dataset.knowledgeTab === tab;
    btn.classList.toggle("knowledge-tabs__btn--active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  renderKnowledgeBody();
}

function updateKnowledgeTabs() {
  const graphTab = document.getElementById("k-tab-graph");
  graphTab.hidden = !appState.d3GraphCapability;
  if (!appState.d3GraphCapability && appState.knowledgeTab === "graph") {
    setKnowledgeTab("base");
  }
}

function setSurfaceView(view, surfaceId = WORK_SURFACE) {
  const views = {
    cowork: document.querySelector('.view[data-view="cowork"]'),
    workspace: document.querySelector('.view[data-view="workspace"]'),
    knowledge: document.querySelector('.view[data-view="knowledge"]'),
    integration: document.querySelector('.view[data-view="integration"]'),
  };
  const shell = document.getElementById("shell");
  const sidebar = document.getElementById("sidebar");
  const btnInspector = document.getElementById("btn-inspector");

  views.knowledge.hidden = true;
  views.integration.hidden = true;

  if (view === "work") {
    shell.classList.remove("shell--integration");
    sidebar.hidden = false;
    btnInspector.hidden = false;
    setWorkMode(appState.workMode);
  } else if (view === "knowledge") {
    shell.classList.add("shell--integration");
    sidebar.hidden = true;
    btnInspector.hidden = true;
    appState.inspectorOpen = false;
    appState.drawer = "";
    views.cowork.hidden = true;
    views.workspace.hidden = true;
    views.knowledge.hidden = false;
    updateKnowledgeTabs();
    setKnowledgeTab(appState.knowledgeTab);
  } else {
    shell.classList.add("shell--integration");
    sidebar.hidden = true;
    btnInspector.hidden = true;
    appState.inspectorOpen = false;
    appState.drawer = "";
    views.cowork.hidden = true;
    views.workspace.hidden = true;
    views.integration.hidden = false;
    renderIntegration(surfaceId);
  }
  syncChrome();
}

function updateComposerProvider() {
  const selector = document.getElementById("provider-select");
  const dot = document.getElementById("provider-select-dot");
  const fail = document.getElementById("provider-select-fail");
  selector.hidden = appState.provider === "missing";
  selector.disabled = appState.provider === "missing";
  fail.hidden = appState.provider !== "failed";
  dot.className = "status-dot " + (appState.provider === "failed" ? "status-dot--danger" : "status-dot--ok");
}

function updateStatusBar() {
  const providerBtn = document.getElementById("status-provider");
  const dot = document.getElementById("status-provider-dot");
  const value = document.getElementById("status-provider-value");
  providerBtn.classList.remove("statusbar__item--warn", "statusbar__item--pulse", "statusbar__item--danger");

  if (appState.provider === "missing") {
    value.textContent = "Provider · Chưa cấu hình";
    providerBtn.dataset.tooltip = "Provider: Chưa cấu hình — nhấn để mở cài đặt";
    dot.className = "status-dot status-dot--warn";
    providerBtn.classList.add("statusbar__item--warn", "statusbar__item--pulse");
  } else if (appState.provider === "failed") {
    value.textContent = "DeepSeek · Kết nối thất bại";
    providerBtn.dataset.tooltip = "Provider: Kết nối thất bại";
    dot.className = "status-dot status-dot--danger";
    providerBtn.classList.add("statusbar__item--danger");
  } else {
    value.textContent = "DeepSeek · Sẵn sàng";
    providerBtn.dataset.tooltip = "DeepSeek: Sẵn sàng";
    dot.className = "status-dot status-dot--ok";
  }

  const runtimeEl = document.getElementById("status-runtime");
  const rtMap = { idle: "Nhàn rỗi", starting: "Đang khởi động", running: "Đang chạy", permission: "Chờ quyền", error: "Lỗi" };
  const rt = rtMap[appState.runtime] ?? "Nhàn rỗi";
  runtimeEl.querySelector(".statusbar__value").textContent = `Runtime · ${rt}`;
  updateComposerProvider();
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
  const work = onWorkSurface();

  app.dataset.surface = appState.surface;
  app.dataset.workMode = appState.workMode;
  app.dataset.sidebarHidden = appState.sidebarHidden ? "true" : "false";
  app.dataset.inspectorOpen = appState.inspectorOpen ? "true" : "false";
  app.dataset.drawer = appState.drawer;
  document.getElementById("drawer-scrim").hidden = !(narrow && appState.drawer);

  const sidebar = document.getElementById("sidebar");
  const inspector = document.getElementById("inspector");
  sidebar.classList.toggle("sidebar--drawer", narrow && work);
  inspector.classList.toggle("inspector--drawer", overlayInspector && work);

  let inspectorShown = false;
  if (work) {
    if (narrow) inspectorShown = appState.drawer === "inspector";
    else inspectorShown = appState.inspectorOpen;
  }
  inspector.hidden = !inspectorShown;

  if (!work) {
    sidebar.classList.remove("sidebar--open");
    inspector.classList.remove("inspector--open");
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
  btnSidebar.hidden = !work;

  const btnInspector = document.getElementById("btn-inspector");
  if (work) {
    btnInspector.hidden = false;
    btnInspector.dataset.tooltip = appState.inspectorOpen ? "Đóng inspector" : "Mở inspector";
    btnInspector.setAttribute("aria-label", btnInspector.dataset.tooltip);
    btnInspector.querySelector("[data-icon]").dataset.icon = appState.inspectorOpen ? "panel-right-close" : "panel-right-open";
    mountIcons(btnInspector);
  } else {
    btnInspector.hidden = true;
  }
}

function activateSurface(surfaceId) {
  appState.surface = surfaceId;
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[0];
  renderRail();
  setSurfaceView(surface.view, surface.id);
  if (surface.view === "work") {
    applyFixtureFlags();
  } else {
    document.getElementById("banner-permission").hidden = true;
    document.getElementById("banner-recovery").hidden = true;
  }
  updateStatusBar();
}

function applyFixtureFlags() {
  if (!onWorkSurface() || appState.workMode !== "cowork") {
    document.getElementById("banner-permission").hidden = true;
    document.getElementById("banner-recovery").hidden = true;
    updateStatusBar();
    return;
  }
  document.getElementById("banner-permission").hidden = appState.runtime !== "permission";
  document.getElementById("banner-recovery").hidden = appState.provider !== "failed" || appState.provider === "missing";
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
    case "cowork-900":
      activateSurface(WORK_SURFACE);
      setWorkMode("cowork");
      break;
    case "cowork-inspector-open":
      activateSurface(WORK_SURFACE);
      setWorkMode("cowork");
      appState.inspectorOpen = true;
      if (isNarrow()) appState.drawer = "inspector";
      syncChrome();
      selectInspectorTab("activity");
      break;
    case "workspace-empty":
    case "workspace-900":
      activateSurface(WORK_SURFACE);
      setWorkMode("workspace");
      break;
    case "workspace-file":
      activateSurface(WORK_SURFACE);
      openFileInWorkspace("src/README.md", "README.md");
      break;
    case "workspace-file-review":
      activateSurface(WORK_SURFACE);
      openFileInWorkspace("src/README.md", "README.md");
      appState.inspectorOpen = true;
      if (isNarrow()) appState.drawer = "inspector";
      syncChrome();
      selectInspectorTab("review");
      break;
    case "knowledge-no-graph":
      appState.d3GraphCapability = false;
      activateSurface("knowledge");
      setKnowledgeTab("base");
      break;
    case "knowledge-base":
      appState.d3GraphCapability = true;
      activateSurface("knowledge");
      setKnowledgeTab("base");
      break;
    case "knowledge-graph":
      appState.d3GraphCapability = true;
      activateSurface("knowledge");
      setKnowledgeTab("graph");
      break;
    case "gateway":
      activateSurface("gateway");
      break;
    case "provider-missing":
      activateSurface(WORK_SURFACE);
      setWorkMode("cowork");
      appState.provider = "missing";
      applyFixtureFlags();
      break;
    case "provider-failed":
      activateSurface(WORK_SURFACE);
      setWorkMode("cowork");
      appState.provider = "failed";
      applyFixtureFlags();
      break;
    case "waiting-permission":
      activateSurface(WORK_SURFACE);
      setWorkMode("cowork");
      appState.runtime = "permission";
      applyFixtureFlags();
      break;
    default:
      activateSurface(WORK_SURFACE);
      setWorkMode("cowork");
  }
  updateStatusBar();
}

function bindEvents() {
  document.getElementById("btn-sidebar").addEventListener("click", () => {
    if (!onWorkSurface()) return;
    if (isNarrow()) { openDrawer(appState.drawer === "sidebar" ? "" : "sidebar"); return; }
    appState.sidebarHidden = !appState.sidebarHidden;
    syncChrome();
  });
  document.getElementById("btn-inspector").addEventListener("click", () => {
    if (!onWorkSurface()) return;
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
  document.getElementById("tab-cowork").addEventListener("click", () => {
    activateSurface(WORK_SURFACE);
    setWorkMode("cowork");
  });
  document.getElementById("tab-workspace").addEventListener("click", () => {
    activateSurface(WORK_SURFACE);
    setWorkMode("workspace");
    renderTree(appState.activeFile);
  });
  document.getElementById("btn-skills").addEventListener("click", () => {
    const pop = document.getElementById("skills-popover");
    appState.skillsPopoverOpen = !appState.skillsPopoverOpen;
    pop.hidden = !appState.skillsPopoverOpen;
  });
  document.getElementById("k-tab-base").addEventListener("click", () => setKnowledgeTab("base"));
  document.getElementById("k-tab-graph").addEventListener("click", () => setKnowledgeTab("graph"));
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
  updateInspectorTabsForMode();
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
  assertClickFromChat,
  openFileFromChat,
  STATES,
  activateSurface,
  setWorkMode,
  openFileInWorkspace,
  isElementVisible,
  visibleViews,
};
