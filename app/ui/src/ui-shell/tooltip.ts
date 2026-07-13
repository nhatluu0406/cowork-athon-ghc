const TOOLTIP_ID = "shell-tooltip";

export function installShellTooltips(root: HTMLElement): void {
  let tooltip = document.getElementById(TOOLTIP_ID);
  let activeTarget: HTMLElement | null = null;
  if (tooltip === null) {
    tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    tooltip.className = "shell-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.append(tooltip);
  }

  const show = (target: HTMLElement): void => {
    const text = target.dataset["tooltip"];
    if (text === undefined || text.trim().length === 0 || tooltip === null) return;
    tooltip.textContent = text;
    tooltip.hidden = false;
    activeTarget = target;
    target.setAttribute("aria-describedby", TOOLTIP_ID);
    positionTooltip(target, tooltip);
  };

  const hide = (target: HTMLElement): void => {
    target.removeAttribute("aria-describedby");
    if (tooltip !== null) tooltip.hidden = true;
    if (activeTarget === target) activeTarget = null;
  };

  const hideActive = (): void => {
    if (activeTarget !== null) {
      activeTarget.removeAttribute("aria-describedby");
      activeTarget = null;
    }
    if (tooltip !== null) tooltip.hidden = true;
  };

  root.addEventListener("pointerenter", (event) => {
    const target = tooltipTarget(event);
    if (target !== null && root.contains(target)) show(target);
  }, true);
  root.addEventListener("pointerleave", (event) => {
    const target = tooltipTarget(event);
    if (target !== null) hide(target);
  }, true);
  root.addEventListener("focusin", (event) => {
    const target = tooltipTarget(event);
    if (target !== null && root.contains(target)) show(target);
  });
  root.addEventListener("focusout", (event) => {
    const target = tooltipTarget(event);
    if (target !== null) hide(target);
  });
  root.addEventListener("pointerdown", hideActive, true);
  root.addEventListener("click", hideActive, true);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideActive();
  }, true);
  window.addEventListener("resize", () => {
    if (tooltip === null || tooltip.hidden) return;
    const described = root.querySelector<HTMLElement>(`[aria-describedby="${TOOLTIP_ID}"]`);
    if (described !== null) positionTooltip(described, tooltip);
  });
}

function tooltipTarget(event: Event): HTMLElement | null {
  return event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-tooltip]") : null;
}

function positionTooltip(target: HTMLElement, tooltip: HTMLElement): void {
  const gap = 8;
  const margin = 8;
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  let left = targetRect.right + gap;
  let top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;

  if (left + tooltipRect.width + margin > window.innerWidth) {
    left = targetRect.left - tooltipRect.width - gap;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
