import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import type { RuntimePhase } from "../../conversation-controller.js";
import type { ConversationMessage } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";
import { createClaudePanel, renderClaudePanel, type ClaudePanelDom } from "./claude-panel.js";
import { createCodeEditor, renderCodeEditor, type CodeEditorDom, type OpenCodeFile } from "./code-editor.js";
import { createCodeExplorer, renderSourceControl, type CodeExplorerDom } from "./code-explorer.js";
import { createCodeOnboarding } from "./code-onboarding.js";

export type CodeTab = "session" | "onboarding";

export interface ClaudeCodeViewDom {
  readonly root: HTMLElement;
  readonly repoChip: HTMLElement;
  readonly explorer: CodeExplorerDom;
  readonly editor: CodeEditorDom;
  readonly panel: ClaudePanelDom;
  readonly sessionBody: HTMLElement;
  readonly onboardingBody: HTMLElement;
  codeTab: CodeTab;
}

export interface ClaudeCodeRenderInput {
  readonly workspaceName: string | null;
  readonly reviews: readonly FileReviewArtifact[];
  readonly openFiles: readonly OpenCodeFile[];
  readonly activeKey: string | null;
  readonly sessionTitle: string | null;
  readonly messages: readonly ConversationMessage[];
  readonly phase: RuntimePhase;
  readonly composerDisabled: boolean;
  readonly composerDisabledReason: string | null;
}

export interface ClaudeCodeHandlers {
  readonly onSelectTab: (key: string) => void;
  readonly onCloseTab: (key: string) => void;
  readonly onOpenReview: (review: FileReviewArtifact) => void;
  readonly onLoadFile: (relativePath: string, body: HTMLElement) => void;
}

export function createClaudeCodeView(handlers: { readonly onSendPrompt: (text: string) => void }): ClaudeCodeViewDom {
  const root = el("section", "view view--code cc-surface");
  root.dataset["view"] = "code";
  root.hidden = true;

  const header = el("header", "cc-surface__header");
  const titleWrap = el("div", "cc-surface__title-wrap");
  const logoChip = el("span", "cc-surface__logo");
  logoChip.append(icon("code", "Claude Code"));
  const repoChip = el("span", "cc-surface__repo");
  titleWrap.append(logoChip, el("h1", "cc-surface__title", "Claude Code"), repoChip);
  const segmented = el("div", "cc-segmented");
  segmented.setAttribute("role", "tablist");
  segmented.setAttribute("aria-label", "Chế độ Claude Code");
  const tabSession = segButton("Phiên làm việc", true);
  const tabHow = segButton("Cách hoạt động", false);
  segmented.append(tabSession, tabHow);
  header.append(titleWrap, segmented);

  const explorer = createCodeExplorer();
  const editor = createCodeEditor();
  const panel = createClaudePanel({ onSend: handlers.onSendPrompt });
  const sessionBody = el("div", "cc-surface__session");
  sessionBody.append(explorer.root, editor.root, panel.root);

  const onboardingBody = el("div", "cc-surface__onboarding");
  onboardingBody.hidden = true;

  root.append(header, sessionBody, onboardingBody);
  const dom: ClaudeCodeViewDom = { root, repoChip, explorer, editor, panel, sessionBody, onboardingBody, codeTab: "session" };

  onboardingBody.append(
    createCodeOnboarding(() => selectTab(dom, tabSession, tabHow, "session")),
  );
  tabSession.addEventListener("click", () => selectTab(dom, tabSession, tabHow, "session"));
  tabHow.addEventListener("click", () => selectTab(dom, tabSession, tabHow, "onboarding"));

  explorer.collapseButton.addEventListener("click", () => {
    root.classList.toggle("cc-surface--explorer-collapsed");
    const collapsed = root.classList.contains("cc-surface--explorer-collapsed");
    explorer.collapseButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });

  return dom;
}

function segButton(label: string, active: boolean): HTMLButtonElement {
  const button = el("button", "cc-segmented__item", label) as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", active ? "true" : "false");
  if (active) button.classList.add("cc-segmented__item--active");
  return button;
}

function selectTab(dom: ClaudeCodeViewDom, tabSession: HTMLButtonElement, tabHow: HTMLButtonElement, tab: CodeTab): void {
  dom.codeTab = tab;
  const session = tab === "session";
  dom.sessionBody.hidden = !session;
  dom.onboardingBody.hidden = session;
  tabSession.classList.toggle("cc-segmented__item--active", session);
  tabHow.classList.toggle("cc-segmented__item--active", !session);
  tabSession.setAttribute("aria-selected", session ? "true" : "false");
  tabHow.setAttribute("aria-selected", session ? "false" : "true");
}

export function renderClaudeCodeSurface(
  dom: ClaudeCodeViewDom,
  input: ClaudeCodeRenderInput,
  handlers: ClaudeCodeHandlers,
): void {
  dom.repoChip.textContent = input.workspaceName ?? "Chưa chọn workspace";
  renderSourceControl(dom.explorer, input.reviews, handlers.onOpenReview);
  renderCodeEditor(
    dom.editor,
    { openFiles: input.openFiles, activeKey: input.activeKey, reviews: input.reviews },
    { onSelect: handlers.onSelectTab, onClose: handlers.onCloseTab, onLoadFile: handlers.onLoadFile },
  );
  renderClaudePanel(dom.panel, {
    title: input.sessionTitle,
    messages: input.messages,
    phase: input.phase,
    disabled: input.composerDisabled,
    disabledReason: input.composerDisabledReason,
  });
}
