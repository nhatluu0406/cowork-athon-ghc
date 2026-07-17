import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import type { RuntimePhase } from "../../conversation-controller.js";
import type { ConversationMessage } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";
import { createClaudePanel, renderClaudePanel, type ClaudePanelDom } from "./claude-panel.js";
import { createCodeExplorer, renderSourceControl, type CodeExplorerDom } from "./code-explorer.js";

/** Center-pane mode: source editor vs runtime web preview. */
export type CodeMode = "code" | "preview";

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
  readonly modeCode: HTMLButtonElement;
  readonly modePreview: HTMLButtonElement;
  readonly panel: ClaudePanelDom;
  readonly panelToggle: HTMLButtonElement;
  mode: CodeMode;
}

export interface ClaudeCodeRenderInput {
  readonly workspaceName: string | null;
  readonly reviews: readonly FileReviewArtifact[];
  readonly sessionTitle: string | null;
  readonly messages: readonly ConversationMessage[];
  readonly phase: RuntimePhase;
  readonly composerDisabled: boolean;
  readonly composerDisabledReason: string | null;
}

export interface ClaudeCodeHandlers {
  readonly onOpenReview: (review: FileReviewArtifact) => void;
}

export interface ClaudeCodeViewHandlers {
  readonly onSendPrompt: (text: string) => void;
  /** Fired when the user switches the center pane between Code and Preview. */
  readonly onModeChange?: (mode: CodeMode) => void;
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
  const runtimeStatus = el("span", "cc-surface__runtime cc-surface__runtime--idle", "Preview: tắt");
  runtimeStatus.setAttribute("role", "status");
  titleWrap.append(logoChip, el("h1", "cc-surface__title", "Code"), repoChip, runtimeStatus);

  const panelToggle = el("button", "cc-surface__panel-toggle") as HTMLButtonElement;
  panelToggle.type = "button";
  panelToggle.setAttribute("aria-label", "Ẩn/hiện panel Agent");
  panelToggle.setAttribute("data-tooltip", "Ẩn/hiện Agent");
  panelToggle.setAttribute("aria-pressed", "false");
  panelToggle.append(icon("sparkle", "Agent"));
  header.append(titleWrap, panelToggle);

  // --- Body: Explorer | Center (toolbar + editor/preview) | Agent ---
  const explorer = createCodeExplorer();

  const center = el("div", "code-center");
  const toolbar = el("div", "code-center__toolbar");
  const segmented = el("div", "code-mode");
  segmented.setAttribute("role", "tablist");
  segmented.setAttribute("aria-label", "Chế độ hiển thị");
  const modeCode = modeButton("code", "Code", true);
  const modePreview = modeButton("preview", "Preview", false);
  segmented.append(modeCode, modePreview);
  toolbar.append(segmented);

  const stack = el("div", "code-center__stack");
  const editorHost = el("div", "code-editor-host");
  const previewPaneHost = el("div", "code-preview-host");
  previewPaneHost.hidden = true;
  stack.append(editorHost, previewPaneHost);
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
    modeCode,
    modePreview,
    panel,
    panelToggle,
    mode: "code",
  };

  const setMode = (mode: CodeMode): void => {
    if (dom.mode === mode) return;
    dom.mode = mode;
    const preview = mode === "preview";
    editorHost.hidden = preview;
    previewPaneHost.hidden = !preview;
    modeCode.classList.toggle("code-mode__item--active", !preview);
    modePreview.classList.toggle("code-mode__item--active", preview);
    modeCode.setAttribute("aria-selected", preview ? "false" : "true");
    modePreview.setAttribute("aria-selected", preview ? "true" : "false");
    handlers.onModeChange?.(mode);
  };
  modeCode.addEventListener("click", () => setMode("code"));
  modePreview.addEventListener("click", () => setMode("preview"));

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

/** Programmatically set the center mode (used by the app shell / preview handoff). */
export function setCodeMode(dom: ClaudeCodeViewDom, mode: CodeMode): void {
  if (mode === "preview") dom.modePreview.click();
  else dom.modeCode.click();
}

export function renderClaudeCodeSurface(
  dom: ClaudeCodeViewDom,
  input: ClaudeCodeRenderInput,
  handlers: ClaudeCodeHandlers,
): void {
  dom.repoChip.textContent = input.workspaceName ?? "Chưa chọn workspace";
  renderSourceControl(dom.explorer, input.reviews, handlers.onOpenReview);
  renderClaudePanel(dom.panel, {
    title: input.sessionTitle,
    messages: input.messages,
    phase: input.phase,
    disabled: input.composerDisabled,
    disabledReason: input.composerDisabledReason,
  });
}
