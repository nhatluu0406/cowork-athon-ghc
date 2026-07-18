import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";
import { renderMsAssistant, type MsAssistantHandlers } from "./ms-assistant-view.js";
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
  /** Persistent [sidebar | chat] layout for the connected assistant tab. Kept across renders so the
   * chat column element is stable — this is what lets renderMsAssistant's streaming fast-path work
   * (its signature/scroll state lives on the element) instead of the transcript flashing and the
   * scrollbar jumping to the top on every token. Null until first built / when structure changes. */
  assistantLayout: { wrap: HTMLElement; sidebar: HTMLElement; chatCol: HTMLElement } | null;
}

/** A conversation-list item for the MS365 history sidebar. */
export interface MsConversationItem {
  readonly id: string;
  readonly title: string;
  readonly meta?: string;
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
  /** History-sidebar conversation list (assistant tab, connected only). */
  readonly conversations: readonly MsConversationItem[];
  /** The conversation currently loaded into the transcript, if any. */
  readonly activeConversationId: string | null;
  readonly onSelectConversation: (id: string) => void;
  readonly onNewConversation: () => void;
  readonly onSearchConversations: (query: string) => void;
  /** PHASE 3: open the detected LOCAL OneDrive folder as a workspace (local files, not Graph). */
  readonly onUseLocalOneDrive?: (path: string) => void;
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
    assistantLayout: null,
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
  // On the transition into "connected" (e.g. right after a successful manual/device connect),
  // jump to the assistant tab so the user lands on the now-enabled chat instead of staying on
  // the connect screen. Only on the rising edge — a manual switch back to "connect" while still
  // connected must stick.
  const justConnected = dom.lastView?.connectionState !== "connected" && view.connectionState === "connected";
  if (justConnected) dom.msTab = "assistant";
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
  const assistantHandlers = (): MsAssistantHandlers => ({
    onOpenConnect: () => {
      dom.msTab = "connect";
      renderMicrosoftSurfaceInternal(dom, view, deps);
    },
    chat: deps.chat,
    onSend: deps.onSend,
    onCancel: deps.onCancel,
    ...(deps.writeModePill !== undefined ? { writeModePill: deps.writeModePill } : {}),
  });

  if (assistantActive) {
    const connected = view.connectionState === "connected";
    // Sidebar only on the assistant tab AND when connected. The assistant column then renders
    // beside it; otherwise the body is a single column (unchanged pre-sidebar behaviour).
    if (connected) {
      // Reuse a stable [sidebar | chat] layout so the chat column ELEMENT survives re-renders.
      // renderMsAssistant keeps its streaming fast-path state (signature + scroll) on that element;
      // rebuilding it every render (the old behaviour) reset the scroll to top and replayed the
      // mount animation on every token — the flash + scroll-jump the user saw. We only rebuild the
      // sidebar in place (cheap, not a scroll region) and let renderMsAssistant patch the chat.
      let layout = dom.assistantLayout;
      if (layout === null || layout.wrap.parentElement !== dom.body) {
        const wrap = el("div", "ms-assistant-layout");
        const sidebar = renderMsHistorySidebar(deps);
        sidebar.dataset["sig"] = sidebarSignature(deps);
        const chatCol = el("div", "ms-assistant-layout__chat");
        wrap.append(sidebar, chatCol);
        dom.body.replaceChildren(wrap);
        layout = { wrap, sidebar, chatCol };
        dom.assistantLayout = layout;
      } else {
        // Refresh the sidebar only when the list/active actually changed — rebuilding it on every
        // streaming render would blow away search-input focus and waste work. Signature guards it.
        const sidebarSig = sidebarSignature(deps);
        if (layout.sidebar.dataset["sig"] !== sidebarSig) {
          const freshSidebar = renderMsHistorySidebar(deps);
          freshSidebar.dataset["sig"] = sidebarSig;
          layout.sidebar.replaceWith(freshSidebar);
          layout.sidebar = freshSidebar;
        }
      }
      renderMsAssistant(layout.chatCol, view, assistantHandlers());
    } else {
      dom.assistantLayout = null;
      dom.body.replaceChildren();
      renderMsAssistant(dom.body, view, assistantHandlers());
    }
  } else {
    dom.assistantLayout = null;
    renderMsConnect(dom.body, {
      view,
      client: deps.client,
      onViewChange: deps.onViewChange,
      ...(deps.onUseLocalOneDrive !== undefined ? { onUseLocalOneDrive: deps.onUseLocalOneDrive } : {}),
    });
  }
}

/** Signature of the sidebar's data — rebuild only when the conversation list or active id changes. */
function sidebarSignature(deps: MicrosoftSurfaceDeps): string {
  return `${deps.activeConversationId ?? ""}|${deps.conversations.map((c) => `${c.id}:${c.title}:${c.meta ?? ""}`).join(",")}`;
}

/** Renders the MS365 conversation-history sidebar: new button + search + conversation list. */
function renderMsHistorySidebar(deps: MicrosoftSurfaceDeps): HTMLElement {
  const sidebar = el("aside", "ms-history");
  sidebar.setAttribute("aria-label", "Lịch sử trò chuyện Microsoft 365");

  const toolbar = el("div", "ms-history__toolbar");
  const newButton = el("button", "ms-history__new", "＋ Cuộc trò chuyện mới") as HTMLButtonElement;
  newButton.type = "button";
  newButton.addEventListener("click", () => deps.onNewConversation());
  toolbar.append(newButton);

  const search = el("input", "ms-history__search") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Tìm cuộc trò chuyện…";
  search.setAttribute("aria-label", "Tìm cuộc trò chuyện Microsoft 365");
  search.addEventListener("input", () => deps.onSearchConversations(search.value));
  toolbar.append(search);

  sidebar.append(toolbar);

  const list = el("div", "ms-history__list");
  if (deps.conversations.length === 0) {
    list.append(el("p", "ms-history__empty", "Chưa có cuộc trò chuyện nào."));
  } else {
    for (const conv of deps.conversations) {
      const classes = ["ms-history__item"];
      if (conv.id === deps.activeConversationId) classes.push("ms-history__item--active");
      const item = el("button", classes.join(" ")) as HTMLButtonElement;
      item.type = "button";
      item.addEventListener("click", () => deps.onSelectConversation(conv.id));
      item.append(el("span", "ms-history__item-title", conv.title));
      if (conv.meta !== undefined && conv.meta.length > 0) {
        item.append(el("span", "ms-history__item-meta", conv.meta));
      }
      list.append(item);
    }
  }
  sidebar.append(list);
  return sidebar;
}
