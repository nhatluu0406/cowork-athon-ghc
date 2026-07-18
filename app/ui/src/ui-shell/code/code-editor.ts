/**
 * Code surface multi-tab editor (Code Phase 1).
 *
 * A stateful controller mounted once (like the Workspace companion pane and the navigator). It owns
 * the open-tab set, per-tab edit buffers, dirty/conflict state and save. It reuses the shared
 * backend contracts only — `readWorkspaceFileContent` / `writeWorkspaceFileContent` (the same
 * guarded loopback routes the Workspace companion uses) — and never touches `fs` or generic IPC.
 *
 * Editing is scoped to text/code files (the honest Phase 1 slice). Non-text kinds (PDF/Office/image/
 * binary/oversized) are not re-implemented here: the tab shows a read-only handoff card that opens
 * the file in the Workspace companion, which already renders those formats.
 */

import hljs from "highlight.js/lib/common";
import { languageForPath } from "@cowork-ghc/contracts";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import type { ServiceClient, WorkspaceFileContentView } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";
import { confirmDirtyClose, type CloseDirtyChoice } from "./confirm-dialog.js";
import { diffStats, parseUnifiedDiff } from "./parse-unified-diff.js";

/** See the Workspace companion: highlighting very large content blocks the renderer. */
const HIGHLIGHT_MAX_BYTES = 256 * 1024;

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

export type { CloseDirtyChoice };

export interface CodeEditorCallbacks {
  /** Hand off to the Workspace companion (surface switch handled by the app shell). */
  readonly onOpenInWorkspace?: (relativePath: string) => void;
  /** Hand off to Cowork with the composer seeded to ask about the active file (surface switch by app shell). */
  readonly onAskCowork?: (relativePath: string) => void;
  /** The active tab / its dirty state changed — the app re-reads `getActivePath()` for agent context. */
  readonly onActiveTabChange?: () => void;
  /** Confirm closing a tab with unsaved edits. Injectable so tests avoid the real modal. */
  readonly confirmDirtyClose?: (fileName: string) => Promise<CloseDirtyChoice>;
}

export interface CodeEditorController {
  readonly root: HTMLElement;
  /** Open (or re-activate) a workspace file tab. */
  openFile(relativePath: string): void;
  /** Open (or re-activate) a read-only diff tab for a File Work Review artifact. */
  openReview(review: FileReviewArtifact): void;
  /** Refresh the review data backing any open diff tabs (called on each surface render). */
  setReviews(reviews: readonly FileReviewArtifact[]): void;
  /** Active FILE tab's workspace-relative path (null for a diff tab, deleted tab, or none). */
  getActivePath(): string | null;
  readonly getOpenFilePaths: () => readonly string[];
  hasDirty(): boolean;
  /** Reflect a VERIFIED agent/external mutation of a file that may be open in a tab. */
  applyVerifiedMutation(relativePath: string, operation: "create" | "modify" | "delete"): void;
  /** Workspace changed — drop every tab and buffer (state reset for the new project). */
  reset(): void;
}

interface Tab {
  key: string;
  relativePath: string;
  kind: "file" | "review";
  reviewId: string | null;
  loading: boolean;
  error: string | null;
  view: WorkspaceFileContentView | null;
  dirty: boolean;
  /** Disk changed under a dirty buffer and the user chose "keep mine": a Save will overwrite. */
  diskChanged: boolean;
  /** The conflict banner was dismissed via "Giữ bản đang sửa" (the "Đĩa đã đổi" pill remains). */
  conflictDismissed: boolean;
  editMode: boolean;
  deleted: boolean;
  /** Live edit buffer (textarea value), preserved across tab switches. */
  buffer: string | null;
  scrollTop: number;
  /** A clean background tab whose disk content changed: reload when it is next activated. */
  stale: boolean;
}

function fileName(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? relativePath;
}

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

export function mountCodeEditor(
  container: HTMLElement,
  client: ServiceClient,
  callbacks: CodeEditorCallbacks = {},
): CodeEditorController {
  const confirmClose = callbacks.confirmDirtyClose ?? confirmDirtyClose;
  const tabs: Tab[] = [];
  let activeKey: string | null = null;
  let reviews: readonly FileReviewArtifact[] = [];
  /** Bumps on every async load so a resolved read for a since-closed/replaced tab is discarded. */
  let loadGeneration = 0;

  const root = el("div", "code-editor");
  const tabBar = el("div", "code-editor__tabs");
  tabBar.setAttribute("role", "tablist");
  tabBar.setAttribute("aria-label", "Tệp đang mở");
  const body = el("div", "code-editor__body");
  root.append(tabBar, body);
  container.replaceChildren(root);

  const findTab = (key: string): Tab | undefined => tabs.find((t) => t.key === key);
  const activeTab = (): Tab | null => (activeKey === null ? null : findTab(activeKey) ?? null);

  const notifyActive = (): void => {
    callbacks.onActiveTabChange?.();
  };

  const captureScroll = (): void => {
    const tab = activeTab();
    if (tab === null) return;
    const scroller = body.querySelector<HTMLElement>(".code-editor__scroll");
    if (scroller !== null) tab.scrollTop = scroller.scrollTop;
    const editor = body.querySelector<HTMLTextAreaElement>(".code-editor__textarea");
    if (editor !== null) tab.buffer = editor.value;
  };

  // ---- tab strip -----------------------------------------------------------------------------

  const renderTabs = (): void => {
    tabBar.replaceChildren();
    for (const tab of tabs) {
      const tabEl = el("div", "code-tab");
      tabEl.classList.toggle("code-tab--active", tab.key === activeKey);
      const select = el("button", "code-tab__select") as HTMLButtonElement;
      select.type = "button";
      select.setAttribute("role", "tab");
      select.setAttribute("aria-selected", tab.key === activeKey ? "true" : "false");
      if (tab.kind === "review") {
        const review = reviews.find((r) => r.id === tab.reviewId);
        if (review !== undefined) {
          const badge = badgeForReview(review);
          select.append(el("span", `code-badge code-badge--${badge.toLowerCase()}`, badge));
        }
      }
      if (tab.dirty) select.append(el("span", "code-tab__dirty", "●"));
      select.append(el("span", "code-tab__name", fileName(tab.relativePath)));
      select.title = tab.relativePath;
      select.addEventListener("click", () => activate(tab.key));
      const close = el("button", "code-tab__close", "×") as HTMLButtonElement;
      close.type = "button";
      close.setAttribute("aria-label", `Đóng ${fileName(tab.relativePath)}`);
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        void requestClose(tab.key);
      });
      tabEl.append(select, close);
      tabBar.append(tabEl);
    }
  };

  // ---- body ----------------------------------------------------------------------------------

  const renderBody = (): void => {
    const tab = activeTab();
    body.replaceChildren();
    if (tab === null) {
      body.append(renderWelcome());
      return;
    }
    if (tab.kind === "review") {
      const review = reviews.find((r) => r.id === tab.reviewId) ?? null;
      body.append(review === null ? renderMissingReview() : renderDiff(review));
      return;
    }
    if (tab.deleted) {
      body.append(renderDeleted(tab));
      return;
    }
    if (tab.loading) {
      body.append(renderToolbar(tab), el("p", "code-editor__notice", "Đang tải tệp…"));
      return;
    }
    if (tab.error !== null) {
      body.append(renderToolbar(tab), el("p", "code-editor__notice code-editor__notice--error", tab.error));
      return;
    }
    const view = tab.view;
    if (view === null) {
      body.append(renderToolbar(tab), el("p", "code-editor__notice", "Đang tải tệp…"));
      return;
    }
    if (view.kind === "text") {
      body.append(renderToolbar(tab), renderTextBody(tab, view));
      return;
    }
    // Non-text kinds are not duplicated in Code — hand off to the Workspace companion.
    body.append(renderToolbar(tab), renderHandoff(tab));
  };

  const renderToolbar = (tab: Tab): HTMLElement => {
    const toolbar = el("div", "code-editor__toolbar");
    toolbar.append(el("span", "code-editor__breadcrumb", tab.relativePath));
    const view = tab.view;
    const isText = view?.kind === "text";
    const editable = isText && view?.editable === true;

    if (isText && !editable) toolbar.append(el("span", "code-pill", "Chỉ đọc"));
    if (view?.truncated === true) toolbar.append(el("span", "code-pill", "Đã cắt bớt"));
    if (tab.diskChanged) toolbar.append(el("span", "code-pill code-pill--warn", "Đĩa đã đổi"));

    const spacer = el("span", "code-editor__toolbar-spacer");
    toolbar.append(spacer);

    if (editable && !tab.editMode) {
      const editBtn = el("button", "code-editor__action", "Sửa") as HTMLButtonElement;
      editBtn.type = "button";
      editBtn.addEventListener("click", () => {
        tab.editMode = true;
        renderBody();
      });
      toolbar.append(editBtn);
    }
    if (editable && tab.editMode) {
      const saveBtn = el("button", "code-editor__action code-editor__action--primary", "Lưu") as HTMLButtonElement;
      saveBtn.type = "button";
      saveBtn.disabled = !tab.dirty;
      if (tab.diskChanged) saveBtn.title = "Lưu sẽ GHI ĐÈ bản đã đổi trên đĩa";
      saveBtn.addEventListener("click", () => void saveTab(tab));
      toolbar.append(saveBtn);
    }

    const openWs = el("button", "code-editor__action", "Xem trong Workspace") as HTMLButtonElement;
    openWs.type = "button";
    openWs.addEventListener("click", () => callbacks.onOpenInWorkspace?.(tab.relativePath));
    toolbar.append(openWs);

    if (callbacks.onAskCowork !== undefined) {
      const ask = el("button", "code-editor__action", "Hỏi Cowork") as HTMLButtonElement;
      ask.type = "button";
      ask.setAttribute("aria-label", "Hỏi Cowork về tệp này");
      ask.addEventListener("click", () => callbacks.onAskCowork?.(tab.relativePath));
      toolbar.append(ask);
    }
    return toolbar;
  };

  const renderTextBody = (tab: Tab, view: WorkspaceFileContentView): HTMLElement => {
    const content = tab.buffer ?? view.content ?? "";
    const scroll = el("div", "code-editor__scroll");

    if (tab.editMode && view.editable) {
      const editor = el("textarea", "code-editor__textarea") as HTMLTextAreaElement;
      editor.value = content;
      editor.spellcheck = false;
      editor.addEventListener("input", () => {
        tab.buffer = editor.value;
        const nowDirty = editor.value !== (view.content ?? "");
        if (nowDirty !== tab.dirty) {
          tab.dirty = nowDirty;
          renderTabs();
          const saveBtn = body.querySelector<HTMLButtonElement>(".code-editor__action--primary");
          if (saveBtn !== null) saveBtn.disabled = !tab.dirty;
          notifyActive();
        }
      });
      scroll.append(editor);
      if (tab.diskChanged && !tab.conflictDismissed) scroll.prepend(renderConflictBanner(tab));
      queueMicrotask(() => {
        editor.scrollTop = tab.scrollTop;
        editor.focus();
      });
      return scroll;
    }

    const codeWrap = el("div", "code-editor__code");
    const lineCount = content.length === 0 ? 1 : content.split("\n").length;
    let numbers = "";
    for (let i = 1; i <= lineCount; i += 1) numbers += `${i}\n`;
    const gutter = el("div", "code-editor__gutter", numbers);
    gutter.setAttribute("aria-hidden", "true");
    const pre = el("pre", "code-editor__pre");
    const code = el("code", "code-editor__code-content");
    const language = content.length <= HIGHLIGHT_MAX_BYTES ? languageForPath(view.relativePath) : undefined;
    if (language !== undefined && hljs.getLanguage(language) !== undefined) {
      // highlight.js HTML-escapes source; `.value` is its own <span> markup → XSS-safe as innerHTML.
      code.innerHTML = hljs.highlight(content, { language, ignoreIllegals: true }).value;
      code.classList.add("hljs");
    } else {
      code.textContent = content;
    }
    pre.append(code);
    codeWrap.append(gutter, pre);
    scroll.append(codeWrap);
    if (tab.diskChanged && !tab.conflictDismissed) scroll.prepend(renderConflictBanner(tab));
    queueMicrotask(() => {
      scroll.scrollTop = tab.scrollTop;
    });
    return scroll;
  };

  const renderConflictBanner = (tab: Tab): HTMLElement => {
    const banner = el("div", "code-editor__conflict");
    banner.setAttribute("role", "alert");
    banner.append(
      el(
        "span",
        "code-editor__conflict-text",
        'Agent đã sửa tệp này trên đĩa, còn bạn có thay đổi chưa lưu. ' +
          '"Tải lại từ đĩa" sẽ bỏ toàn bộ thay đổi chưa lưu của bạn.',
      ),
    );
    const actions = el("div", "code-editor__conflict-actions");
    const keep = el("button", "code-editor__conflict-btn", "Giữ bản đang sửa") as HTMLButtonElement;
    keep.type = "button";
    keep.addEventListener("click", () => {
      // Keep the persistent "Đĩa đã đổi" warning (diskChanged stays true) but drop the banner.
      tab.conflictDismissed = true;
      banner.remove();
    });
    const reload = el(
      "button",
      "code-editor__conflict-btn code-editor__conflict-btn--danger",
      "Tải lại từ đĩa",
    ) as HTMLButtonElement;
    reload.type = "button";
    reload.addEventListener("click", () => {
      tab.dirty = false;
      tab.buffer = null;
      tab.diskChanged = false;
      void loadTab(tab);
    });
    actions.append(keep, reload);
    banner.append(actions);
    return banner;
  };

  const renderHandoff = (tab: Tab): HTMLElement => {
    const wrap = el("div", "code-editor__handoff");
    wrap.append(
      el("p", "code-editor__handoff-title", "Loại tệp này xem trong Workspace"),
      el(
        "p",
        "code-editor__handoff-copy",
        "Code Phase 1 tập trung vào tệp văn bản/mã. PDF, tài liệu Office, ảnh và tệp nhị phân được xem trong Workspace.",
      ),
    );
    const btn = el("button", "code-editor__action code-editor__action--primary", "Xem trong Workspace") as HTMLButtonElement;
    btn.type = "button";
    btn.addEventListener("click", () => callbacks.onOpenInWorkspace?.(tab.relativePath));
    wrap.append(btn);
    return wrap;
  };

  const renderDeleted = (tab: Tab): HTMLElement => {
    const wrap = el("div", "code-editor__handoff");
    wrap.append(
      el("p", "code-editor__handoff-title", "Tệp đã bị xóa"),
      el("p", "code-editor__handoff-copy", `Tệp "${tab.relativePath}" đã bị xóa (đã xác minh). Đóng tab này để dọn.`),
    );
    return wrap;
  };

  // ---- loading & saving ----------------------------------------------------------------------

  const loadTab = async (tab: Tab): Promise<void> => {
    const generation = (loadGeneration += 1);
    tab.loading = true;
    tab.error = null;
    tab.deleted = false;
    tab.stale = false;
    if (activeKey === tab.key) renderBody();
    try {
      const view = await client.readWorkspaceFileContent(tab.relativePath);
      if (generation !== loadGeneration || !tabs.includes(tab)) return;
      tab.view = view;
      tab.loading = false;
      tab.dirty = false;
      tab.diskChanged = false;
      tab.conflictDismissed = false;
      tab.buffer = null;
      tab.editMode = false;
      tab.scrollTop = 0;
      if (activeKey === tab.key) {
        renderBody();
        notifyActive();
      } else {
        renderTabs();
      }
    } catch (error) {
      if (generation !== loadGeneration || !tabs.includes(tab)) return;
      tab.loading = false;
      tab.error = error instanceof Error ? error.message : "Không tải được tệp.";
      if (activeKey === tab.key) renderBody();
    }
  };

  const saveTab = async (tab: Tab): Promise<void> => {
    if (tab.view === null || tab.view.kind !== "text" || !tab.view.editable) return;
    const content = tab.buffer ?? tab.view.content ?? "";
    const saveBtn = body.querySelector<HTMLButtonElement>(".code-editor__action--primary");
    if (saveBtn !== null) saveBtn.disabled = true;
    try {
      await client.writeWorkspaceFileContent(tab.relativePath, { kind: "text", content });
      // Re-read from disk so the tab reflects on-disk truth (mirrors the Workspace companion).
      await loadTab(tab);
      tab.editMode = true;
      if (activeKey === tab.key) renderBody();
    } catch (error) {
      tab.error = null;
      if (saveBtn !== null) saveBtn.disabled = false;
      const notice = el(
        "p",
        "code-editor__notice code-editor__notice--error",
        error instanceof Error ? error.message : "Lưu thất bại.",
      );
      body.prepend(notice);
      setTimeout(() => notice.remove(), 4000);
    }
  };

  // ---- public actions ------------------------------------------------------------------------

  const activate = (key: string): void => {
    if (activeKey === key) return;
    captureScroll();
    activeKey = key;
    const tab = findTab(key);
    if (tab !== undefined && tab.kind === "file" && !tab.deleted) {
      if (tab.stale && !tab.dirty) {
        void loadTab(tab);
      } else if (tab.view === null && !tab.loading && tab.error === null) {
        void loadTab(tab);
      }
    }
    renderTabs();
    renderBody();
    notifyActive();
  };

  const openFile = (relativePath: string): void => {
    const path = normalizePath(relativePath);
    const key = fileTabKey("file", path);
    const existing = findTab(key);
    if (existing !== undefined) {
      activate(key);
      return;
    }
    captureScroll();
    const tab: Tab = {
      key,
      relativePath: path,
      kind: "file",
      reviewId: null,
      loading: true,
      error: null,
      view: null,
      dirty: false,
      diskChanged: false,
      conflictDismissed: false,
      editMode: false,
      deleted: false,
      buffer: null,
      scrollTop: 0,
      stale: false,
    };
    tabs.push(tab);
    activeKey = key;
    renderTabs();
    renderBody();
    void loadTab(tab);
    notifyActive();
  };

  const openReview = (review: FileReviewArtifact): void => {
    const key = fileTabKey("review", review.relativePath);
    if (findTab(key) === undefined) {
      captureScroll();
      tabs.push({
        key,
        relativePath: review.relativePath,
        kind: "review",
        reviewId: review.id,
        loading: false,
        error: null,
        view: null,
        dirty: false,
        diskChanged: false,
        conflictDismissed: false,
        editMode: false,
        deleted: false,
        buffer: null,
        scrollTop: 0,
        stale: false,
      });
    }
    activeKey = key;
    renderTabs();
    renderBody();
    notifyActive();
  };

  const closeTab = (key: string): void => {
    const index = tabs.findIndex((t) => t.key === key);
    if (index < 0) return;
    tabs.splice(index, 1);
    if (activeKey === key) {
      activeKey = tabs[index]?.key ?? tabs[index - 1]?.key ?? tabs[0]?.key ?? null;
      const next = activeKey === null ? undefined : findTab(activeKey);
      if (next !== undefined && next.kind === "file" && next.view === null && !next.deleted && !next.loading) {
        void loadTab(next);
      }
    }
    renderTabs();
    renderBody();
    notifyActive();
  };

  const requestClose = async (key: string): Promise<void> => {
    const tab = findTab(key);
    if (tab === undefined) return;
    if (!tab.dirty) {
      closeTab(key);
      return;
    }
    const choice = await confirmClose(fileName(tab.relativePath));
    if (choice === "cancel") return;
    if (!tabs.includes(tab)) return;
    if (choice === "save") {
      await saveTab(tab);
      if (tab.dirty) return; // save failed — keep the tab and its buffer
    }
    closeTab(key);
  };

  const setReviews = (next: readonly FileReviewArtifact[]): void => {
    reviews = next;
    const active = activeTab();
    // Only re-render when a diff tab is showing, so a streaming tick never clobbers a live textarea.
    if (active !== null && active.kind === "review") renderBody();
    if (tabs.some((t) => t.kind === "review")) renderTabs();
  };

  const applyVerifiedMutation = (
    relativePath: string,
    operation: "create" | "modify" | "delete",
  ): void => {
    const path = normalizePath(relativePath);
    for (const tab of tabs) {
      if (tab.kind !== "file" || tab.relativePath !== path) continue;
      if (operation === "delete") {
        tab.deleted = true;
        tab.view = null;
        tab.dirty = false;
        tab.diskChanged = false;
        tab.buffer = null;
        tab.editMode = false;
        tab.stale = false;
        if (activeKey === tab.key) {
          renderTabs();
          renderBody();
          notifyActive();
        } else {
          renderTabs();
        }
        continue;
      }
      if (tab.dirty) {
        // Never overwrite unsaved edits: raise (or persist) a conflict.
        tab.diskChanged = true;
        tab.conflictDismissed = false;
        if (activeKey === tab.key) renderBody();
      } else if (activeKey === tab.key) {
        void loadTab(tab);
      } else {
        tab.stale = true; // reload lazily when the tab is next activated
      }
    }
  };

  const reset = (): void => {
    tabs.splice(0, tabs.length);
    activeKey = null;
    reviews = [];
    renderTabs();
    renderBody();
    notifyActive();
  };

  // Ctrl+S / Cmd+S saves the active editable text tab (only meaningful with unsaved edits).
  root.addEventListener("keydown", (event) => {
    if (event.key !== "s" || !(event.ctrlKey || event.metaKey)) return;
    const tab = activeTab();
    if (tab === null || tab.kind !== "file" || tab.deleted) return;
    if (tab.view?.kind !== "text" || tab.view.editable !== true) return;
    event.preventDefault();
    if (tab.dirty) void saveTab(tab);
  });

  renderTabs();
  renderBody();

  return {
    root,
    openFile,
    openReview,
    setReviews,
    getActivePath: () => {
      const tab = activeTab();
      return tab !== null && tab.kind === "file" && !tab.deleted ? tab.relativePath : null;
    },
    getOpenFilePaths: () => tabs.filter((t) => t.kind === "file").map((t) => t.relativePath),
    hasDirty: () => tabs.some((t) => t.dirty),
    applyVerifiedMutation,
    reset,
  };
}

// ---- diff rendering (read-only File Work Review) ----------------------------------------------

function renderWelcome(): HTMLElement {
  const wrap = el("div", "code-editor__welcome");
  const iconWrap = el("div", "code-editor__welcome-icon");
  iconWrap.append(icon("code", "Code"));
  wrap.append(
    iconWrap,
    el("h2", "code-editor__welcome-title", "Chưa mở tệp nào"),
    el(
      "p",
      "code-editor__welcome-copy",
      "Chọn tệp trong Explorer để mở thành tab và chỉnh sửa, hoặc mở một thay đổi trong SOURCE CONTROL để xem diff.",
    ),
  );
  return wrap;
}

function renderMissingReview(): HTMLElement {
  return el("p", "code-editor__notice", "Không tìm thấy dữ liệu review cho tệp này trong cuộc trò chuyện hiện tại.");
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
    const rowEl = el("div", `code-diff__row code-diff__row--${line.type}`);
    rowEl.append(
      el("span", "code-diff__gutter", line.oldN === null ? "" : String(line.oldN)),
      el("span", "code-diff__gutter", line.newN === null ? "" : String(line.newN)),
      el("code", "code-diff__text", line.text),
    );
    grid.append(rowEl);
  }
  wrap.append(grid);
  return wrap;
}
