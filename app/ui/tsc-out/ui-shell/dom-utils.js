import { createProductIcon } from "../product-icons.js";
export function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
export function icon(name, label) {
    return createProductIcon(name, label);
}
export function appendIconLabel(parent, iconName, label) {
    parent.append(icon(iconName, label), el("span", "icon-label", label));
}
export function setIconLabel(parent, iconName, label) {
    parent.replaceChildren();
    appendIconLabel(parent, iconName, label);
}
//# sourceMappingURL=dom-utils.js.map