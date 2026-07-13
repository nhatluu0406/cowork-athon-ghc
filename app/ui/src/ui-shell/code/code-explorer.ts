import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import { el, icon } from "../dom-utils.js";
import { badgeForReview } from "./code-editor.js";
import { diffStats } from "./parse-unified-diff.js";

export interface CodeExplorerDom {
  readonly root: HTMLElement;
  readonly sourceControl: HTMLElement;
  readonly treeSlot: HTMLElement;
  readonly collapseButton: HTMLButtonElement;
}

export function createCodeExplorer(): CodeExplorerDom {
  const root = el("aside", "code-explorer");
  root.setAttribute("aria-label", "Explorer");
  const header = el("div", "code-explorer__header");
  header.append(el("span", "code-explorer__title", "EXPLORER"));
  const collapseButton = el("button", "code-explorer__collapse") as HTMLButtonElement;
  collapseButton.type = "button";
  collapseButton.title = "Thu gọn Explorer";
  collapseButton.setAttribute("aria-label", "Thu gọn Explorer");
  collapseButton.append(icon("collapse", "Thu gọn Explorer"));
  header.append(collapseButton);

  const scmSection = el("section", "code-explorer__section");
  scmSection.append(el("h3", "code-explorer__label", "SOURCE CONTROL"));
  const sourceControl = el("div", "code-scm");
  scmSection.append(sourceControl);

  const treeSection = el("section", "code-explorer__section code-explorer__section--tree");
  const treeSlot = el("div", "code-explorer__tree");
  treeSection.append(treeSlot);

  root.append(header, scmSection, treeSection);
  return { root, sourceControl, treeSlot, collapseButton };
}

export function latestReviewsByPath(reviews: readonly FileReviewArtifact[]): readonly FileReviewArtifact[] {
  const byPath = new Map<string, FileReviewArtifact>();
  for (const review of reviews) {
    const existing = byPath.get(review.relativePath);
    if (existing === undefined || review.seq > existing.seq) byPath.set(review.relativePath, review);
  }
  return [...byPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function renderSourceControl(
  dom: CodeExplorerDom,
  reviews: readonly FileReviewArtifact[],
  onOpenReview: (review: FileReviewArtifact) => void,
): void {
  dom.sourceControl.replaceChildren();
  const rows = latestReviewsByPath(reviews);
  if (rows.length === 0) {
    dom.sourceControl.append(el("p", "code-scm__empty", "Chưa có thay đổi tệp nào trong cuộc trò chuyện này."));
    return;
  }
  for (const review of rows) {
    const row = el("button", "code-scm__row") as HTMLButtonElement;
    row.type = "button";
    row.title = review.relativePath;
    const badge = badgeForReview(review);
    const stats = diffStats(review.unifiedDiff);
    row.append(
      el("span", `code-badge code-badge--${badge.toLowerCase()}`, badge),
      el("span", "code-scm__name", baseName(review.relativePath)),
      el("span", "code-scm__dir", dirName(review.relativePath)),
      el("span", "code-scm__stats", `+${stats.adds} −${stats.dels}`),
    );
    row.addEventListener("click", () => onOpenReview(review));
    dom.sourceControl.append(row);
  }
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function dirName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, -1).join("/");
}
