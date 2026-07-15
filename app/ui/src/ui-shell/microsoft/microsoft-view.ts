import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";
import { renderMsAssistant } from "./ms-assistant-view.js";
import { renderMsConnect, type Ms365ConnectClient } from "./ms-connect-view.js";
import type { Ms365ViewData } from "../../service-client.js";
import type { MsChatController } from "./ms-chat-controller.js";

export type MicrosoftTab = "assistant" | "connect";

export interface MicrosoftViewDom {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly tabAssistant: HTMLButtonElement;
  readonly tabConnect: HTMLButtonElement;
  msTab: MicrosoftTab;
  lastView: Ms365ViewData | null;
  lastDeps: MicrosoftSurfaceDeps | null;
}

/** Dependencies the connect/assistant tabs need from the host shell. */
export interface MicrosoftSurfaceDeps {
  readonly client: Ms365ConnectClient;
  readonly onViewChange: (view: Ms365ViewData) => void;
  /** MS365 tab chat controller — owned by app-shell, survives replaceChildren (Task 1). */
  readonly chat: MsChatController;
  readonly onSend: (prompt: string) => void;
  readonly onCancel: () => void;
  /** Root of the write-mode pill (Task 3); mounted into the composer row when provided. */
  readonly writeModePill?: HTMLElement;
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
    lastDeps: null,
  };
  const select = (tab: MicrosoftTab): void => {
    dom.msTab = tab;
    if (dom.lastView !== null && dom.lastDeps !== null) renderMicrosoftSurfaceInternal(dom, dom.lastView, dom.lastDeps);
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

export function renderMicrosoftSurface(dom: MicrosoftViewDom, view: Ms365ViewData, deps: MicrosoftSurfaceDeps): void {
  dom.lastView = view;
  dom.lastDeps = deps;
  renderMicrosoftSurfaceInternal(dom, view, deps);
}

function renderMicrosoftSurfaceInternal(dom: MicrosoftViewDom, view: Ms365ViewData, deps: MicrosoftSurfaceDeps): void {
  const assistantActive = dom.msTab === "assistant";
  dom.tabAssistant.classList.toggle("ms-segmented__item--active", assistantActive);
  dom.tabConnect.classList.toggle("ms-segmented__item--active", !assistantActive);
  dom.tabAssistant.setAttribute("aria-selected", assistantActive ? "true" : "false");
  dom.tabConnect.setAttribute("aria-selected", assistantActive ? "false" : "true");
  if (assistantActive) {
    renderMsAssistant(dom.body, view, {
      onOpenConnect: () => {
        dom.msTab = "connect";
        renderMicrosoftSurfaceInternal(dom, view, deps);
      },
      chat: deps.chat,
      onSend: deps.onSend,
      onCancel: deps.onCancel,
      ...(deps.writeModePill !== undefined ? { writeModePill: deps.writeModePill } : {}),
    });
  } else {
    renderMsConnect(dom.body, { view, client: deps.client, onViewChange: deps.onViewChange });
  }
}
