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
  const mark = el("span", "topbar__brand-mark");
  mark.setAttribute("aria-hidden", "true");
  brand.append(mark, el("span", "topbar__brand-name", "Cowork GHC"));
  leading.append(brand);

  const trailing = el("div", "topbar__trailing no-drag");
  const inspectorToggle = el("button", "icon-btn topbar__inspector-toggle") as HTMLButtonElement;
  inspectorToggle.type = "button";
  inspectorToggle.title = "Mở inspector";
  inspectorToggle.dataset["tooltip"] = "Mở inspector";
  inspectorToggle.setAttribute("aria-label", "Mở inspector");
  inspectorToggle.setAttribute("aria-expanded", "false");
  inspectorToggle.append(icon("panel-right-open", "Mở inspector"));

  const infoButton = el("button", "icon-btn topbar__info") as HTMLButtonElement;
  infoButton.type = "button";
  infoButton.title = "Thông tin";
  infoButton.dataset["tooltip"] = "Thông tin";
  infoButton.setAttribute("aria-label", "Thông tin");
  infoButton.append(icon("activity", "Thông tin"));

  const settingsButton = el("button", "icon-btn topbar__settings") as HTMLButtonElement;
  settingsButton.type = "button";
  settingsButton.title = "Settings";
  settingsButton.dataset["tooltip"] = "Settings";
  settingsButton.setAttribute("aria-label", "Settings");
  settingsButton.append(icon("settings", "Settings"));

  trailing.append(inspectorToggle, infoButton, settingsButton);
  root.append(leading, trailing);

  return { root, settingsButton, inspectorToggle };
}
