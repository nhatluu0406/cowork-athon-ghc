/**
 * Compact session bar (#35) — a "new session" button + a "pick an existing session" dropdown,
 * shared by the Code Agent panel and the Workspace companion. Both surfaces reuse the ONE Cowork
 * conversation (ADR 0013: shared active workspace + session), but previously offered no way to
 * start or switch a session without returning to the Cowork surface. This gives them that control
 * inline, wired to the same conversation controller — it renders exactly what the controller
 * reports and creates/switches nothing itself.
 */

import { el, icon } from "./dom-utils.js";

export interface SessionBarConversation {
  readonly id: string;
  readonly title: string;
}

export interface SessionBarState {
  readonly activeId: string | null;
  readonly conversations: readonly SessionBarConversation[];
  /** Disable the controls while a turn is running / no workspace is active. */
  readonly disabled?: boolean;
}

export interface SessionBarHandlers {
  readonly onNew: () => void;
  readonly onPick: (conversationId: string) => void;
}

export interface SessionBarDom {
  readonly root: HTMLElement;
  render(state: SessionBarState): void;
}

export function createSessionBar(handlers: SessionBarHandlers): SessionBarDom {
  const root = el("div", "session-bar");

  const select = el("select", "session-bar__select") as HTMLSelectElement;
  select.setAttribute("aria-label", "Chọn phiên trò chuyện");
  select.addEventListener("change", () => {
    const id = select.value;
    if (id.length > 0) handlers.onPick(id);
  });

  const newBtn = el("button", "session-bar__new") as HTMLButtonElement;
  newBtn.type = "button";
  newBtn.setAttribute("aria-label", "Tạo phiên mới");
  newBtn.setAttribute("data-tooltip", "Phiên mới");
  newBtn.append(icon("square-pen", "Phiên mới"), el("span", "session-bar__new-label", "Phiên mới"));
  newBtn.addEventListener("click", () => handlers.onNew());

  root.append(select, newBtn);

  return {
    root,
    render(state) {
      const disabled = state.disabled === true;
      newBtn.disabled = disabled;
      select.disabled = disabled;
      select.replaceChildren();
      if (state.conversations.length === 0) {
        const opt = el("option", "", "Chưa có phiên") as HTMLOptionElement;
        opt.value = "";
        opt.disabled = true;
        opt.selected = true;
        select.append(opt);
        return;
      }
      if (state.activeId === null) {
        const placeholder = el("option", "", "Chọn phiên…") as HTMLOptionElement;
        placeholder.value = "";
        placeholder.disabled = true;
        placeholder.selected = true;
        select.append(placeholder);
      }
      for (const conversation of state.conversations) {
        const opt = el("option", "", conversation.title || "(chưa đặt tên)") as HTMLOptionElement;
        opt.value = conversation.id;
        if (conversation.id === state.activeId) opt.selected = true;
        select.append(opt);
      }
    },
  };
}
