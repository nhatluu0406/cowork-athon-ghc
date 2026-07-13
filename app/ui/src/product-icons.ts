/**
 * Small inline SVG icon system for the product shell.
 *
 * No external assets or brand icons are embedded; Microsoft remains a neutral product-surface
 * glyph until a licensed integration asset is explicitly added.
 */

export type ProductIconName =
  | "cowork"
  | "dispatch"
  | "gateway"
  | "knowledge"
  | "knowledge-graph"
  | "microsoft"
  | "code"
  | "conversation"
  | "workspace"
  | "folder"
  | "file"
  | "skills"
  | "attachment"
  | "search"
  | "refresh"
  | "file-create"
  | "file-modify"
  | "file-delete"
  | "permission"
  | "settings"
  | "sliders"
  | "info"
  | "folder-open"
  | "pencil"
  | "trash"
  | "check"
  | "save"
  | "arrow-left"
  | "more"
  | "activity"
  | "panel"
  | "panel-right-open"
  | "panel-right-close"
  | "paper-plane"
  | "square-pen"
  | "expand"
  | "collapse";

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS: Readonly<Record<ProductIconName, readonly string[]>> = Object.freeze({
  cowork: ["M5 12a7 7 0 1 1 14 0v5a2 2 0 0 1-2 2h-3l-2 2-2-2H7a2 2 0 0 1-2-2v-5Z", "M9 11h6M9 15h4"],
  dispatch: ["M4 6h6v6H4zM14 4h6v6h-6zM14 14h6v6h-6z", "M10 9h4M10 16h4"],
  gateway: ["M4 7h16M4 17h16", "M8 7v10M16 7v10M7 12h10"],
  knowledge: ["M6 5h9a3 3 0 0 1 3 3v11H8a2 2 0 0 1-2-2V5Z", "M9 8h6M9 12h5"],
  "knowledge-graph": ["M6 7a2 2 0 1 0 0 .1M18 7a2 2 0 1 0 0 .1M12 17a2 2 0 1 0 0 .1", "M8 8l3 7M16 8l-3 7M8 7h8"],
  microsoft: ["M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z"],
  code: ["M9 7 5 12l4 5M15 7l4 5-4 5", "M13 5l-2 14"],
  conversation: ["M5 6h14v9H9l-4 4V6Z"],
  workspace: ["M4 7h7l2 2h7v9H4V7Z"],
  folder: ["M4 7h6l2 2h8v9H4V7Z"],
  file: ["M7 4h7l4 4v12H7V4Z", "M14 4v5h5"],
  skills: ["M12 4l2.2 4.5 4.8.7-3.5 3.4.8 4.8L12 15.2 7.7 17.4l.8-4.8L5 9.2l4.8-.7L12 4Z"],
  attachment: ["M8 12l5.8-5.8a3 3 0 1 1 4.2 4.2L10.8 17.6a4 4 0 1 1-5.6-5.6l7-7"],
  search: ["M10.5 18a7.5 7.5 0 1 1 5.3-2.2L20 20"],
  refresh: ["M20 6v5h-5", "M4 18v-5h5", "M18 9a6 6 0 0 0-10-3L4 10M6 15a6 6 0 0 0 10 3l4-4"],
  "file-create": ["M7 4h7l3 3v13H7V4Z", "M14 4v4h4M12 10v6M9 13h6"],
  "file-modify": ["M7 4h7l3 3v13H7V4Z", "M14 4v4h4M10 15l5-5 2 2-5 5h-2v-2Z"],
  "file-delete": ["M7 7h10M10 7V5h4v2M9 10l1 8M15 10l-1 8M8 7l1 13h6l1-13"],
  permission: ["M12 4l7 3v5c0 4-2.7 7-7 8-4.3-1-7-4-7-8V7l7-3Z", "M9 12l2 2 4-5"],
  settings: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M4 12h3M17 12h3M12 4v3M12 17v3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M17.7 6.3l-2.1 2.1M8.4 15.6l-2.1 2.1"],
  sliders: ["M4 7h10M18 7h2M4 17h2M10 17h10", "M14 4v6M7 14v6"],
  info: ["M12 11v6", "M12 7h.01", "M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z"],
  "folder-open": ["M3 8h7l2 2h9l-2 8H5L3 8Z", "M5 8V6h6l2 2"],
  pencil: ["M5 19l4-.8L18 9.2 14.8 6 5.8 15 5 19Z", "M13.8 7l3.2 3.2"],
  trash: ["M7 7h10M10 7V5h4v2M9 10l1 8M15 10l-1 8M8 7l1 13h6l1-13"],
  check: ["M5 12l4 4L19 6"],
  save: ["M5 4h12l2 2v14H5V4Z", "M8 4v6h8V4M8 16h8"],
  "arrow-left": ["M19 12H5", "M11 6l-6 6 6 6"],
  more: ["M6 12h.01M12 12h.01M18 12h.01"],
  activity: ["M5 12h3l2-5 4 10 2-5h3"],
  panel: ["M4 5h16v14H4V5Z", "M14 5v14"],
  "panel-right-open": ["M4 5h16v14H4V5Z", "M14 5v14", "M10 9l3 3-3 3"],
  "panel-right-close": ["M4 5h16v14H4V5Z", "M14 5v14", "M12 9l-3 3 3 3"],
  "paper-plane": ["M4 12 20 5l-7 15-2-6-7-2Z", "M11 14l9-9"],
  "square-pen": ["M5 5h10v4M5 5v14h14V9", "M10 14l7-7 2 2-7 7h-2v-2Z"],
  expand: ["M9 6l6 6-6 6"],
  collapse: ["M6 9l6 6 6-6"],
});

export function createProductIcon(name: ProductIconName, label?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", label === undefined ? "true" : "false");
  if (label !== undefined) svg.setAttribute("aria-label", label);
  svg.classList.add("product-icon", `product-icon--${name}`);
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
