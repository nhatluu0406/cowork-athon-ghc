/**
 * Runtime preview controller (Code surface, renderer side).
 *
 * Owns the Preview pane: a status bar (project kind + status pill + Start/Stop/Restart/Reload),
 * a viewport the shell's hardened WebContentsView floats over, contextual overlays
 * (idle/starting/failed/unsupported), and a collapsible Output drawer. It NEVER spawns anything
 * — it drives the loopback service (`ServiceClient`) and asks the shell to embed the loopback URL.
 * A dev-server launch shows an explicit Allow/Deny confirm; the service still enforces the
 * permission server-side.
 */

import type {
  CoworkShellBridge,
  RuntimePreviewOutputLine,
  RuntimePreviewProjectInfo,
  RuntimePreviewState,
} from "@cowork-ghc/contracts";
import type { ServiceClient } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";
import { renderProblems } from "./problems-view.js";

export interface PreviewControllerCallbacks {
  /** Called when the confirmed loopback preview URL appears/disappears (for Agent context). */
  readonly onPreviewUrlChange?: (url: string | null) => void;
  /** Return true when a modal/permission dialog would be occluded by the floating view. */
  readonly isObstructed?: () => boolean;
}

export interface PreviewController {
  readonly root: HTMLElement;
  /** Preview mode is visible on the Code surface (start geometry sync + show the view). */
  setActive(active: boolean): void;
  /** Re-detect capability (workspace opened/changed). */
  refreshDetect(): void;
  /** Stop polling + hide the view; clear transient state (workspace change / surface reset). */
  reset(): void;
  dispose(): void;
  getPreviewUrl(): string | null;
}

const POLL_MS = 1200;

export function mountPreviewController(
  host: HTMLElement,
  client: ServiceClient,
  shell: CoworkShellBridge,
  callbacks: PreviewControllerCallbacks = {},
): PreviewController {
  host.classList.add("code-preview");

  // --- Status bar ---
  const statusBar = el("div", "code-preview__bar");
  const kindLabel = el("span", "code-preview__kind", "Xem trước");
  const statusPill = el("span", "code-preview__status code-preview__status--idle", "Tắt");
  const scriptSelect = el("select", "code-preview__script") as HTMLSelectElement;
  scriptSelect.setAttribute("aria-label", "Chọn script dev server");
  scriptSelect.hidden = true;
  const spacer = el("span", "code-preview__spacer");
  const startBtn = actionButton("play", "Chạy preview", "Chạy");
  const stopBtn = actionButton("stop", "Dừng preview", "Dừng");
  const restartBtn = actionButton("refresh", "Khởi động lại", "Khởi động lại");
  const reloadBtn = actionButton("refresh", "Tải lại trang", "Tải lại");
  statusBar.append(kindLabel, statusPill, scriptSelect, spacer, startBtn, stopBtn, restartBtn, reloadBtn);

  // --- Viewport (the WebContentsView floats over this) + overlay ---
  const viewport = el("div", "code-preview__viewport");
  const overlay = el("div", "code-preview__overlay");
  viewport.append(overlay);

  // --- Output drawer ---
  const drawer = el("div", "code-preview__drawer");
  const drawerHead = el("div", "code-preview__drawer-head");
  const tabOutput = drawerTab("Kết quả", true);
  const tabProblems = drawerTab("Vấn đề", false);
  const drawerToggle = el("button", "code-preview__drawer-toggle") as HTMLButtonElement;
  drawerToggle.type = "button";
  drawerToggle.setAttribute("aria-expanded", "true");
  drawerToggle.textContent = "▾";
  drawerHead.append(tabOutput, tabProblems, el("span", "code-preview__spacer"), drawerToggle);
  const outputBody = el("pre", "code-preview__output");
  outputBody.setAttribute("aria-live", "polite");
  const problemsBody = el("div", "code-preview__problems");
  problemsBody.append(el("div", "code-preview__problems-empty", "Không có vấn đề nào."));
  problemsBody.hidden = true;
  drawer.append(drawerHead, outputBody, problemsBody);

  host.replaceChildren(statusBar, viewport, drawer);

  // --- State ---
  let active = false;
  let disposed = false;
  let info: RuntimePreviewProjectInfo | null = null;
  let state: RuntimePreviewState = emptyState();
  let lastSeq = 0;
  let loadedUrl: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let confirmOpen = false;
  // Accumulated captured output, reduced to the "Vấn đề" (Problems) tab (redacted upstream).
  const outputLines: RuntimePreviewOutputLine[] = [];

  function emptyState(): RuntimePreviewState {
    return { status: "idle", kind: null, url: null, port: null, command: null, startedAt: null, error: null, outputSeq: 0 };
  }

  function obstructed(): boolean {
    return confirmOpen || callbacks.isObstructed?.() === true;
  }

  function syncBounds(): void {
    if (disposed) return;
    const rect = viewport.getBoundingClientRect();
    const visible = active && state.status === "running" && loadedUrl !== null && !obstructed();
    void shell.previewSetBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      visible,
    });
  }

  function renderStatus(): void {
    const s = state.status;
    statusPill.className = `code-preview__status code-preview__status--${s}`;
    statusPill.textContent =
      s === "running" ? "Đang chạy" : s === "starting" ? "Đang khởi động…" : s === "failed" ? "Lỗi" : s === "stopped" ? "Đã dừng" : "Tắt";
    kindLabel.textContent =
      state.kind === "dev-server" ? (state.command ?? "Dev server") : state.kind === "static" ? "Static" : "Xem trước";

    const busy = s === "starting";
    const running = s === "running";
    startBtn.hidden = running || busy;
    stopBtn.hidden = !(running || busy);
    restartBtn.hidden = !(running || s === "failed" || s === "stopped");
    reloadBtn.hidden = !running;
    startBtn.disabled = info?.kind === "unsupported" || info === null;

    // Overlay: only shown when NOT running (the live view covers the viewport when running).
    overlay.hidden = running;
    if (!running) renderOverlay();
    // Header status pill mirror.
    updateHeaderRuntime();
  }

  function renderOverlay(): void {
    overlay.replaceChildren();
    const s = state.status;
    if (s === "failed") {
      overlay.append(overlayCard("info", "Xem trước lỗi", state.error ?? "Không rõ nguyên nhân."));
      return;
    }
    if (s === "starting") {
      overlay.append(overlayCard("refresh", "Đang khởi động…", "Đang chờ dev server báo localhost."));
      return;
    }
    if (info?.kind === "unsupported") {
      overlay.append(
        overlayCard("info", "Chưa xem trước được", info.reason ?? "Dự án không có index.html hoặc dev script."),
      );
      return;
    }
    const hint =
      info?.kind === "dev-server"
        ? "Bấm Chạy để khởi động dev server và xem trước trong app."
        : info?.kind === "static"
          ? "Bấm Chạy để phục vụ index.html tĩnh và xem trước."
          : "Chọn workspace là dự án web để xem trước.";
    overlay.append(overlayCard("eye", "Xem trước web", hint));
  }

  function updateHeaderRuntime(): void {
    // The header pill element lives outside this host; find it once via the surface root.
    const surface = host.closest(".cc-surface");
    const pill = surface?.querySelector<HTMLElement>(".cc-surface__runtime");
    if (pill === null || pill === undefined) return;
    const s = state.status;
    pill.className = `cc-surface__runtime cc-surface__runtime--${s}`;
    pill.textContent =
      s === "running" && state.port !== null
        ? `Xem trước: :${state.port}`
        : s === "starting"
          ? "Xem trước: đang khởi động"
          : s === "failed"
            ? "Xem trước: lỗi"
            : "Xem trước: tắt";
  }

  function appendOutput(lines: readonly RuntimePreviewOutputLine[]): void {
    for (const line of lines) {
      const row = el("span", `code-preview__line code-preview__line--${line.stream}`, line.text + "\n");
      outputBody.append(row);
      outputLines.push(line);
      lastSeq = Math.max(lastSeq, line.seq);
    }
    if (lines.length > 0) {
      outputBody.scrollTop = outputBody.scrollHeight;
      renderProblems(problemsBody, tabProblems, outputLines);
    }
  }

  async function applyRunningTransition(): Promise<void> {
    if (state.status === "running" && state.url !== null) {
      if (loadedUrl !== state.url) {
        const result = await shell.previewLoad(state.url);
        if (result.ok) {
          loadedUrl = state.url;
          callbacks.onPreviewUrlChange?.(state.url);
        }
      }
      syncBounds();
    } else if (loadedUrl !== null) {
      loadedUrl = null;
      callbacks.onPreviewUrlChange?.(null);
      void shell.previewHide();
    }
  }

  async function poll(): Promise<void> {
    if (disposed) return;
    try {
      const out = await client.getRuntimePreviewOutput(lastSeq);
      state = out.state;
      appendOutput(out.lines);
      renderStatus();
      await applyRunningTransition();
    } catch {
      // transient; keep last state
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

  // Reset the captured-output view for a NEW run. The service resets its output sequence to 0 on
  // every (re)start (output-buffer.clear), so the renderer MUST drop its stale `lastSeq` and clear
  // the drawer/problems too — otherwise `since(lastSeq)` returns nothing and the second run's output
  // (and any parsed problems) never appear.
  function resetOutputView(): void {
    lastSeq = 0;
    outputBody.replaceChildren();
    outputLines.length = 0;
    renderProblems(problemsBody, tabProblems, outputLines);
  }

  // --- Actions ---
  // Every (re)start STOPS the poller for the whole handshake first: otherwise a poll tick landing
  // during the permission prompt (or the restart round-trip) would re-fetch the PREVIOUS run's still-
  // buffered output and push `lastSeq` forward again, so the new run's early lines (incl. a build
  // error) would be skipped once the service clears + restarts its sequence at 0. Polling only
  // resumes AFTER the service has actually started the new run, with the cursor reset to 0.
  async function doStart(): Promise<void> {
    if (info === null) await refreshDetect();
    if (info === null || info.kind === "unsupported") return;
    stopPolling();
    resetOutputView();
    if (info.kind === "static") {
      state = await client.startStaticPreview();
      renderStatus();
      await applyRunningTransition();
      startPolling();
      return;
    }
    // dev-server → explicit permission confirm.
    const script = scriptSelect.hidden ? info.devScripts[0]! : scriptSelect.value || info.devScripts[0]!;
    let requested: { requestId: string; command: string; cwd: string };
    try {
      requested = await client.requestPreviewLaunch({
        kind: "dev-server",
        script,
        ...(info.packageManager !== null ? { packageManager: info.packageManager } : {}),
      });
    } catch (err) {
      state = { ...state, status: "failed", error: (err as Error).message };
      renderStatus();
      return;
    }
    const decision = await askLaunchPermission(requested.command, requested.cwd);
    state = await client.resolvePreviewLaunch(requested.requestId, decision);
    // The service has now cleared + (on allow) started the new run at seq 0; resync the cursor so the
    // first poll fetches the new run from the beginning (it may have re-buffered during the prompt).
    resetOutputView();
    renderStatus();
    await applyRunningTransition();
    startPolling();
  }

  async function doStop(): Promise<void> {
    stopPolling();
    state = await client.stopRuntimePreview();
    loadedUrl = null;
    callbacks.onPreviewUrlChange?.(null);
    void shell.previewHide();
    renderStatus();
  }

  async function doRestart(): Promise<void> {
    stopPolling();
    resetOutputView();
    state = await client.restartRuntimePreview();
    // Re-clear the cursor after the round-trip: the service restarted its sequence at 0.
    resetOutputView();
    loadedUrl = null;
    renderStatus();
    await applyRunningTransition();
    startPolling();
  }

  function askLaunchPermission(command: string, cwd: string): Promise<"allow" | "deny"> {
    confirmOpen = true;
    void shell.previewHide();
    return new Promise<"allow" | "deny">((resolve) => {
      const backdrop = el("div", "code-confirm__overlay");
      const dialog = el("div", "code-confirm");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.append(
        el("h2", "code-confirm__title", "Chạy lệnh preview?"),
        el("p", "code-confirm__message", `Cho phép chạy \`${command}\` trong thư mục workspace (${cwd})? Chỉ chạy khi bạn đồng ý.`),
      );
      const actions = el("div", "code-confirm__actions");
      const deny = el("button", "code-confirm__btn", "Từ chối") as HTMLButtonElement;
      const allow = el("button", "code-confirm__btn code-confirm__btn--primary", "Cho phép chạy") as HTMLButtonElement;
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
      info = await client.detectRuntimePreview();
    } catch {
      info = null;
    }
    if (info !== null && info.kind === "dev-server" && info.devScripts.length > 1) {
      scriptSelect.replaceChildren(
        ...info.devScripts.map((s) => {
          const opt = document.createElement("option");
          opt.value = s;
          opt.textContent = s;
          return opt;
        }),
      );
      scriptSelect.hidden = false;
    } else {
      scriptSelect.hidden = true;
    }
    renderStatus();
  }

  startBtn.addEventListener("click", () => void doStart());
  stopBtn.addEventListener("click", () => void doStop());
  restartBtn.addEventListener("click", () => void doRestart());
  reloadBtn.addEventListener("click", () => void shell.previewReload());
  tabOutput.addEventListener("click", () => switchDrawerTab(true));
  tabProblems.addEventListener("click", () => switchDrawerTab(false));
  drawerToggle.addEventListener("click", () => {
    const collapsed = host.classList.toggle("code-preview--drawer-collapsed");
    drawerToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    drawerToggle.textContent = collapsed ? "▸" : "▾";
    syncBounds();
  });

  function switchDrawerTab(showOutput: boolean): void {
    tabOutput.classList.toggle("code-preview__drawer-tab--active", showOutput);
    tabProblems.classList.toggle("code-preview__drawer-tab--active", !showOutput);
    outputBody.hidden = !showOutput;
    problemsBody.hidden = showOutput;
  }

  const resizeObserver =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => syncBounds()) : null;
  resizeObserver?.observe(viewport);
  const onWindowResize = (): void => syncBounds();
  window.addEventListener("resize", onWindowResize);

  renderStatus();

  return {
    root: host,
    setActive(next: boolean) {
      const wasActive = active;
      active = next;
      if (next) {
        // Re-detect on (re)entry into Preview: the active workspace or its files may have changed
        // since we last looked (e.g. a package.json / index.html was added), so a cached
        // "unsupported" must not stick. Skip only redundant same-state calls while already active.
        if (info === null || !wasActive) void refreshDetect();
        startPolling();
      } else {
        stopPolling();
      }
      // syncBounds computes visibility from active/running/obstructed — hides when inactive.
      syncBounds();
    },
    refreshDetect() {
      void refreshDetect();
    },
    reset() {
      stopPolling();
      void shell.previewHide();
      loadedUrl = null;
      lastSeq = 0;
      info = null;
      state = emptyState();
      outputBody.replaceChildren();
      outputLines.length = 0;
      renderProblems(problemsBody, tabProblems, outputLines);
      callbacks.onPreviewUrlChange?.(null);
      renderStatus();
    },
    dispose() {
      disposed = true;
      stopPolling();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      void shell.previewClose();
    },
    getPreviewUrl() {
      return state.status === "running" ? state.url : null;
    },
  };
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

function overlayCard(iconName: Parameters<typeof icon>[0], title: string, copy: string): HTMLElement {
  const card = el("div", "code-preview__overlay-card");
  const tile = el("span", "code-preview__overlay-icon");
  tile.append(icon(iconName, ""));
  card.append(tile, el("p", "code-preview__overlay-title", title), el("p", "code-preview__overlay-copy", copy));
  return card;
}
