/**
 * MS365 batch write-mode pill for the chat composer. Visible only while MS365 is connected.
 * The pill is a pure CLIENT of the service's write-mode route: clicking emits
 * "ms365-write-mode-toggle" with the requested next mode; the shell calls the route and then
 * confirms via setMode — the control never flips state on its own (one source of truth).
 */
import { el } from "./dom-utils.js";
import type { Ms365WriteMode } from "../service-client.js";

const MODE_COPY: Readonly<Record<Ms365WriteMode, { label: string; description: string }>> = {
  manual: {
    label: "MS365: Thủ công",
    description: "Mỗi thao tác ghi hàng loạt lên Microsoft 365 sẽ được tách nhỏ và hỏi từng lần.",
  },
  auto: {
    label: "MS365: Tự động",
    description: "Một lần phê duyệt phủ cả loạt task đã khai báo; thao tác ghi lẻ vẫn hỏi từng lần.",
  },
};

export interface Ms365WriteModeControl {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  getMode(): Ms365WriteMode;
  setMode(mode: Ms365WriteMode): void;
  setVisible(visible: boolean): void;
}

export function createMs365WriteModeControl(): Ms365WriteModeControl {
  const root = el("div", "ms365-mode-control");
  root.hidden = true;
  const button = el("button", "ms365-mode-control__button") as HTMLButtonElement;
  button.type = "button";
  root.append(button);

  let mode: Ms365WriteMode = "manual";

  const update = (): void => {
    const copy = MODE_COPY[mode];
    button.textContent = copy.label;
    button.dataset["mode"] = mode;
    button.dataset["tooltip"] = `${copy.label} — ${copy.description}`;
    button.setAttribute("aria-pressed", mode === "auto" ? "true" : "false");
    button.setAttribute("aria-label", `Chế độ ghi hàng loạt Microsoft 365: ${copy.label}. ${copy.description}`);
  };

  button.addEventListener("click", () => {
    const next: Ms365WriteMode = mode === "manual" ? "auto" : "manual";
    root.dispatchEvent(new CustomEvent<Ms365WriteMode>("ms365-write-mode-toggle", { detail: next }));
  });

  update();
  return {
    root,
    button,
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
      update();
    },
    setVisible: (visible) => {
      root.hidden = !visible;
    },
  };
}
