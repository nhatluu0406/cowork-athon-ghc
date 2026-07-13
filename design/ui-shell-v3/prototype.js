/**
 * Cowork GHC UI Shell V3 — design prototype only.
 * Self-contained fixture UI; no production imports; no backend.
 */

const ICONS = {
  cowork: '<path d="M5 12a7 7 0 0 1 14 0v4a2 2 0 0 1-2 2h-2.5l-1.5 1.5-1.5-1.5H7a2 2 0 0 1-2-2v-4"/><path d="M9 11h6M9 15h4"/>',
  workspace: '<path d="M4 7h7l2 2h7v9H4V7Z"/>',
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
};

const SURFACES = [
  { id: "cowork", label: "Cowork", icon: "cowork", context: "cowork", view: "cowork" },
  { id: "workspace", label: "Workspace", icon: "workspace", context: "workspace", view: "workspace" },
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
  { type: "folder", name: "src", depth: 0, open: true },
  { type: "file", name: "README.md", depth: 1, active: true },
  { type: "file", name: "app-shell-notes.md", depth: 1 },
  { type: "folder", name: "docs", depth: 0, open: true },
  { type: "file", name: "integration-readiness.md", depth: 1 },
  { type: "folder", name: "service", depth: 0 },
];

const TRANSCRIPT = [
  { role: "Bạn", user: true, text: "Tóm tắt checklist intake cho team D4." },
  {
    role: "Cowork",
    user: false,
    text: "Checklist gồm: track ID, commit hash, contract API, credential model, feature flag mặc định OFF, và demo journey không dùng backend thật.",
  },
  { role: "Bạn", user: true, text: "Nhắc lại ranh giới keyring và permission." },
  {
    role: "Cowork",
    user: false,
    text: "Keyring chỉ ở service; permission modal không được bypass bởi child task hay connector.",
  },
];

const INSPECTOR_FIXTURE = {
  plan: [
    "Thu thập intake report từ team D4",
    "Kiểm tra contract gateway và failover",
    "Chạy focused test trên branch integration/d4-gateway",
  ],
  activity: [
    { label: "Đọc tài liệu readiness", status: "done" },
    { label: "Soạn prototype shell V3", status: "done" },
    { label: "Chờ merge D4", status: "pending" },
  ],
  files: [
    { path: "docs/integration/external-systems-integration-readiness.md", kind: "đọc" },
    { path: "design/ui-shell-v3/index.html", kind: "tạo" },
  ],
  review: {
    path: "design/ui-shell-v3/styles.css",
    summary: "+248 dòng layout responsive; không đụng production shell.",
  },
};

const INTEGRATION_COPY = {
  dispatch: { title: "Dispatch", dep: "D1", copy: "Fan-out agent và điều phối tác vụ con sẽ xuất hiện sau khi track D1 được tích hợp." },
  gateway: { title: "Gateway", dep: "D4", copy: "Gateway đa profile, failover và routing sẽ kết nối tại đây sau intake D4." },
  knowledge: { title: "Knowledge", dep: "D3", copy: "Chỉ mục RAG và retrieval có provenance sẽ bật khi backend D3 sẵn sàng." },
  "knowledge-graph": { title: "Knowledge Graph", dep: "D3", copy: "Graph explorer chỉ hiển thị dữ liệu thật sau tích hợp D3." },
  microsoft: { title: "Microsoft 365", dep: "D2", copy: "Teams, SharePoint và Graph connector sẽ thay thế trạng thái chờ này." },
  code: { title: "Code", dep: "planned", copy: "Surface Code được lên kế hoạch; chưa có backend hay mock dữ liệu." },
};

const STATES = [
  { id: "cowork-active", label: "Cowork — conversation active" },
  { id: "cowork-sidebar-hidden", label: "Cowork — sidebar hidden" },
  { id: "cowork-inspector-open", label: "Cowork — inspector open" },
  { id: "workspace", label: "Workspace — file tree + preview" },
  { id: "gateway", label: "Gateway — awaiting D4" },
  { id: "knowledge-graph", label: "Knowledge Graph — awaiting D3" },
  { id: "narrow-900", label: "Width ~900px" },
  { id: "missing-provider", label: "Missing provider" },
  { id: "waiting-permission", label: "Waiting permission" },
];

function icon(name) {
  const path = ICONS[name] ?? ICONS.file;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

function mountIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    el.innerHTML = icon(el.dataset.icon);
  }
}

function renderRail(activeId) {
  const host = document.getElementById("rail-items");
  host.replaceChildren();
  for (const s of SURFACES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rail__btn${s.awaiting ? " rail__btn--awaiting" : ""}`;
    btn.dataset.surface = s.id;
    btn.dataset.tooltip = s.awaiting ? `${s.label} — Chờ tích hợp ${s.awaiting}` : s.label;
    btn.setAttribute("aria-label", btn.dataset.tooltip);
    if (s.id === activeId) btn.setAttribute("aria-current", "page");
    btn.innerHTML = `<span class="icon">${icon(s.icon)}</span>`;
    btn.addEventListener("click", () => activateSurface(s.id));
    host.append(btn);
  }
}

function renderConversations() {
  const list = document.getElementById("conv-list");
  list.replaceChildren();
  for (const c of CONVERSATIONS) {
    const li = document.createElement("li");
    li.className = `conv-item${c.id === "c1" ? " conv-item--active" : ""}`;
    li.innerHTML = `
      <span class="conv-item__title">${c.title}</span>
      <button type="button" class="icon-btn icon-btn--sm" data-tooltip="Thêm hành động" aria-label="Thêm hành động cho ${c.title}">
        <span class="icon" data-icon="more"></span>
      </button>
      <span class="conv-item__meta">${c.meta}</span>`;
    list.append(li);
  }
  mountIcons(list);
}

function renderTree() {
  const tree = document.getElementById("file-tree");
  tree.replaceChildren();
  for (const row of FILE_TREE) {
    const div = document.createElement("div");
    div.className = `tree__row${row.active ? " tree__row--active" : ""}`;
    div.style.paddingLeft = `${8 + row.depth * 14}px`;
    div.innerHTML = `
      <span class="tree__indent"></span>
      <span class="icon icon--muted" data-icon="${row.type === "folder" ? "folder" : "file"}"></span>
      <span>${row.name}</span>`;
    tree.append(div);
  }
  mountIcons(tree);
}

function renderTranscript() {
  const host = document.getElementById("transcript");
  const inner = document.createElement("div");
  inner.className = "transcript__inner";
  for (const m of TRANSCRIPT) {
    const div = document.createElement("div");
    div.className = `msg${m.user ? " msg--user" : ""}`;
    div.innerHTML = `<div class="msg__role">${m.role}</div><div class="msg__body">${m.text}</div>`;
    inner.append(div);
  }
  host.replaceChildren(inner);
}

function renderInspectorTab(tab) {
  const body = document.getElementById("inspector-body");
  body.replaceChildren();
  const panel = document.createElement("div");
  panel.className = "inspector-panel";

  if (tab === "plan") {
    const ol = document.createElement("ol");
    ol.style.margin = "0";
    ol.style.paddingLeft = "18px";
    for (const step of INSPECTOR_FIXTURE.plan) {
      const li = document.createElement("li");
      li.className = "inspector-panel__line";
      li.textContent = step;
      ol.append(li);
    }
    panel.append(ol);
  } else if (tab === "activity") {
    for (const a of INSPECTOR_FIXTURE.activity) {
      const p = document.createElement("p");
      p.className = "inspector-panel__line";
      p.innerHTML = `<strong>${a.label}</strong> — ${a.status === "done" ? "hoàn tất" : "đang chờ"}`;
      panel.append(p);
    }
  } else if (tab === "files") {
    for (const f of INSPECTOR_FIXTURE.files) {
      const p = document.createElement("p");
      p.className = "inspector-panel__line";
      p.innerHTML = `<code>${f.path}</code> · ${f.kind}`;
      panel.append(p);
    }
  } else {
    const p = document.createElement("p");
    p.className = "inspector-panel__line";
    p.innerHTML = `<strong>${INSPECTOR_FIXTURE.review.path}</strong><br>${INSPECTOR_FIXTURE.review.summary}`;
    panel.append(p);
  }

  body.append(panel);
}

function renderIntegration(surfaceId) {
  const copy = INTEGRATION_COPY[surfaceId] ?? INTEGRATION_COPY.gateway;
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[3];
  const host = document.getElementById("integration-empty");
  host.innerHTML = `
    <div class="integration-empty__icon icon" data-icon="${surface.icon}"></div>
    <h1 class="integration-empty__title">${copy.title}</h1>
    <p class="integration-empty__copy">${copy.copy}</p>
    <span class="integration-empty__badge">Chờ tích hợp ${copy.dep}</span>`;
  mountIcons(host);
}

function setSidebarContext(context) {
  for (const panel of document.querySelectorAll(".sidebar__panel")) {
    panel.hidden = panel.dataset.context !== context;
  }
}

function setMainView(view, surfaceId = "cowork") {
  for (const v of document.querySelectorAll(".view")) {
    v.hidden = v.dataset.view !== view;
  }
  if (view === "integration") renderIntegration(surfaceId);
  if (view === "workspace") {
    document.getElementById("file-body").textContent =
      "# README (prototype fixture)\n\nShell V3 tách product rail, contextual sidebar, main workspace và inspector.\n\nKhông phải production build.";
  }
}

function activateSurface(surfaceId) {
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[0];
  renderRail(surface.id);
  if (surface.context) {
    setSidebarContext(surface.context);
  } else {
    setSidebarContext("cowork");
  }
  setMainView(surface.view, surface.id);
  document.getElementById("app").dataset.surface = surface.id;
}

function setInspectorOpen(open) {
  const app = document.getElementById("app");
  app.dataset.inspectorOpen = open ? "true" : "false";
  const btn = document.getElementById("btn-inspector");
  const backdrop = document.getElementById("inspector-backdrop");
  btn.dataset.tooltip = open ? "Đóng inspector" : "Mở inspector";
  btn.setAttribute("aria-label", btn.dataset.tooltip);
  btn.querySelector("[data-icon]").dataset.icon = open ? "panel-right-close" : "panel-right-open";
  mountIcons(btn);
  backdrop.hidden = !open;
}

function setSidebarHidden(hidden) {
  const app = document.getElementById("app");
  app.dataset.sidebarHidden = hidden ? "true" : "false";
  const btn = document.getElementById("btn-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  btn.dataset.tooltip = hidden ? "Mở sidebar" : "Thu gọn sidebar";
  btn.setAttribute("aria-label", btn.dataset.tooltip);
  btn.querySelector("[data-icon]").dataset.icon = hidden ? "panel-left-open" : "panel-left-close";
  mountIcons(btn);
  backdrop.hidden = hidden || window.innerWidth > 900;
}

function applyState(stateId) {
  const app = document.getElementById("app");
  app.dataset.state = stateId;
  document.getElementById("proto-state-label").textContent = `State: ${stateId}`;

  document.getElementById("banner-missing-provider").hidden = true;
  document.getElementById("banner-permission").hidden = true;
  document.getElementById("btn-continue").hidden = true;
  document.getElementById("provider-chip").classList.remove("compact-chip--error");

  setSidebarHidden(false);
  setInspectorOpen(false);

  const url = new URL(window.location.href);
  url.searchParams.set("state", stateId);
  window.history.replaceState({}, "", url);

  switch (stateId) {
    case "cowork-active":
      activateSurface("cowork");
      break;
    case "cowork-sidebar-hidden":
      activateSurface("cowork");
      setSidebarHidden(true);
      break;
    case "cowork-inspector-open":
      activateSurface("cowork");
      setInspectorOpen(true);
      break;
    case "workspace":
      activateSurface("workspace");
      break;
    case "gateway":
      activateSurface("gateway");
      setSidebarHidden(true);
      break;
    case "knowledge-graph":
      activateSurface("knowledge-graph");
      setSidebarHidden(true);
      break;
    case "narrow-900":
      activateSurface("cowork");
      document.documentElement.style.width = "900px";
      setSidebarHidden(true);
      break;
    case "missing-provider":
      activateSurface("cowork");
      document.getElementById("banner-missing-provider").hidden = false;
      document.getElementById("provider-chip").classList.add("compact-chip--error");
      document.getElementById("provider-chip").setAttribute("aria-label", "Provider: chưa cấu hình");
      break;
    case "waiting-permission":
      activateSurface("cowork");
      document.getElementById("banner-permission").hidden = false;
      break;
    default:
      activateSurface("cowork");
  }

  if (stateId !== "narrow-900") {
    document.documentElement.style.width = "";
  }
}

function bindInspectorTabs() {
  for (const tab of document.querySelectorAll(".inspector__tab")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll(".inspector__tab")) {
        const active = t === tab;
        t.classList.toggle("inspector__tab--active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      }
      renderInspectorTab(tab.dataset.tab);
    });
  }
}

function bindChrome() {
  document.getElementById("btn-sidebar").addEventListener("click", () => {
    const app = document.getElementById("app");
    setSidebarHidden(app.dataset.sidebarHidden !== "true");
  });
  document.getElementById("btn-inspector").addEventListener("click", () => {
    const app = document.getElementById("app");
    setInspectorOpen(app.dataset.inspectorOpen !== "true");
  });
  document.getElementById("btn-inspector-close").addEventListener("click", () => setInspectorOpen(false));
  document.getElementById("sidebar-backdrop").addEventListener("click", () => setSidebarHidden(true));
  document.getElementById("inspector-backdrop").addEventListener("click", () => setInspectorOpen(false));
}

function renderStateButtons() {
  const host = document.getElementById("state-buttons");
  for (const s of STATES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = s.label;
    btn.addEventListener("click", () => applyState(s.id));
    host.append(btn);
  }
}

function init() {
  mountIcons();
  renderRail("cowork");
  renderConversations();
  renderTree();
  renderTranscript();
  renderInspectorTab("plan");
  bindInspectorTabs();
  bindChrome();
  renderStateButtons();

  const initial = new URLSearchParams(window.location.search).get("state") ?? "cowork-active";
  applyState(STATES.some((s) => s.id === initial) ? initial : "cowork-active");

  window.addEventListener("resize", () => {
    const app = document.getElementById("app");
    if (window.innerWidth <= 900 && app.dataset.sidebarHidden === "false") {
      document.getElementById("sidebar-backdrop").hidden = false;
    }
  });
}

init();

// Screenshot helper hook (used by capture script)
window.__cghcV3Prototype = { applyState, STATES, setInspectorOpen, setSidebarHidden, activateSurface };
