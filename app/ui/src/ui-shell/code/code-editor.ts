import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import { el, icon } from "../dom-utils.js";
import { diffStats, parseUnifiedDiff } from "./parse-unified-diff.js";

export type ChangeBadge = "A" | "M" | "D";

export function badgeForReview(review: Pick<FileReviewArtifact, "eventKind">): ChangeBadge {
  if (review.eventKind === "file_created") return "A";
  if (review.eventKind === "file_deleted") return "D";
  return "M";
}

export interface OpenCodeFile {
  readonly key: string;
  readonly relativePath: string;
  readonly kind: "file" | "review";
  readonly reviewId?: string;
}

export function fileTabKey(kind: "file" | "review", relativePath: string): string {
  return `${kind}:${relativePath}`;
}

export interface CodeEditorDom {
  readonly root: HTMLElement;
  readonly tabBar: HTMLElement;
  readonly body: HTMLElement;
  lastLoadedKey: string | null;
}

export interface CodeEditorHandlers {
  readonly onSelect: (key: string) => void;
  readonly onClose: (key: string) => void;
  readonly onLoadFile: (relativePath: string, body: HTMLElement) => void;
}

export function createCodeEditor(): CodeEditorDom {
  const root = el("div", "code-editor");
  const tabBar = el("div", "code-editor__tabs");
  tabBar.setAttribute("role", "tablist");
  tabBar.setAttribute("aria-label", "Tệp đang mở");
  const body = el("div", "code-editor__body");
  root.append(tabBar, body);
  return { root, tabBar, body, lastLoadedKey: null };
}

export function renderCodeEditor(
  dom: CodeEditorDom,
  state: {
    readonly openFiles: readonly OpenCodeFile[];
    readonly activeKey: string | null;
    readonly reviews: readonly FileReviewArtifact[];
  },
  handlers: CodeEditorHandlers,
): void {
  renderTabs(dom.tabBar, state, handlers);
  const active = state.openFiles.find((file) => file.key === state.activeKey) ?? null;
  if (active === null) {
    dom.lastLoadedKey = null;
    dom.body.replaceChildren();
    dom.body.append(renderWelcome());
    return;
  }
  if (active.kind === "review") {
    dom.lastLoadedKey = null;
    dom.body.replaceChildren();
    const review = state.reviews.find((r) => r.id === active.reviewId) ?? null;
    dom.body.append(review === null ? renderMissingReview() : renderDiff(review));
    return;
  }
  if (dom.lastLoadedKey === active.key) {
    return;
  }
  dom.lastLoadedKey = active.key;
  dom.body.replaceChildren();
  dom.body.append(renderPlainToolbar(active));
  const pre = el("pre", "code-editor__plain", "Đang tải xem trước...");
  dom.body.append(pre);
  handlers.onLoadFile(active.relativePath, pre);
}

function renderTabs(
  tabBar: HTMLElement,
  state: Parameters<typeof renderCodeEditor>[1],
  handlers: CodeEditorHandlers,
): void {
  tabBar.replaceChildren();
  for (const file of state.openFiles) {
    const tab = el("div", "code-tab");
    tab.classList.toggle("code-tab--active", file.key === state.activeKey);
    const select = el("button", "code-tab__select") as HTMLButtonElement;
    select.type = "button";
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", file.key === state.activeKey ? "true" : "false");
    if (file.kind === "review") {
      const review = state.reviews.find((r) => r.id === file.reviewId);
      if (review !== undefined) {
        const badge = badgeForReview(review);
        select.append(el("span", `code-badge code-badge--${badge.toLowerCase()}`, badge));
      }
    }
    select.append(el("span", "code-tab__name", fileName(file.relativePath)));
    select.title = file.relativePath;
    select.addEventListener("click", () => handlers.onSelect(file.key));
    const close = el("button", "code-tab__close", "×") as HTMLButtonElement;
    close.type = "button";
    close.setAttribute("aria-label", `Đóng ${fileName(file.relativePath)}`);
    close.addEventListener("click", () => handlers.onClose(file.key));
    tab.append(select, close);
    tabBar.append(tab);
  }
}

function fileName(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? relativePath;
}

function renderWelcome(): HTMLElement {
  const wrap = el("div", "code-editor__welcome");
  const iconWrap = el("div", "code-editor__welcome-icon");
  iconWrap.append(icon("code", "Claude Code"));
  wrap.append(
    iconWrap,
    el("h2", "code-editor__welcome-title", "Chưa mở tệp nào"),
    el("p", "code-editor__welcome-copy", "Chọn tệp trong Explorer để xem nội dung (chỉ đọc), hoặc mở một thay đổi trong SOURCE CONTROL để xem diff."),
  );
  return wrap;
}

function renderMissingReview(): HTMLElement {
  return el("p", "code-editor__notice", "Không tìm thấy dữ liệu review cho tệp này trong cuộc trò chuyện hiện tại.");
}

function renderPlainToolbar(file: OpenCodeFile): HTMLElement {
  const toolbar = el("div", "code-editor__toolbar");
  toolbar.append(el("span", "code-editor__breadcrumb", file.relativePath), el("span", "code-pill", "Chỉ đọc"));
  return toolbar;
}

function renderDiff(review: FileReviewArtifact): HTMLElement {
  const wrap = el("div", "code-diff");
  const toolbar = el("div", "code-editor__toolbar");
  const stats = diffStats(review.unifiedDiff);
  toolbar.append(el("span", "code-editor__breadcrumb", review.relativePath));
  toolbar.append(el("span", "code-diff__adds", `+${stats.adds}`), el("span", "code-diff__dels", `−${stats.dels}`));
  if (review.afterExists === false) toolbar.append(el("span", "code-pill code-pill--deleted", "Đã xoá"));
  if (review.diffTruncated) toolbar.append(el("span", "code-pill", "Diff đã cắt bớt"));
  wrap.append(toolbar);
  if (review.contentRedacted) {
    wrap.append(el("p", "code-editor__notice", "Nội dung bị ẩn vì file có thể chứa credential hoặc secret."));
    return wrap;
  }
  if (review.isBinary) {
    wrap.append(el("p", "code-editor__notice", "Tệp nhị phân — chỉ có metadata, không có diff nội dung."));
    return wrap;
  }
  const grid = el("div", "code-diff__grid");
  for (const line of parseUnifiedDiff(review.unifiedDiff ?? "")) {
    const row = el("div", `code-diff__row code-diff__row--${line.type}`);
    row.append(
      el("span", "code-diff__gutter", line.oldN === null ? "" : String(line.oldN)),
      el("span", "code-diff__gutter", line.newN === null ? "" : String(line.newN)),
      el("code", "code-diff__text", line.text),
    );
    grid.append(row);
  }
  wrap.append(grid);
  return wrap;
}
