import { el, icon } from "./dom-utils.js";

export type PermissionMode = "ask" | "workspace_auto" | "read_only";

const MODE_COPY: Readonly<Record<PermissionMode, { label: string; description: string }>> = {
  ask: {
    label: "Hỏi trước",
    description: "Hiển thị yêu cầu quyền trước mỗi thay đổi tệp.",
  },
  workspace_auto: {
    label: "Tự động",
    description: "Tự động cho phép tạo và sửa tệp trong workspace; hành động rủi ro cao vẫn hỏi.",
  },
  read_only: {
    label: "Chỉ đọc",
    description: "Từ chối mọi thay đổi tệp và lệnh thực thi.",
  },
};

export interface PermissionModeControl {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly menu: HTMLElement;
  readonly label: HTMLElement;
  getMode(): PermissionMode;
  setMode(mode: PermissionMode, emit?: boolean): void;
  close(): void;
}

export function createPermissionModeControl(initialMode: PermissionMode = "ask"): PermissionModeControl {
  const root = el("div", "permission-mode-control");
  const button = el("button", "permission-mode-control__button") as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");

  const label = el("span", "permission-mode-control__label");
  const chevron = icon("expand", "Mở lựa chọn quyền");
  chevron.classList.add("permission-mode-control__chevron");
  button.append(icon("permission", "Quyền"), label, chevron);

  const menu = el("div", "permission-mode-control__menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Chế độ quyền");

  let mode = initialMode;
  const options = new Map<PermissionMode, HTMLButtonElement>();

  const update = (): void => {
    const copy = MODE_COPY[mode];
    label.textContent = copy.label;
    button.dataset["mode"] = mode;
    button.dataset["tooltip"] = `${copy.label} — ${copy.description}`;
    button.setAttribute("aria-label", `Chế độ quyền: ${copy.label}. ${copy.description}`);
    for (const [value, option] of options) {
      const active = value === mode;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-checked", active ? "true" : "false");
    }
  };

  const close = (): void => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  for (const value of ["ask", "workspace_auto", "read_only"] as const) {
    const copy = MODE_COPY[value];
    const option = el("button", "permission-mode-control__option") as HTMLButtonElement;
    option.type = "button";
    option.setAttribute("role", "menuitemradio");
    const text = el("span", "permission-mode-control__option-copy");
    text.append(
      el("span", "permission-mode-control__option-label", copy.label),
      el("span", "permission-mode-control__option-description", copy.description),
    );
    option.append(icon(value === "read_only" ? "file" : "permission"), text);
    option.addEventListener("click", () => {
      mode = value;
      update();
      close();
      root.dispatchEvent(new CustomEvent<PermissionMode>("permission-mode-change", { detail: mode }));
      button.focus();
    });
    options.set(value, option);
    menu.append(option);
  }

  button.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) options.get(mode)?.focus();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      button.focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target as Node)) close();
  });

  update();
  root.append(button, menu);

  return {
    root,
    button,
    menu,
    label,
    getMode: () => mode,
    setMode: (next, emit = false) => {
      mode = next;
      update();
      if (emit) root.dispatchEvent(new CustomEvent<PermissionMode>("permission-mode-change", { detail: mode }));
    },
    close,
  };
}
