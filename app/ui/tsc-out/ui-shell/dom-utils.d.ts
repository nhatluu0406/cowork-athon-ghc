import { type ProductIconName } from "../product-icons.js";
export declare function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K];
export declare function icon(name: ProductIconName, label?: string): SVGSVGElement;
export declare function appendIconLabel(parent: HTMLElement, iconName: ProductIconName, label: string): void;
export declare function setIconLabel(parent: HTMLElement, iconName: ProductIconName, label: string): void;
//# sourceMappingURL=dom-utils.d.ts.map