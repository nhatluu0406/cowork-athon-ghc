/**
 * Workspace Companion pane — rich preview and basic editing.
 */

import type { ServiceClient } from "./service-client.js";
import { el, icon } from "./ui-shell/dom-utils.js";

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
  readonly showAgentUpdated: () => void;
}

function base64ToBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

export function mountWorkspaceCompanionPane(
  container: HTMLElement,
  client: ServiceClient,
): WorkspaceCompanionPaneHandle {
  let openPath: string | null = null;
  let current: WorkspaceFileContentView | null = null;
  let dirty = false;
  let blobUrl: string | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  const root = el("div", "workspace-companion-pane");
  const toolbar = el("div", "workspace-companion-pane__toolbar");
  const pathWrap = el("div", "workspace-companion-pane__path-wrap");
  pathWrap.append(icon("file", "Tệp đang mở"));
  const pathLabel = el("span", "workspace-companion-pane__path", "Xem trước tệp");
  pathWrap.append(pathLabel);
  const statusBadge = el("span", "workspace-companion-pane__status", "Chưa chọn tệp");
  const saveButton = el("button", "workspace-companion-pane__save", "Lưu") as HTMLButtonElement;
  saveButton.type = "button";
  saveButton.hidden = true;
  toolbar.append(pathWrap, statusBadge, saveButton);

  const body = el("div", "workspace-companion-pane__body");
  const empty = el("div", "workspace-companion-pane__empty");
  const emptyIcon = el("div", "workspace-companion-pane__empty-icon");
  emptyIcon.append(icon("workspace", "Workspace"));
  const formats = el("div", "workspace-companion-pane__formats");
  for (const format of ["TXT", "MD", "DOCX", "PDF", "Ảnh", "XLSX"]) {
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
  root.append(toolbar, body);
  container.replaceChildren(root);

  const revokeBlob = (): void => {
    if (blobUrl !== null) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
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

  const renderSpreadsheet = (file: WorkspaceFileContentView): void => {
    const sheet = file.sheets?.[0];
    if (sheet === undefined) {
      body.replaceChildren(el("p", "workspace-companion-pane__message", "Không có sheet."));
      return;
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
    body.replaceChildren(table);
    (table as unknown as { __rows: string[][] }).__rows = rows;
    (table as unknown as { __sheetName: string }).__sheetName = sheet.name;
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
    saveButton.hidden = !file.editable;
    saveButton.disabled = true;
    revokeBlob();
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
      const editor = el("textarea", "workspace-companion-pane__editor") as HTMLTextAreaElement;
      editor.value = file.content ?? "";
      editor.spellcheck = false;
      editor.readOnly = !file.editable;
      if (file.editable) editor.addEventListener("input", markDirty);
      body.replaceChildren(editor);
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
      frame.src = blobUrl;
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
        setStatus("Đã lưu", 2500);
        await load(openPath!);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Lưu thất bại", 4000);
        saveButton.disabled = false;
      }
    })();
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
      if (dirty) {
        setStatus("Agent đã cập nhật tệp. Thay đổi chưa lưu của bạn được giữ nguyên.", 0);
        return;
      }
      setStatus("Agent đã cập nhật tệp", 3500);
      void load(openPath ?? "");
    },
  };
}
