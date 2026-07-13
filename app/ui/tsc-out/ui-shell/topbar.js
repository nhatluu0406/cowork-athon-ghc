import { el, icon } from "./dom-utils.js";
export function createTopbar() {
    const root = el("header", "topbar");
    const leading = el("div", "topbar__leading");
    const brand = el("div", "topbar__brand");
    const mark = el("span", "topbar__brand-mark");
    mark.setAttribute("aria-hidden", "true");
    brand.append(mark, el("span", "topbar__brand-name", "Cowork GHC"));
    leading.append(brand);
    const trailing = el("div", "topbar__trailing no-drag");
    const inspectorToggle = el("button", "icon-btn topbar__inspector-toggle");
    inspectorToggle.type = "button";
    inspectorToggle.dataset["tooltip"] = "Mở inspector";
    inspectorToggle.setAttribute("aria-label", "Mở inspector");
    inspectorToggle.setAttribute("aria-expanded", "false");
    inspectorToggle.append(icon("panel-right-open", "Mở inspector"));
    const infoButton = el("button", "icon-btn topbar__info");
    infoButton.type = "button";
    infoButton.dataset["tooltip"] = "Thông tin";
    infoButton.setAttribute("aria-label", "Thông tin");
    infoButton.append(icon("activity", "Thông tin"));
    const settingsButton = el("button", "icon-btn topbar__settings");
    settingsButton.type = "button";
    settingsButton.dataset["tooltip"] = "Cài đặt";
    settingsButton.setAttribute("aria-label", "Cài đặt");
    settingsButton.append(icon("settings", "Cài đặt"));
    trailing.append(inspectorToggle, infoButton, settingsButton);
    root.append(leading, trailing);
    return { root, settingsButton, inspectorToggle };
}
//# sourceMappingURL=topbar.js.map