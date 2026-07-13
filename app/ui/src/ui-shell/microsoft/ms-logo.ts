const SVG_NS = "http://www.w3.org/2000/svg";
const CELLS: readonly (readonly [string, number, number])[] = [
  ["#F25022", 0, 0],
  ["#7FBA00", 13, 0],
  ["#00A4EF", 0, 13],
  ["#FFB900", 13, 13],
];

/** Microsoft 4-square logo — the only fill-based icon (design handoff exception). */
export function createMicrosoftLogo(size = 24): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Microsoft");
  for (const [fill, x, y] of CELLS) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", "11");
    rect.setAttribute("height", "11");
    rect.setAttribute("fill", fill);
    svg.append(rect);
  }
  return svg;
}
