import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import type { RuntimePhase } from "../../conversation-controller.js";
import type { ConversationMessage } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";
import { createClaudePanel, renderClaudePanel, type ClaudePanelDom } from "./claude-panel.js";
import { createCodeExplorer, renderSourceControl, type CodeExplorerDom } from "./code-explorer.js";
import { createSessionBar, type SessionBarConversation, type SessionBarDom } from "../session-bar.js";

/** Center-pane mode: source editor vs runtime preview. */
export type CodeMode = "code" | "preview";
/** Within Preview mode: embedded web preview vs desktop-app launch. */
export type RuntimeMode = "web" | "app";

export interface ClaudeCodeViewDom {
  readonly root: HTMLElement;
  /** Workspace badge in the header. */
  readonly repoChip: HTMLElement;
  /** Runtime status pill in the header (updated by the preview controller). */
  readonly runtimeStatus: HTMLElement;
  readonly explorer: CodeExplorerDom;
  /** Host for the stateful multi-tab editor (mounted by the app shell). */
  readonly editorHost: HTMLElement;
  /** Host the preview controller mounts into (status bar + viewport + output drawer). */
  readonly previewPaneHost: HTMLElement;
  /** Host the desktop-app controller mounts into (status bar + status + output drawer). */
  readonly appPaneHost: HTMLElement;
  readonly modeCode: HTMLButtonElement;
  readonly modePreview: HTMLButtonElement;
  /** Web/App segmented control (visible only in Preview mode). */
  readonly runtimeSegmented: HTMLElement;
  readonly modeWeb: HTMLButtonElement;
  readonly modeApp: HTMLButtonElement;
  readonly panel: ClaudePanelDom;
  readonly panelToggle: HTMLButtonElement;
  /** Session control (#35): new session + pick an existing one, shared with the Cowork session. */
  readonly sessionBar: SessionBarDom;
  mode: CodeMode;
  runtimeMode: RuntimeMode;
}

export interface ClaudeCodeRenderInput {
  readonly workspaceName: string | null;
  readonly reviews: readonly FileReviewArtifact[];
  readonly sessionTitle: string | null;
  readonly messages: readonly ConversationMessage[];
  readonly phase: RuntimePhase;
  readonly composerDisabled: boolean;
  readonly composerDisabledReason: string | null;
  /** Conversations (this workspace) for the session picker (#35). */
  readonly conversations: readonly SessionBarConversation[];
  readonly activeConversationId: string | null;
  /** Disable session controls when no workspace is active. */
  readonly sessionControlsDisabled: boolean;
}

export interface ClaudeCodeHandlers {
  readonly onOpenReview: (review: FileReviewArtifact) => void;
}

export interface ClaudeCodeViewHandlers {
  readonly onSendPrompt: (text: string) => void;
  /** Fired when the user switches the center pane between Code and Preview. */
  readonly onModeChange?: (mode: CodeMode) => void;
  /** Fired when the user switches Preview between Web and Ứng dụng (desktop app). */
  readonly onRuntimeModeChange?: (mode: RuntimeMode) => void;
  /** #35: start a new shared session. */
  readonly onNewSession?: () => void;
  /** #35: switch to an existing conversation. */
  readonly onPickSession?: (conversationId: string) => void;
}

export function createClaudeCodeView(handlers: ClaudeCodeViewHandlers): ClaudeCodeViewDom {
  const root = el("section", "view view--code cc-surface");
  root.dataset["view"] = "code";
  root.hidden = true;

  // --- Compact header: logo + title + workspace badge + runtime status ---
  const header = el("header", "cc-surface__header");
  const titleWrap = el("div", "cc-surface__title-wrap");
  const logoChip = el("span", "cc-surface__logo");
  logoChip.append(icon("code", "Code"));
  const repoChip = el("span", "cc-surface__repo");
  repoChip.append(icon("folder", ""), el("span", "cc-surface__repo-name", "Chưa chọn workspace"));
  const runtimeStatus = el("span", "cc-surface__runtime cc-surface__runtime--idle", "Xem trước: tắt");
  runtimeStatus.setAttribute("role", "status");
  titleWrap.append(logoChip, el("h1", "cc-surface__title", "Code"), repoChip, runtimeStatus);

  // Session control (#35): new session + pick an existing one, from the Code surface itself.
  const sessionBar = createSessionBar({
    onNew: () => handlers.onNewSession?.(),
    onPick: (id) => handlers.onPickSession?.(id),
  });

  const panelToggle = el("button", "cc-surface__panel-toggle") as HTMLButtonElement;
  panelToggle.type = "button";
  panelToggle.setAttribute("aria-label", "Ẩn/hiện panel Agent");
  panelToggle.setAttribute("data-tooltip", "Ẩn/hiện Agent");
  panelToggle.setAttribute("aria-pressed", "false");
  panelToggle.append(icon("sparkle", "Agent"));
  const headerActions = el("div", "cc-surface__header-actions");
  headerActions.append(sessionBar.root, panelToggle);
  header.append(titleWrap, headerActions);

  // --- Body: Explorer | Center (toolbar + editor/preview) | Agent ---
  const explorer = createCodeExplorer();

  const center = el("div", "code-center");
  const toolbar = el("div", "code-center__toolbar");
  const segmented = el("div", "code-mode");
  segmented.setAttribute("role", "tablist");
  segmented.setAttribute("aria-label", "Chế độ hiển thị");
  const modeCode = modeButton("code", "Code", true);
  const modePreview = modeButton("preview", "Xem trước", false);
  segmented.append(modeCode, modePreview);

  // Web / Ứng dụng segmented — only meaningful in Preview mode (hidden otherwise).
  const runtimeSegmented = el("div", "code-mode code-runtime-mode");
  runtimeSegmented.setAttribute("role", "tablist");
  runtimeSegmented.setAttribute("aria-label", "Loại runtime");
  runtimeSegmented.hidden = true;
  const modeWeb = runtimeButton("web", "eye", "Web", true);
  const modeApp = runtimeButton("app", "window", "Ứng dụng", false);
  runtimeSegmented.append(modeWeb, modeApp);
  toolbar.append(segmented, runtimeSegmented);

  const stack = el("div", "code-center__stack");
  const editorHost = el("div", "code-editor-host");
  const previewPaneHost = el("div", "code-preview-host");
  previewPaneHost.hidden = true;
  const appPaneHost = el("div", "code-app-host");
  appPaneHost.hidden = true;
  stack.append(editorHost, previewPaneHost, appPaneHost);
  center.append(toolbar, stack);

  const panel = createClaudePanel({ onSend: handlers.onSendPrompt });

  const body = el("div", "cc-surface__body");
  body.append(explorer.root, center, panel.root);

  root.append(header, body);

  const dom: ClaudeCodeViewDom = {
    root,
    repoChip: repoChip.querySelector(".cc-surface__repo-name") as HTMLElement,
    runtimeStatus,
    explorer,
    editorHost,
    previewPaneHost,
    appPaneHost,
    modeCode,
    modePreview,
    runtimeSegmented,
    modeWeb,
    modeApp,
    panel,
    panelToggle,
    sessionBar,
    mode: "code",
    runtimeMode: "web",
  };

  const applyRuntimePanes = (): void => {
    const preview = dom.mode === "preview";
    const app = preview && dom.runtimeMode === "app";
    previewPaneHost.hidden = !(preview && dom.runtimeMode === "web");
    appPaneHost.hidden = !app;
    runtimeSegmented.hidden = !preview;
  };

  const setMode = (mode: CodeMode): void => {
    if (dom.mode === mode) return;
    dom.mode = mode;
    const preview = mode === "preview";
    editorHost.hidden = preview;
    applyRuntimePanes();
    modeCode.classList.toggle("code-mode__item--active", !preview);
    modePreview.classList.toggle("code-mode__item--active", preview);
    modeCode.setAttribute("aria-selected", preview ? "false" : "true");
    modePreview.setAttribute("aria-selected", preview ? "true" : "false");
    handlers.onModeChange?.(mode);
  };
  modeCode.addEventListener("click", () => setMode("code"));
  modePreview.addEventListener("click", () => setMode("preview"));

  const setRuntimeMode = (mode: RuntimeMode): void => {
    if (dom.runtimeMode === mode) return;
    dom.runtimeMode = mode;
    applyRuntimePanes();
    const app = mode === "app";
    modeWeb.classList.toggle("code-mode__item--active", !app);
    modeApp.classList.toggle("code-mode__item--active", app);
    modeWeb.setAttribute("aria-selected", app ? "false" : "true");
    modeApp.setAttribute("aria-selected", app ? "true" : "false");
    handlers.onRuntimeModeChange?.(mode);
  };
  modeWeb.addEventListener("click", () => setRuntimeMode("web"));
  modeApp.addEventListener("click", () => setRuntimeMode("app"));

  panelToggle.addEventListener("click", () => {
    const collapsed = root.classList.toggle("cc-surface--panel-collapsed");
    panelToggle.setAttribute("aria-pressed", collapsed ? "true" : "false");
  });

  explorer.collapseButton.addEventListener("click", () => {
    const collapsed = root.classList.toggle("cc-surface--explorer-collapsed");
    explorer.collapseButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });

  return dom;
}

function modeButton(mode: CodeMode, label: string, active: boolean): HTMLButtonElement {
  const button = el("button", "code-mode__item") as HTMLButtonElement;
  button.type = "button";
  button.dataset["mode"] = mode;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", active ? "true" : "false");
  button.append(icon(mode === "preview" ? "eye" : "code", ""), el("span", "", label));
  if (active) button.classList.add("code-mode__item--active");
  return button;
}

function runtimeButton(mode: RuntimeMode, iconName: "eye" | "window", label: string, active: boolean): HTMLButtonElement {
  const button = el("button", "code-mode__item") as HTMLButtonElement;
  button.type = "button";
  button.dataset["runtimeMode"] = mode;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", active ? "true" : "false");
  button.append(icon(iconName, ""), el("span", "", label));
  if (active) button.classList.add("code-mode__item--active");
  return button;
}

/** Programmatically set the center mode (used by the app shell / preview handoff). */
export function setCodeMode(dom: ClaudeCodeViewDom, mode: CodeMode): void {
  if (mode === "preview") dom.modePreview.click();
  else dom.modeCode.click();
}

/** Programmatically set the Web/App runtime mode. */
export function setRuntimeMode(dom: ClaudeCodeViewDom, mode: RuntimeMode): void {
  if (mode === "app") dom.modeApp.click();
  else dom.modeWeb.click();
}

export function renderClaudeCodeSurface(
  dom: ClaudeCodeViewDom,
  input: ClaudeCodeRenderInput,
  handlers: ClaudeCodeHandlers,
): void {
  dom.repoChip.textContent = input.workspaceName ?? "Chưa chọn workspace";
  dom.sessionBar.render({
    activeId: input.activeConversationId,
    conversations: input.conversations,
    disabled: input.sessionControlsDisabled,
  });
  renderSourceControl(dom.explorer, input.reviews, handlers.onOpenReview);
  renderClaudePanel(dom.panel, {
    title: input.sessionTitle,
    messages: input.messages,
    phase: input.phase,
    disabled: input.composerDisabled,
    disabledReason: input.composerDisabledReason,
  });
}
