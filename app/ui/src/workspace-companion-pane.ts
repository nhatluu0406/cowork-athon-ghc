/**
 * Workspace Companion pane — rich preview and basic editing.
 */

import hljs from "highlight.js/lib/common";
import { languageForPath } from "@cowork-ghc/contracts";
import type { ServiceClient } from "./service-client.js";
import { el, icon } from "./ui-shell/dom-utils.js";
import { isAutoOpenSafe } from "./workspace-file-role.js";

/**
 * Above this size we render text/code as plain (no highlighting): highlighting a large file is
 * slow and blocks the renderer, and the value of syntax colour drops for machine-sized files.
 * Line numbers + monospace still apply. (The service separately truncates text at 512 KiB.)
 */
const HIGHLIGHT_MAX_BYTES = 256 * 1024;

export type WorkspaceFileContentView = Awaited<ReturnType<ServiceClient["readWorkspaceFileContent"]>>;

export interface WorkspaceCompanionPaneDom {
  readonly root: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly pathLabel: HTMLElement;
  readonly statusBadge: HTMLElement;
  readonly saveButton: HTMLButtonElement;
  readonly body: HTMLElement;
}

export interface WorkspaceCompanionPaneHandle {
  readonly open: (relativePath: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly getOpenPath: () => string | null;
  /**
   * A verified agent mutation touched the currently-open file. Reloads from disk when the
   * buffer is clean; when the buffer is dirty it shows a conflict banner instead of
   * overwriting the user's unsaved edits (the user picks keep-mine or reload-from-disk).
   */
  readonly showAgentUpdated: () => void;
  /**
   * A verified DELETE removed the currently-open file. Clears the stale preview/editor, shows a
   * "Tệp đã bị xóa" empty state, and blocks Save so it cannot silently recreate the file. Only
   * call this for a verified delete — never on a model's unverified claim.
   */
  readonly showDeleted: () => void;
  /**
   * Auto-open a file affected by a verified agent mutation, but only when it is SAFE:
   * a supported non-secret previewable kind, not oversized (the service returns
   * `unsupported`), and not while the current buffer has unsaved edits. Returns whether the
   * file was opened. Never yanks the user off a dirty buffer.
   */
  readonly openIfSafe: (relativePath: string) => Promise<boolean>;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64ToBlobUrl(base64: string, mime: string): string {
  const blob = new Blob([base64ToBytes(base64)], { type: mime });
  return URL.createObjectURL(blob);
}

/**
 * Minimal surface of `@aiden0z/pptx-renderer`'s PptxViewer that this pane drives. Kept local so the
 * pane depends on a small contract (and tests can inject a fake), not the library's full type.
 */
export interface PptxViewerLike {
  open(
    input: ArrayBuffer | Uint8Array | Blob,
    options?: { renderMode?: "list" | "slide"; signal?: AbortSignal },
  ): Promise<void>;
  goToSlide(index: number): Promise<void>;
  readonly slideCount: number;
  readonly currentSlideIndex: number;
  on(type: "slidechange", listener: (event: { detail: { index: number } }) => void): unknown;
  destroy(): void;
}

export interface PptxViewerModuleLike {
  readonly PptxViewer: new (
    container: HTMLElement,
    options?: Record<string, unknown>,
  ) => PptxViewerLike;
  readonly RECOMMENDED_ZIP_LIMITS: unknown;
}

export interface WorkspaceCompanionPaneOptions {
  /**
   * Loads the local PPTX rendering engine. Defaults to a dynamic import of the self-contained
   * browser build (code-split so the ~1.5 MiB engine is only fetched when a deck is opened). Tests
   * inject a fake to exercise the wiring without a real browser layout engine.
   */
  readonly loadPptxViewer?: () => Promise<PptxViewerModuleLike>;
  /**
   * Workspace → Code handoff (Code Phase 1). When provided, an "Mở trong Code" action appears for
   * text/code files and opens the same workspace-relative file in the Code multi-tab editor. The
   * app shell owns the surface switch; the active workspace never changes.
   */
  readonly onOpenInCode?: (relativePath: string) => void;
}

export function mountWorkspaceCompanionPane(
  container: HTMLElement,
  client: ServiceClient,
  options: WorkspaceCompanionPaneOptions = {},
): WorkspaceCompanionPaneHandle {
  const loadPptxViewer =
    options.loadPptxViewer ??
    (() =>
      // The `/browser` entry is self-contained (JSZip + ECharts inlined) and strips Node `process.env`
      // checks at build time — it runs under our strict `script-src 'self'` CSP (no eval on any live
      // path) with no remote/CDN fetch.
      import("@aiden0z/pptx-renderer/browser") as unknown as Promise<PptxViewerModuleLike>);
  let openPath: string | null = null;
  let current: WorkspaceFileContentView | null = null;
  let dirty = false;
  // The disk version changed under a dirty buffer and the user chose "keep mine": stays true so
  // the UI keeps warning that a Save will overwrite the agent's version, until reload/save/reopen.
  let diskChanged = false;
  let blobUrl: string | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  // Text/code files show a read-only, syntax-highlighted view first; the user opts into editing.
  let editMode = false;
  // Active sheet index for a multi-sheet spreadsheet, and active slide index for a presentation.
  // Both reset to 0 in renderFile so opening a new workbook/deck starts at the first item.
  let sheetIndex = 0;
  let slideIndex = 0;
  // High-fidelity PowerPoint viewer state (lazy-loaded engine). See destroyPptxViewer.
  let pptxViewer: PptxViewerLike | null = null;
  let pptxGeneration = 0;

  const root = el("div", "workspace-companion-pane");
  const toolbar = el("div", "workspace-companion-pane__toolbar");
  const pathWrap = el("div", "workspace-companion-pane__path-wrap");
  pathWrap.append(icon("file", "Tệp đang mở"));
  const pathLabel = el("span", "workspace-companion-pane__path", "Xem trước tệp");
  pathWrap.append(pathLabel);
  const statusBadge = el("span", "workspace-companion-pane__status", "Chưa chọn tệp");
  const editButton = el("button", "workspace-companion-pane__edit") as HTMLButtonElement;
  editButton.type = "button";
  editButton.hidden = true;
  editButton.dataset["tooltip"] = "Chỉnh sửa tệp";
  editButton.setAttribute("aria-label", "Chỉnh sửa tệp");
  editButton.append(icon("pencil", "Chỉnh sửa"));
  const saveButton = el("button", "workspace-companion-pane__save") as HTMLButtonElement;
  saveButton.type = "button";
  saveButton.hidden = true;
  saveButton.dataset["tooltip"] = "Lưu tệp";
  saveButton.setAttribute("aria-label", "Lưu tệp");
  saveButton.append(icon("save", "Lưu tệp"));
  // Workspace → Code handoff: only shown for text/code files when a handler is wired.
  const openInCodeButton = el(
    "button",
    "workspace-companion-pane__open-in-code",
    "Mở trong Code",
  ) as HTMLButtonElement;
  openInCodeButton.type = "button";
  openInCodeButton.hidden = true;
  openInCodeButton.setAttribute("aria-label", "Mở tệp này trong Code");
  openInCodeButton.addEventListener("click", () => {
    if (openPath !== null) options.onOpenInCode?.(openPath);
  });
  toolbar.append(pathWrap, statusBadge, editButton, saveButton, openInCodeButton);

  // Conflict banner: shown when an agent edits the open file while the buffer is dirty.
  const conflictBanner = el("div", "workspace-companion-pane__conflict");
  conflictBanner.hidden = true;
  conflictBanner.setAttribute("role", "alert");
  const conflictText = el(
    "span",
    "workspace-companion-pane__conflict-text",
    'Agent đã sửa tệp này trên đĩa, còn bạn có thay đổi chưa lưu. ' +
      '"Tải lại từ đĩa" sẽ bỏ toàn bộ thay đổi chưa lưu của bạn.',
  );
  const conflictActions = el("div", "workspace-companion-pane__conflict-actions");
  const keepButton = el(
    "button",
    "workspace-companion-pane__conflict-btn",
    "Giữ bản đang sửa",
  ) as HTMLButtonElement;
  keepButton.type = "button";
  const reloadButton = el(
    "button",
    "workspace-companion-pane__conflict-btn workspace-companion-pane__conflict-btn--danger",
    "Tải lại từ đĩa",
  ) as HTMLButtonElement;
  reloadButton.type = "button";
  conflictActions.append(keepButton, reloadButton);
  conflictBanner.append(conflictText, conflictActions);

  const body = el("div", "workspace-companion-pane__body");
  const empty = el("div", "workspace-companion-pane__empty");
  const emptyIcon = el("div", "workspace-companion-pane__empty-icon");
  emptyIcon.append(icon("workspace", "Workspace"));
  const formats = el("div", "workspace-companion-pane__formats");
  for (const format of ["TXT", "MD", "DOCX", "PDF", "Ảnh", "XLSX", "PPTX"]) {
    formats.append(el("span", "workspace-companion-pane__format", format));
  }
  empty.append(
    emptyIcon,
    el("h2", "workspace-companion-pane__empty-title", "Mở một tệp để bắt đầu"),
    el(
      "p",
      "workspace-companion-pane__empty-copy",
      "Chọn tệp ở sidebar để xem trước tại đây, rồi thảo luận hoặc yêu cầu Agent chỉnh sửa ở panel Cowork bên cạnh.",
    ),
    formats,
  );
  body.append(empty);
  root.append(toolbar, conflictBanner, body);
  container.replaceChildren(root);

  const hideConflict = (): void => {
    conflictBanner.hidden = true;
  };

  // Persistent "disk changed under your edits" indicator that survives after the user chooses
  // "keep mine", so they cannot forget the conflict and Save over the agent's version.
  const setDiskChanged = (on: boolean): void => {
    diskChanged = on;
    saveButton.classList.toggle("workspace-companion-pane__save--warn", on);
    saveButton.dataset["tooltip"] = on ? "Lưu sẽ GHI ĐÈ bản đã đổi trên đĩa" : "Lưu tệp";
  };

  const revokeBlob = (): void => {
    if (blobUrl !== null) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
  };

  // Active high-fidelity PPTX viewer, if any. `pptxGeneration` guards against races when the user
  // switches files while a deck is still loading: an outdated load resolves into a discarded viewer.
  const destroyPptxViewer = (): void => {
    pptxGeneration += 1;
    if (pptxViewer !== null) {
      try {
        pptxViewer.destroy();
      } catch {
        // destroy() best-effort: never let viewer teardown break rendering the next file.
      }
      pptxViewer = null;
    }
  };

  const setStatus = (text: string, autoHideMs = 0): void => {
    statusBadge.textContent = text;
    statusBadge.hidden = false;
    if (statusTimer !== null) clearTimeout(statusTimer);
    if (autoHideMs > 0) {
      statusTimer = setTimeout(() => {
        statusBadge.hidden = true;
      }, autoHideMs);
    }
  };

  const markDirty = (): void => {
    dirty = true;
    saveButton.hidden = !(current?.editable === true);
    saveButton.disabled = false;
  };

  /**
   * Render a text/code file. Read-only mode shows a syntax-highlighted, line-numbered view;
   * edit mode shows the plain editable textarea (the Save path reads this textarea). Highlighting
   * is skipped for very large content (plain, but still line-numbered) to keep the UI responsive.
   */
  const renderTextContent = (file: WorkspaceFileContentView): void => {
    const content = file.content ?? "";

    if (editMode && file.editable) {
      const editor = el("textarea", "workspace-companion-pane__editor") as HTMLTextAreaElement;
      editor.value = content;
      editor.spellcheck = false;
      editor.addEventListener("input", markDirty);
      body.replaceChildren(editor);
      editButton.hidden = true;
      saveButton.hidden = false;
      saveButton.disabled = !dirty;
      editor.focus();
      return;
    }

    const view = el("div", "workspace-companion-pane__code");
    const lineCount = content.length === 0 ? 1 : content.split("\n").length;
    let numbers = "";
    for (let i = 1; i <= lineCount; i += 1) numbers += `${i}\n`;
    const gutter = el("div", "workspace-companion-pane__code-gutter", numbers);
    gutter.setAttribute("aria-hidden", "true");
    const pre = el("pre", "workspace-companion-pane__code-pre");
    const code = el("code", "workspace-companion-pane__code-content");
    const language =
      content.length <= HIGHLIGHT_MAX_BYTES ? languageForPath(file.relativePath) : undefined;
    if (language !== undefined && hljs.getLanguage(language) !== undefined) {
      // highlight.js HTML-escapes the source; `.value` contains only its own <span> markup, so
      // assigning it as innerHTML on this detached <code> is XSS-safe for arbitrary file content.
      code.innerHTML = hljs.highlight(content, { language, ignoreIllegals: true }).value;
      code.classList.add("hljs");
    } else {
      code.textContent = content;
    }
    pre.append(code);
    view.append(gutter, pre);
    body.replaceChildren(view);

    editButton.hidden = !file.editable;
    saveButton.hidden = true;
  };

  const renderSpreadsheet = (file: WorkspaceFileContentView): void => {
    const sheets = file.sheets ?? [];
    if (sheets.length === 0) {
      body.replaceChildren(
        el("p", "workspace-companion-pane__message", "Workbook không có sheet hiển thị được."),
      );
      return;
    }
    if (sheetIndex >= sheets.length) sheetIndex = 0;
    const sheet = sheets[sheetIndex]!;

    const wrap = el("div", "workspace-companion-pane__sheet-wrap");

    // Sheet selector: a compact tab row near the header. Only shown when there is more than one
    // visible sheet. Switching a sheet re-renders only this grid — no full Workspace reload.
    if (sheets.length > 1) {
      const tabs = el("div", "workspace-companion-pane__sheet-tabs");
      tabs.setAttribute("role", "tablist");
      sheets.forEach((s, i) => {
        const tab = el(
          "button",
          "workspace-companion-pane__sheet-tab" +
            (i === sheetIndex ? " workspace-companion-pane__sheet-tab--active" : ""),
          s.name,
        ) as HTMLButtonElement;
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(i === sheetIndex));
        tab.title = s.name;
        tab.addEventListener("click", () => {
          if (i === sheetIndex) return;
          sheetIndex = i;
          renderSpreadsheet(file);
        });
        tabs.append(tab);
      });
      wrap.append(tabs);
    }

    const table = el("table", "workspace-companion-pane__grid");
    const tbody = el("tbody", "workspace-companion-pane__grid-body");
    const rows = sheet.rows.map((row: readonly string[]) => [...row]);
    const ensureRow = (index: number): string[] => {
      while (rows.length <= index) rows.push([]);
      const row = rows[index]!;
      return row;
    };
    const maxCols = Math.max(4, ...rows.map((r: string[]) => r.length));
    for (let r = 0; r < Math.max(rows.length, 8); r += 1) {
      const tr = el("tr", "workspace-companion-pane__grid-row");
      const row = ensureRow(r);
      for (let c = 0; c < maxCols; c += 1) {
        const td = el("td", "workspace-companion-pane__grid-cell");
        const input = el("input", "workspace-companion-pane__grid-input") as HTMLInputElement;
        input.type = "text";
        input.value = row[c] ?? "";
        input.readOnly = !file.editable;
        input.dataset["row"] = String(r);
        input.dataset["col"] = String(c);
        if (file.editable) {
          input.addEventListener("input", () => {
            const ri = Number(input.dataset["row"]);
            const ci = Number(input.dataset["col"]);
            const target = ensureRow(ri);
            target[ci] = input.value;
            markDirty();
          });
        }
        td.append(input);
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    body.replaceChildren(wrap);
    (table as unknown as { __rows: string[][] }).__rows = rows;
    (table as unknown as { __sheetName: string }).__sheetName = sheet.name;
  };

  /**
   * Text-first PowerPoint fallback: one slide's extracted text at a time with previous/next
   * navigation and a "Slide X / Y" counter. Used when raw bytes are unavailable or when the
   * high-fidelity engine fails at runtime. Switching slides re-renders only this deck.
   */
  const renderPresentationText = (file: WorkspaceFileContentView): void => {
    const slides = file.slides ?? [];
    if (slides.length === 0) {
      body.replaceChildren(
        el("p", "workspace-companion-pane__message", "Không có slide nào để hiển thị."),
      );
      return;
    }
    if (slideIndex >= slides.length) slideIndex = 0;
    if (slideIndex < 0) slideIndex = 0;
    const slide = slides[slideIndex]!;

    const deck = el("div", "workspace-companion-pane__deck");
    const nav = el("div", "workspace-companion-pane__deck-nav");
    const prev = el("button", "workspace-companion-pane__deck-btn") as HTMLButtonElement;
    prev.type = "button";
    prev.dataset["tooltip"] = "Slide trước";
    prev.setAttribute("aria-label", "Slide trước");
    prev.append(icon("arrow-left", "Slide trước"));
    prev.disabled = slideIndex === 0;
    const counter = el(
      "span",
      "workspace-companion-pane__deck-counter",
      `Slide ${slideIndex + 1} / ${slides.length}`,
    );
    const next = el("button", "workspace-companion-pane__deck-btn") as HTMLButtonElement;
    next.type = "button";
    next.dataset["tooltip"] = "Slide sau";
    next.setAttribute("aria-label", "Slide sau");
    next.append(icon("arrow-right", "Slide sau"));
    next.disabled = slideIndex === slides.length - 1;
    prev.addEventListener("click", () => {
      if (slideIndex === 0) return;
      slideIndex -= 1;
      renderPresentationText(file);
    });
    next.addEventListener("click", () => {
      if (slideIndex >= slides.length - 1) return;
      slideIndex += 1;
      renderPresentationText(file);
    });
    nav.append(prev, counter, next);

    const stage = el("div", "workspace-companion-pane__slide");
    if (slide.text.trim().length === 0) {
      stage.append(
        el("p", "workspace-companion-pane__slide-empty", "Slide này không có nội dung văn bản."),
      );
    } else {
      stage.append(el("pre", "workspace-companion-pane__slide-text", slide.text));
    }
    deck.append(nav, stage);
    body.replaceChildren(deck);
  };

  /**
   * Render a read-only PowerPoint (.pptx) preview with the local high-fidelity engine: real slide
   * layout (text position/size/colour, images, shapes, tables, charts, theme backgrounds) rendered
   * as HTML/SVG DOM, one slide at a time, with previous/next navigation and a "Slide X / Y" counter.
   * The engine runs fully local (no cloud/LibreOffice/remote), under our strict CSP. Switching slides
   * calls goToSlide on the existing viewer — never a whole-Workspace reload. On any runtime failure it
   * degrades to the text-first fallback so the user still sees the deck content.
   */
  const renderPresentationHiFi = (file: WorkspaceFileContentView, bytes: Uint8Array): void => {
    destroyPptxViewer();
    const generation = pptxGeneration;

    const deck = el("div", "workspace-companion-pane__deck");
    const nav = el("div", "workspace-companion-pane__deck-nav");
    const prev = el("button", "workspace-companion-pane__deck-btn") as HTMLButtonElement;
    prev.type = "button";
    prev.dataset["tooltip"] = "Slide trước";
    prev.setAttribute("aria-label", "Slide trước");
    prev.append(icon("arrow-left", "Slide trước"));
    prev.disabled = true;
    let total = file.slides?.length ?? 0;
    const counter = el(
      "span",
      "workspace-companion-pane__deck-counter",
      `Slide 1 / ${total > 0 ? total : "…"}`,
    );
    const next = el("button", "workspace-companion-pane__deck-btn") as HTMLButtonElement;
    next.type = "button";
    next.dataset["tooltip"] = "Slide sau";
    next.setAttribute("aria-label", "Slide sau");
    next.append(icon("arrow-right", "Slide sau"));
    next.disabled = true;
    nav.append(prev, counter, next);

    const stage = el("div", "workspace-companion-pane__slide workspace-companion-pane__slide--hifi");
    const mount = el("div", "workspace-companion-pane__slide-mount");
    const loading = el("p", "workspace-companion-pane__slide-loading", "Đang dựng slide…");
    stage.append(mount, loading);
    deck.append(nav, stage);
    body.replaceChildren(deck);
    setStatus("Chỉ xem — bản dựng PowerPoint cục bộ (không hiển thị đúng 100%)", 0);

    let index = 0;
    const sync = (): void => {
      counter.textContent = `Slide ${Math.min(index + 1, total)} / ${total}`;
      prev.disabled = index <= 0;
      next.disabled = index >= total - 1;
    };

    loadPptxViewer()
      .then(async (mod) => {
        if (generation !== pptxGeneration) return;
        const viewer = new mod.PptxViewer(mount, {
          fitMode: "contain",
          // EMF/PDF-fallback rendering (pdf.js) is disabled: it would need `worker-src blob:` in the
          // CSP, which we do not grant. Charts still render via the bundled ECharts.
          pdfjs: false,
          // Bound ZIP parsing (entry count / uncompressed size / media size) to cap the DoS surface.
          zipLimits: mod.RECOMMENDED_ZIP_LIMITS,
        });
        await viewer.open(bytes, { renderMode: "slide" });
        if (generation !== pptxGeneration) {
          try {
            viewer.destroy();
          } catch {
            /* best-effort */
          }
          return;
        }
        pptxViewer = viewer;
        total = viewer.slideCount || total;
        index = viewer.currentSlideIndex || 0;
        loading.remove();
        viewer.on("slidechange", (event) => {
          if (generation !== pptxGeneration) return;
          index = event.detail.index;
          sync();
        });
        prev.addEventListener("click", () => {
          if (index <= 0) return;
          index -= 1;
          sync();
          void viewer.goToSlide(index);
        });
        next.addEventListener("click", () => {
          if (index >= total - 1) return;
          index += 1;
          sync();
          void viewer.goToSlide(index);
        });
        sync();
      })
      .catch(() => {
        if (generation !== pptxGeneration) return;
        // The engine failed at runtime (unexpected geometry, chart, etc.). Degrade to text-first so
        // the deck's content is still readable, and say so honestly.
        renderPresentationText(file);
        setStatus("Không dựng được bản đầy đủ — hiển thị văn bản slide.", 0);
      });
  };

  /**
   * Dispatch to the high-fidelity engine when the raw .pptx bytes are present, else the text-first
   * fallback. The service only sets `dataBase64` for a deck it could structurally parse.
   */
  const renderPresentation = (file: WorkspaceFileContentView): void => {
    if (file.dataBase64) {
      renderPresentationHiFi(file, base64ToBytes(file.dataBase64));
      return;
    }
    renderPresentationText(file);
    setStatus("Chỉ xem — bản xem trước văn bản PowerPoint (không hiển thị đúng 100%)", 0);
  };

  const collectSpreadsheetRows = (): { name: string; rows: string[][] } => {
    const table = body.querySelector(".workspace-companion-pane__grid") as
      | (HTMLElement & { __rows?: string[][]; __sheetName?: string })
      | null;
    return {
      name: table?.__sheetName ?? "Sheet1",
      rows: table?.__rows?.map((row) => [...row]) ?? [[""]],
    };
  };

  const renderFile = (file: WorkspaceFileContentView): void => {
    current = file;
    dirty = false;
    editMode = false;
    sheetIndex = 0;
    slideIndex = 0;
    hideConflict();
    setDiskChanged(false);
    editButton.hidden = true;
    saveButton.hidden = !file.editable;
    saveButton.disabled = true;
    openInCodeButton.hidden = !(file.kind === "text" && options.onOpenInCode !== undefined);
    revokeBlob();
    destroyPptxViewer();
    pathLabel.textContent = file.relativePath;
    statusBadge.hidden = true;
    pathLabel.title = file.relativePath;

    if (file.kind === "missing") {
      body.replaceChildren(el("p", "workspace-companion-pane__message", "Không tìm thấy tệp."));
      return;
    }
    if (file.kind === "unsupported") {
      body.replaceChildren(el("p", "workspace-companion-pane__message", "Chưa hỗ trợ loại tệp này."));
      return;
    }
    if (file.kind === "text") {
      renderTextContent(file);
      if (file.truncated) {
        setStatus("Đã cắt bớt — tệp lớn hơn 512 KiB", 0);
      }
      return;
    }
    if (file.kind === "image" && file.dataBase64 && file.mimeType) {
      const img = el("img", "workspace-companion-pane__image") as HTMLImageElement;
      img.src = `data:${file.mimeType};base64,${file.dataBase64}`;
      img.alt = file.relativePath;
      body.replaceChildren(img);
      return;
    }
    if (file.kind === "pdf" && file.dataBase64) {
      blobUrl = base64ToBlobUrl(file.dataBase64, "application/pdf");
      const frame = el("iframe", "workspace-companion-pane__pdf") as HTMLIFrameElement;
      // PDFium open params: hide the viewer toolbar + thumbnail rail and fit the page to width for
      // a clean, embedded preview by default (the user can still scroll/zoom via the context menu).
      frame.src = `${blobUrl}#toolbar=0&navpanes=0&view=FitH`;
      frame.title = file.relativePath;
      body.replaceChildren(frame);
      return;
    }
    if (file.kind === "docx") {
      const article = el("article", "workspace-companion-pane__docx");
      article.textContent = file.content ?? "";
      body.replaceChildren(article);
      return;
    }
    if (file.kind === "spreadsheet") {
      renderSpreadsheet(file);
      if (!file.editable) setStatus("Chỉ xem — bảo toàn công thức và định dạng XLSX", 0);
      return;
    }
    if (file.kind === "presentation") {
      renderPresentation(file);
      return;
    }
    body.replaceChildren(el("p", "workspace-companion-pane__message", "Không hiển thị được tệp."));
  };

  const load = async (relativePath: string): Promise<void> => {
    if (dirty && openPath !== null && relativePath !== openPath) {
      setStatus("Bạn có thay đổi chưa lưu. Hãy lưu trước khi mở tệp khác.", 0);
      return;
    }
    openPath = relativePath;
    body.replaceChildren(el("p", "workspace-companion-pane__message", "Đang tải..."));
    try {
      const file = await client.readWorkspaceFileContent(relativePath);
      renderFile(file);
    } catch (error) {
      body.replaceChildren(
        el("p", "workspace-companion-pane__message workspace-companion-pane__message--error",
          error instanceof Error ? error.message : "Không tải được tệp."),
      );
    }
  };

  // Enter edit mode: swap the read-only highlighted view for the editable textarea.
  editButton.addEventListener("click", () => {
    if (current === null || current.kind !== "text" || !current.editable) return;
    editMode = true;
    renderTextContent(current);
  });

  saveButton.addEventListener("click", () => {
    if (openPath === null || current === null || !current.editable) return;
    void (async () => {
      saveButton.disabled = true;
      try {
        if (current.kind === "text") {
          const editor = body.querySelector(".workspace-companion-pane__editor") as HTMLTextAreaElement | null;
          await client.writeWorkspaceFileContent(openPath!, {
            kind: "text",
            content: editor?.value ?? "",
          });
        } else if (current.kind === "spreadsheet") {
          const sheet = collectSpreadsheetRows();
          await client.writeWorkspaceFileContent(openPath!, {
            kind: "spreadsheet",
            sheets: [sheet],
          });
        }
        dirty = false;
        hideConflict();
        setStatus("Đã lưu", 2500);
        await load(openPath!);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Lưu thất bại", 4000);
        saveButton.disabled = false;
      }
    })();
  });

  // Keep my unsaved edits: dismiss the banner but KEEP the buffer dirty and leave a persistent
  // warning so the user cannot forget the disk changed and Save over the agent's version.
  keepButton.addEventListener("click", () => {
    hideConflict();
    setDiskChanged(true);
    setStatus("Bản trên đĩa đã thay đổi — Lưu sẽ ghi đè bản của Agent.", 0);
  });
  // Reload from disk: discard local edits and re-read the agent's version (banner already warns
  // this drops unsaved edits). load() → renderFile() clears the dirty + disk-changed state.
  reloadButton.addEventListener("click", () => {
    if (openPath === null) return;
    dirty = false;
    hideConflict();
    void load(openPath);
  });

  return {
    open: load,
    refresh: async () => {
      if (openPath === null) return;
      if (dirty) {
        setStatus("Tệp đã thay đổi bên ngoài. Hãy lưu hoặc mở lại sau khi xử lý thay đổi hiện tại.", 0);
        return;
      }
      await load(openPath);
    },
    getOpenPath: () => openPath,
    showAgentUpdated: () => {
      // Dirty buffer: never silently overwrite — surface a conflict banner with a choice.
      if (dirty) {
        conflictBanner.hidden = false;
        setStatus("Xung đột: Agent đã sửa tệp đang mở.", 0);
        return;
      }
      setStatus("Agent đã cập nhật tệp", 3500);
      void load(openPath ?? "");
    },
    showDeleted: () => {
      const deleted = openPath;
      revokeBlob();
      current = null;
      dirty = false;
      openPath = null; // no target → a stray Save cannot recreate the deleted file
      editMode = false;
      hideConflict();
      setDiskChanged(false);
      editButton.hidden = true;
      saveButton.hidden = true;
      saveButton.disabled = true;
      openInCodeButton.hidden = true;
      pathLabel.textContent = deleted ?? "Tệp đã bị xóa";
      pathLabel.title = "";
      statusBadge.hidden = true;
      body.replaceChildren(
        el(
          "p",
          "workspace-companion-pane__message",
          deleted ? `Tệp "${deleted}" đã bị xóa.` : "Tệp đã bị xóa.",
        ),
      );
    },
    openIfSafe: async (relativePath) => {
      // Normalize Windows separators to POSIX (casing preserved — the FS access needs the real
      // case). Never yank the user off unsaved work, never force-open secret/unsupported files.
      const path = relativePath.replace(/\\/g, "/");
      if (dirty) return false;
      if (!isAutoOpenSafe(path)) return false;
      try {
        const file = await client.readWorkspaceFileContent(path);
        // Oversize files come back as `unsupported`/`missing` — do not present them.
        if (file.kind === "unsupported" || file.kind === "missing") return false;
        openPath = path;
        renderFile(file);
        setStatus("Agent đã tạo/cập nhật tệp — đã mở tại đây.", 3500);
        return true;
      } catch {
        return false;
      }
    },
  };
}
