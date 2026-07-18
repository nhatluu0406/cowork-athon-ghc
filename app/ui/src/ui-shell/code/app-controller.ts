/**
 * Desktop-app launch controller (Code surface, renderer side — Slice 2).
 *
 * Owns the "Ứng dụng" pane: a status bar (project/script + status pill + Build/Run/Stop/Restart),
 * a status card (idle/building/starting/running/failed/unsupported with elapsed time when running),
 * and the shared Output drawer. It NEVER spawns anything and NEVER embeds the app — a desktop app
 * launches as its OWN separate window/process; this pane only drives the loopback service
 * (`ServiceClient`) and shows honest status + redacted output. Build/Run each show an explicit
 * Allow/Deny confirm; the service still enforces the permission server-side.
 */

import type {
  RuntimeAppProjectInfo,
  RuntimeAppState,
  RuntimePreviewOutputLine,
} from "@cowork-ghc/contracts";
import type { ServiceClient } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";

export interface AppControllerCallbacks {
  /** Return true when a modal/permission dialog would obstruct the pane. */
  readonly isObstructed?: () => boolean;
}

export interface AppController {
  readonly root: HTMLElement;
  /** App mode is visible on the Code surface (start polling). */
  setActive(active: boolean): void;
  /** Re-detect capability (workspace opened/changed). */
  refreshDetect(): void;
  /** Stop polling + clear transient state (workspace change / surface reset). */
  reset(): void;
  dispose(): void;
}

const POLL_MS = 1200;

export function mountAppController(
  host: HTMLElement,
  client: ServiceClient,
  callbacks: AppControllerCallbacks = {},
): AppController {
  host.classList.add("code-preview", "code-app");

  // --- Status bar (reuses the preview pane's bar styling) ---
  const statusBar = el("div", "code-preview__bar");
  const kindLabel = el("span", "code-preview__kind", "Ứng dụng");
  const statusPill = el("span", "code-preview__status code-preview__status--idle", "Đã dừng");
  const buildSelect = selectEl("Chọn script build");
  const runSelect = selectEl("Chọn script chạy app");
  const spacer = el("span", "code-preview__spacer");
  const buildBtn = actionButton("refresh", "Build ứng dụng", "Build");
  const runBtn = actionButton("play", "Chạy ứng dụng", "Chạy");
  const stopBtn = actionButton("stop", "Dừng ứng dụng", "Dừng");
  const restartBtn = actionButton("refresh", "Khởi động lại", "Khởi động lại");
  statusBar.append(kindLabel, statusPill, buildSelect, runSelect, spacer, buildBtn, runBtn, stopBtn, restartBtn);

  // --- Status card (no embedded view — the app runs in its own window) ---
  const viewport = el("div", "code-preview__viewport");
  const overlay = el("div", "code-preview__overlay");
  overlay.hidden = false;
  viewport.append(overlay);

  // --- Output drawer (shared visual with the web preview) ---
  const drawer = el("div", "code-preview__drawer");
  const drawerHead = el("div", "code-preview__drawer-head");
  const tabOutput = drawerTab("Output", true);
  const tabProblems = drawerTab("Problems", false);
  const drawerToggle = el("button", "code-preview__drawer-toggle") as HTMLButtonElement;
  drawerToggle.type = "button";
  drawerToggle.setAttribute("aria-expanded", "true");
  drawerToggle.textContent = "▾";
  drawerHead.append(tabOutput, tabProblems, el("span", "code-preview__spacer"), drawerToggle);
  const outputBody = el("pre", "code-preview__output");
  outputBody.setAttribute("aria-live", "polite");
  const problemsBody = el("div", "code-preview__problems", "Không có problem nào (Slice 2 chưa có phân tích lỗi).");
  problemsBody.hidden = true;
  drawer.append(drawerHead, outputBody, problemsBody);

  host.replaceChildren(statusBar, viewport, drawer);

  // --- State ---
  let active = false;
  let disposed = false;
  let info: RuntimeAppProjectInfo | null = null;
  let state: RuntimeAppState = emptyState();
  let lastSeq = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let confirmOpen = false;

  function emptyState(): RuntimeAppState {
    return { status: "stopped", kind: null, action: null, command: null, script: null, startedAt: null, error: null, exitCode: null, outputSeq: 0 };
  }

  function busy(): boolean {
    return state.status === "building" || state.status === "starting" || state.status === "running" || state.status === "stopping";
  }

  function renderStatus(): void {
    const s = state.status;
    statusPill.className = `code-preview__status code-preview__status--${appPillClass(s)}`;
    statusPill.textContent = appStatusLabel(s);
    kindLabel.textContent = state.command ?? (info?.kind === "electron" ? "Ứng dụng Electron" : "Ứng dụng");

    const unsupported = info?.kind === "unsupported" || info === null;
    const hasBuild = (info?.buildScripts.length ?? 0) > 0;
    const running = s === "running";
    const idle = s === "stopped" || s === "failed";

    buildBtn.hidden = !hasBuild || busy();
    buildBtn.disabled = unsupported;
    runBtn.hidden = busy();
    runBtn.disabled = unsupported;
    stopBtn.hidden = !busy();
    restartBtn.hidden = !(running || (idle && state.action === "run"));
    restartBtn.disabled = unsupported;

    // Script selectors only when there is a real choice.
    populateSelect(buildSelect, info?.buildScripts ?? []);
    populateSelect(runSelect, info?.runScripts ?? []);

    renderOverlay();
    updateHeaderRuntime();
  }

  function renderOverlay(): void {
    overlay.replaceChildren();
    const s = state.status;
    if (s === "failed") {
      overlay.append(card("info", "Ứng dụng lỗi", state.error ?? "Không rõ nguyên nhân."));
      return;
    }
    if (s === "building") {
      overlay.append(card("refresh", "Đang build…", state.command ?? "Đang chạy script build."));
      return;
    }
    if (s === "starting") {
      overlay.append(card("refresh", "Đang khởi động…", "Đang mở cửa sổ ứng dụng."));
      return;
    }
    if (s === "stopping") {
      overlay.append(card("stop", "Đang dừng…", "Đang dừng toàn bộ tiến trình ứng dụng."));
      return;
    }
    if (s === "running") {
      const elapsed = elapsedText(state.startedAt);
      overlay.append(
        card(
          "window",
          elapsed !== null ? `Đang chạy • ${elapsed}` : "Đang chạy",
          "Ứng dụng mở trong cửa sổ riêng (không nhúng trong Cowork). Dùng Dừng để tắt toàn bộ tiến trình.",
        ),
      );
      return;
    }
    if (info?.kind === "unsupported") {
      overlay.append(card("info", "Chưa chạy được ứng dụng", info.reason ?? "Dự án không phải app Electron có script chạy."));
      return;
    }
    overlay.append(card("window", "Ứng dụng desktop", "Bấm Chạy để khởi động ứng dụng trong cửa sổ riêng. Build nếu dự án cần bước biên dịch trước."));
  }

  function updateHeaderRuntime(): void {
    const surface = host.closest(".cc-surface");
    const pill = surface?.querySelector<HTMLElement>(".cc-surface__runtime");
    if (pill === null || pill === undefined) return;
    const s = state.status;
    pill.className = `cc-surface__runtime cc-surface__runtime--${appPillClass(s)}`;
    pill.textContent =
      s === "running" ? "App: đang chạy" : s === "building" ? "App: đang build" : s === "starting" ? "App: khởi động" : s === "failed" ? "App: lỗi" : "App: tắt";
  }

  function appendOutput(lines: readonly RuntimePreviewOutputLine[]): void {
    for (const line of lines) {
      outputBody.append(el("span", `code-preview__line code-preview__line--${line.stream}`, line.text + "\n"));
      lastSeq = Math.max(lastSeq, line.seq);
    }
    if (lines.length > 0) outputBody.scrollTop = outputBody.scrollHeight;
  }

  async function poll(): Promise<void> {
    if (disposed) return;
    try {
      const out = await client.getRuntimeAppOutput(lastSeq);
      state = out.state;
      appendOutput(out.lines);
      renderStatus();
    } catch {
      /* transient */
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => void poll(), POLL_MS);
    void poll();
  }
  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function launch(action: "build" | "run"): Promise<void> {
    if (info === null) await refreshDetect();
    if (info === null || info.kind === "unsupported") return;
    const list = action === "build" ? info.buildScripts : info.runScripts;
    if (list.length === 0) return;
    const select = action === "build" ? buildSelect : runSelect;
    const script = select.hidden ? list[0]! : select.value || list[0]!;
    let requested: { requestId: string; action: "build" | "run"; command: string; cwd: string };
    try {
      requested = await client.requestAppLaunch({
        action,
        script,
        ...(info.packageManager !== null ? { packageManager: info.packageManager } : {}),
      });
    } catch (err) {
      state = { ...state, status: "failed", error: (err as Error).message };
      renderStatus();
      return;
    }
    const decision = await askLaunchPermission(action, requested.command, requested.cwd);
    state = await client.resolveAppLaunch(requested.requestId, decision);
    renderStatus();
    startPolling();
  }

  async function doStop(): Promise<void> {
    state = await client.stopRuntimeApp();
    renderStatus();
  }

  async function doRestart(): Promise<void> {
    state = await client.restartRuntimeApp();
    renderStatus();
    startPolling();
  }

  function askLaunchPermission(action: "build" | "run", command: string, cwd: string): Promise<"allow" | "deny"> {
    confirmOpen = true;
    return new Promise<"allow" | "deny">((resolve) => {
      const backdrop = el("div", "code-confirm__overlay");
      const dialog = el("div", "code-confirm");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      const verb = action === "build" ? "Build" : "Chạy";
      dialog.append(
        el("h2", "code-confirm__title", `${verb} ứng dụng desktop?`),
        el(
          "p",
          "code-confirm__message",
          `Cho phép chạy \`${command}\` trong thư mục workspace (${cwd})? ${action === "run" ? "Ứng dụng sẽ mở trong cửa sổ riêng. " : ""}Chỉ chạy khi bạn đồng ý.`,
        ),
      );
      const actions = el("div", "code-confirm__actions");
      const deny = el("button", "code-confirm__btn", "Từ chối") as HTMLButtonElement;
      const allow = el("button", "code-confirm__btn code-confirm__btn--primary", `Cho phép ${verb.toLowerCase()}`) as HTMLButtonElement;
      deny.type = "button";
      allow.type = "button";
      actions.append(deny, allow);
      dialog.append(actions);
      backdrop.append(dialog);
      document.body.append(backdrop);
      allow.focus();

      const close = (choice: "allow" | "deny"): void => {
        backdrop.remove();
        confirmOpen = false;
        resolve(choice);
      };
      deny.addEventListener("click", () => close("deny"));
      allow.addEventListener("click", () => close("allow"));
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close("deny");
      });
      dialog.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close("deny");
      });
    });
  }

  async function refreshDetect(): Promise<void> {
    try {
      info = await client.detectRuntimeApp();
    } catch {
      info = null;
    }
    renderStatus();
  }

  buildBtn.addEventListener("click", () => void launch("build"));
  runBtn.addEventListener("click", () => void launch("run"));
  stopBtn.addEventListener("click", () => void doStop());
  restartBtn.addEventListener("click", () => void doRestart());
  tabOutput.addEventListener("click", () => switchDrawerTab(true));
  tabProblems.addEventListener("click", () => switchDrawerTab(false));
  drawerToggle.addEventListener("click", () => {
    const collapsed = host.classList.toggle("code-preview--drawer-collapsed");
    drawerToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    drawerToggle.textContent = collapsed ? "▸" : "▾";
  });

  function switchDrawerTab(showOutput: boolean): void {
    tabOutput.classList.toggle("code-preview__drawer-tab--active", showOutput);
    tabProblems.classList.toggle("code-preview__drawer-tab--active", !showOutput);
    outputBody.hidden = !showOutput;
    problemsBody.hidden = showOutput;
  }

  // `confirmOpen`/obstruction is reserved for parity with the preview pane; the app pane has no
  // floating view to hide, so it only affects the confirm flow.
  void callbacks.isObstructed;
  void confirmOpen;

  renderStatus();

  return {
    root: host,
    setActive(next: boolean) {
      active = next;
      if (next) {
        if (info === null) void refreshDetect();
        startPolling();
      } else {
        stopPolling();
      }
    },
    refreshDetect() {
      void refreshDetect();
    },
    reset() {
      stopPolling();
      lastSeq = 0;
      info = null;
      state = emptyState();
      outputBody.replaceChildren();
      renderStatus();
    },
    dispose() {
      disposed = true;
      stopPolling();
    },
  };

  function populateSelect(select: HTMLSelectElement, scripts: readonly string[]): void {
    if (scripts.length <= 1) {
      select.hidden = true;
      return;
    }
    if (select.options.length !== scripts.length) {
      select.replaceChildren(
        ...scripts.map((s) => {
          const opt = document.createElement("option");
          opt.value = s;
          opt.textContent = s;
          return opt;
        }),
      );
    }
    select.hidden = false;
  }
}

function appPillClass(status: RuntimeAppState["status"]): string {
  switch (status) {
    case "running":
      return "running";
    case "building":
    case "starting":
    case "stopping":
      return "starting";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

function appStatusLabel(status: RuntimeAppState["status"]): string {
  switch (status) {
    case "running":
      return "Đang chạy";
    case "building":
      return "Đang build…";
    case "starting":
      return "Đang khởi động…";
    case "stopping":
      return "Đang dừng…";
    case "failed":
      return "Lỗi";
    default:
      return "Đã dừng";
  }
}

/** mm:ss elapsed since an ISO start time, or null when unavailable/invalid. */
function elapsedText(startedAt: string | null): string | null {
  if (startedAt === null) return null;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return null;
  const secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function selectEl(label: string): HTMLSelectElement {
  const select = el("select", "code-preview__script") as HTMLSelectElement;
  select.setAttribute("aria-label", label);
  select.hidden = true;
  return select;
}

function actionButton(iconName: Parameters<typeof icon>[0], tooltip: string, label: string): HTMLButtonElement {
  const button = el("button", "code-preview__action") as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("aria-label", tooltip);
  button.setAttribute("data-tooltip", tooltip);
  button.append(icon(iconName, label), el("span", "code-preview__action-label", label));
  return button;
}

function drawerTab(label: string, active: boolean): HTMLButtonElement {
  const button = el("button", "code-preview__drawer-tab", label) as HTMLButtonElement;
  button.type = "button";
  if (active) button.classList.add("code-preview__drawer-tab--active");
  return button;
}

function card(iconName: Parameters<typeof icon>[0], title: string, copy: string): HTMLElement {
  const el2 = el("div", "code-preview__overlay-card");
  const tile = el("span", "code-preview__overlay-icon");
  tile.append(icon(iconName, ""));
  el2.append(tile, el("p", "code-preview__overlay-title", title), el("p", "code-preview__overlay-copy", copy));
  return el2;
}
