import { el, icon } from "./dom-utils.js";

export interface TopbarDom {
  readonly root: HTMLElement;
  readonly settingsButton: HTMLButtonElement;
  readonly inspectorToggle: HTMLButtonElement;
}

export function createTopbar(): TopbarDom {
  const root = el("header", "topbar");

  const leading = el("div", "topbar__leading");
  const brand = el("div", "topbar__brand");
  const mark = el("img", "topbar__brand-mark") as HTMLImageElement;
  mark.src = "/cowork-ghc-logo.svg";
  mark.alt = "";
  mark.setAttribute("aria-hidden", "true");
  brand.append(mark, el("span", "topbar__brand-name", "Cowork GHC"));
  leading.append(brand);

  const trailing = el("div", "topbar__trailing no-drag");
  const inspectorToggle = el("button", "icon-btn topbar__inspector-toggle") as HTMLButtonElement;
  inspectorToggle.type = "button";
  inspectorToggle.dataset["tooltip"] = "Mở Inspector";
  inspectorToggle.setAttribute("aria-label", "Mở Inspector");
  inspectorToggle.setAttribute("aria-expanded", "false");
  inspectorToggle.append(icon("panel-right-open", "Mở Inspector"));

  const settingsButton = el("button", "icon-btn topbar__settings") as HTMLButtonElement;
  settingsButton.type = "button";
  settingsButton.dataset["tooltip"] = "Cài đặt";
  settingsButton.setAttribute("aria-label", "Cài đặt");
  settingsButton.append(icon("sliders", "Cài đặt"));

  trailing.append(inspectorToggle, settingsButton);
  root.append(leading, trailing);

  return { root, settingsButton, inspectorToggle };
}
