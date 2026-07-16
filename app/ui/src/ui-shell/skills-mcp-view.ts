/**
 * Kỹ năng & MCP hub surface (Wave 2B).
 *
 * Full-bleed product-rail surface directly below Cowork. Owns tab chrome only —
 * Skill management mounts via `mountSkillsSettingsPanel`, MCP management mounts via
 * `mountMcpSettingsPanel`. See docs/product/extensions-hub.md.
 */

import { el } from "./dom-utils.js";

export type SkillsMcpTab = "skills" | "mcp";

export interface SkillsMcpViewDom {
  readonly root: HTMLElement;
  readonly summary: HTMLElement;
  readonly skillsTab: HTMLButtonElement;
  readonly mcpTab: HTMLButtonElement;
  readonly skillsBody: HTMLElement;
  readonly mcpBody: HTMLElement;
}

export function createSkillsMcpView(): SkillsMcpViewDom {
  const root = el("section", "view view--skills-mcp skills-mcp-view");
  root.dataset["view"] = "skills-mcp";
  root.hidden = true;

  // Header carries the title + tabs on one row (same visual language as the Knowledge screen).
  const header = el("header", "skills-mcp-header");
  const headText = el("div", "skills-mcp-header__text");
  headText.append(el("h1", "skills-mcp-header__title", "Skill & MCP"));
  const summary = el("span", "skills-mcp-header__summary");
  headText.append(summary);

  const tabs = el("div", "skills-mcp-tabs");
  tabs.setAttribute("role", "tablist");
  const skillsTab = el(
    "button",
    "skills-mcp-tabs__btn skills-mcp-tabs__btn--active",
    "Skill",
  ) as HTMLButtonElement;
  skillsTab.type = "button";
  skillsTab.dataset["skillsMcpTab"] = "skills";
  skillsTab.setAttribute("role", "tab");
  skillsTab.setAttribute("aria-selected", "true");
  const mcpTab = el("button", "skills-mcp-tabs__btn", "MCP") as HTMLButtonElement;
  mcpTab.type = "button";
  mcpTab.dataset["skillsMcpTab"] = "mcp";
  mcpTab.setAttribute("role", "tab");
  mcpTab.setAttribute("aria-selected", "false");
  tabs.append(skillsTab, mcpTab);
  header.append(headText, tabs);

  const body = el("div", "skills-mcp-body");
  const skillsBody = el("section", "skills-mcp-body__panel skills-mcp-body__panel--skills");
  skillsBody.setAttribute("aria-label", "Quản lý Skill");
  const mcpBody = el("section", "skills-mcp-body__panel skills-mcp-body__panel--mcp");
  mcpBody.hidden = true;
  mcpBody.setAttribute("aria-label", "Quản lý MCP");
  body.append(skillsBody, mcpBody);

  root.append(header, body);

  return { root, summary, skillsTab, mcpTab, skillsBody, mcpBody };
}

export function renderSkillsMcpTab(dom: SkillsMcpViewDom, tab: SkillsMcpTab): void {
  dom.skillsBody.hidden = tab !== "skills";
  dom.mcpBody.hidden = tab !== "mcp";
  for (const btn of [dom.skillsTab, dom.mcpTab]) {
    const active = btn.dataset["skillsMcpTab"] === tab;
    btn.classList.toggle("skills-mcp-tabs__btn--active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
}

export function setSkillsMcpSummary(dom: SkillsMcpViewDom, text: string): void {
  dom.summary.textContent = text;
}
