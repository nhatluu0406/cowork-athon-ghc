import type { MicrosoftIntegrationView } from "../../integration-slots.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";
import { renderMsAssistant, type MsAssistantComposerRefs, type MsAssistantConversationItem } from "./ms-assistant-view.js";
import { renderMsConnect } from "./ms-connect-view.js";

export type MicrosoftTab = "assistant" | "connect";

export interface MicrosoftViewDom {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly tabAssistant: HTMLButtonElement;
  readonly tabConnect: HTMLButtonElement;
  msTab: MicrosoftTab;
  lastView: MicrosoftIntegrationView | null;
  lastHandlers: MicrosoftSurfaceHandlers | null;
  lastConversations: readonly MsAssistantConversationItem[];
  lastActiveConversationId: string | null;
  /** The live assistant transcript element, when the assistant tab is the last-rendered tab. */
  assistantTranscript: HTMLElement | null;
  /** The live composer refs (send/input/chips), when the assistant tab is the last-rendered tab. */
  msComposer: MsAssistantComposerRefs | null;
}

export interface MicrosoftSurfaceHandlers {
  readonly onSend: (text: string) => void;
  readonly onConnect: (token: string) => void;
  readonly onDisconnect: () => void;
  readonly onSelectConversation: (id: string) => void;
  readonly onNewConversation: () => void;
}

export function createMicrosoftView(): MicrosoftViewDom {
  const root = el("section", "view view--microsoft ms-surface");
  root.dataset["view"] = "microsoft";
  root.hidden = true;

  const header = el("header", "ms-surface__header");
  const titleWrap = el("div", "ms-surface__title-wrap");
  titleWrap.append(createMicrosoftLogo(22), el("h1", "ms-surface__title", "Microsoft 365"));
  const segmented = el("div", "ms-segmented");
  segmented.setAttribute("role", "tablist");
  segmented.setAttribute("aria-label", "Chế độ Microsoft 365");
  const tabAssistant = segmentedButton("Trợ lý AI", true);
  const tabConnect = segmentedButton("Kết nối", false);
  segmented.append(tabAssistant, tabConnect);
  header.append(titleWrap, segmented);

  const body = el("div", "ms-surface__body");
  root.append(header, body);

  const dom: MicrosoftViewDom = {
    root,
    body,
    tabAssistant,
    tabConnect,
    msTab: "assistant",
    lastView: null,
    lastHandlers: null,
    lastConversations: [],
    lastActiveConversationId: null,
    assistantTranscript: null,
    msComposer: null,
  };
  const select = (tab: MicrosoftTab): void => {
    dom.msTab = tab;
    if (dom.lastView !== null) renderMicrosoftSurfaceInternal(dom, dom.lastView, dom.lastHandlers);
  };
  tabAssistant.addEventListener("click", () => select("assistant"));
  tabConnect.addEventListener("click", () => select("connect"));
  for (const tab of [tabAssistant, tabConnect]) {
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const target = tab === tabAssistant ? tabConnect : tabAssistant;
      target.focus();
      target.click();
    });
  }
  return dom;
}

function segmentedButton(label: string, active: boolean): HTMLButtonElement {
  const button = el("button", "ms-segmented__item", label) as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", active ? "true" : "false");
  if (active) button.classList.add("ms-segmented__item--active");
  return button;
}

export function renderMicrosoftSurface(
  dom: MicrosoftViewDom,
  view: MicrosoftIntegrationView,
  handlers: MicrosoftSurfaceHandlers,
  conversations: readonly MsAssistantConversationItem[] = [],
  activeId: string | null = null,
): void {
  dom.lastView = view;
  dom.lastHandlers = handlers;
  dom.lastConversations = conversations;
  dom.lastActiveConversationId = activeId;
  renderMicrosoftSurfaceInternal(dom, view, handlers);
}

function renderMicrosoftSurfaceInternal(
  dom: MicrosoftViewDom,
  view: MicrosoftIntegrationView,
  handlers: MicrosoftSurfaceHandlers | null,
): void {
  const assistantActive = dom.msTab === "assistant";
  dom.tabAssistant.classList.toggle("ms-segmented__item--active", assistantActive);
  dom.tabConnect.classList.toggle("ms-segmented__item--active", !assistantActive);
  dom.tabAssistant.setAttribute("aria-selected", assistantActive ? "true" : "false");
  dom.tabConnect.setAttribute("aria-selected", assistantActive ? "false" : "true");
  if (assistantActive) {
    const rendered = renderMsAssistant(dom.body, view, {
      onOpenConnect: () => {
        dom.msTab = "connect";
        renderMicrosoftSurfaceInternal(dom, view, handlers);
      },
      onSend: (text) => handlers?.onSend(text),
      onSelectConversation: (id) => handlers?.onSelectConversation(id),
      onNewConversation: () => handlers?.onNewConversation(),
    }, dom.lastConversations, dom.lastActiveConversationId);
    dom.assistantTranscript = rendered.transcript;
    dom.msComposer = rendered.composer;
  } else {
    dom.assistantTranscript = null;
    dom.msComposer = null;
    renderMsConnect(dom.body, view, {
      onConnect: (token) => handlers?.onConnect(token),
      onDisconnect: () => handlers?.onDisconnect(),
    });
  }
}
