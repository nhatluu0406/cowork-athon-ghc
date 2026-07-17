import { createProductIcon, type ProductIconName } from "../product-icons.js";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function icon(name: ProductIconName, label?: string): SVGSVGElement {
  return createProductIcon(name, label);
}

export function appendIconLabel(
  parent: HTMLElement,
  iconName: ProductIconName,
  label: string,
): void {
  parent.append(icon(iconName, label), el("span", "icon-label", label));
}

export function setIconLabel(
  parent: HTMLElement,
  iconName: ProductIconName,
  label: string,
): void {
  parent.replaceChildren();
  appendIconLabel(parent, iconName, label);
}
