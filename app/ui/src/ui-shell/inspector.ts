import { el } from "./dom-utils.js";

export interface InspectorShellDom {
  readonly root: HTMLElement;
  readonly executionStatus: HTMLElement;
  readonly permissionSummary: HTMLElement;
}

export function createInspectorShell(): InspectorShellDom {
  const root = el("aside", "inspector inspector-shell right-panel");
  root.setAttribute("aria-label", "Inspector");
  root.hidden = true;

  const header = el("header", "inspector__header rp-header");
  header.append(el("span", "rp-header__title", "Inspector"));

  const executionStatus = el("p", "execution-status");
  executionStatus.hidden = true;
  const planCard = el("section", "plan-card");
  planCard.append(el("div", "plan-card__hd", "Kế hoạch"), el("div", "plan-card__steps"));
  const outputSection = el("section", "file-section");
  outputSection.append(el("div", "file-section__label", "Tệp đầu ra"), el("div", "output-files"));
  const inputSection = el("section", "file-section");
  inputSection.append(el("div", "file-section__label", "Tệp đã đọc"), el("div", "input-files"));
  const permissionSummary = el("p", "permission-summary", "Quyền: chưa có yêu cầu.");

  root.append(header, executionStatus, planCard, outputSection, inputSection, permissionSummary);
  return { root, executionStatus, permissionSummary };
}
