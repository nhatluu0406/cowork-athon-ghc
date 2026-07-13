/**
 * Workspace Companion pane — rich preview and basic editing.
 */
import { el } from "./ui-shell/dom-utils.js";
function base64ToBlobUrl(base64, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1)
        bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
}
export function mountWorkspaceCompanionPane(container, client) {
    let openPath = null;
    let current = null;
    let dirty = false;
    let blobUrl = null;
    let statusTimer = null;
    const root = el("div", "workspace-companion-pane");
    const toolbar = el("div", "workspace-companion-pane__toolbar");
    const pathLabel = el("span", "workspace-companion-pane__path");
    const statusBadge = el("span", "workspace-companion-pane__status");
    statusBadge.hidden = true;
    const saveButton = el("button", "workspace-companion-pane__save", "Lưu");
    saveButton.type = "button";
    saveButton.hidden = true;
    toolbar.append(pathLabel, statusBadge, saveButton);
    const body = el("div", "workspace-companion-pane__body");
    const empty = el("div", "workspace-companion-pane__empty");
    empty.append(el("h2", "workspace-companion-pane__empty-title", "Chọn một tệp"), el("p", "workspace-companion-pane__empty-copy", "Duyệt workspace ở sidebar trái để xem trước hoặc chỉnh sửa."));
    body.append(empty);
    root.append(toolbar, body);
    container.replaceChildren(root);
    const revokeBlob = () => {
        if (blobUrl !== null) {
            URL.revokeObjectURL(blobUrl);
            blobUrl = null;
        }
    };
    const setStatus = (text, autoHideMs = 0) => {
        statusBadge.textContent = text;
        statusBadge.hidden = false;
        if (statusTimer !== null)
            clearTimeout(statusTimer);
        if (autoHideMs > 0) {
            statusTimer = setTimeout(() => {
                statusBadge.hidden = true;
            }, autoHideMs);
        }
    };
    const markDirty = () => {
        dirty = true;
        saveButton.hidden = !(current?.editable === true);
        saveButton.disabled = false;
    };
    const renderSpreadsheet = (file) => {
        const sheet = file.sheets?.[0];
        if (sheet === undefined) {
            body.replaceChildren(el("p", "workspace-companion-pane__message", "Không có sheet."));
            return;
        }
        const table = el("table", "workspace-companion-pane__grid");
        const tbody = el("tbody", "workspace-companion-pane__grid-body");
        const rows = sheet.rows.map((row) => [...row]);
        const ensureRow = (index) => {
            while (rows.length <= index)
                rows.push([]);
            const row = rows[index];
            return row;
        };
        const maxCols = Math.max(4, ...rows.map((r) => r.length));
        for (let r = 0; r < Math.max(rows.length, 8); r += 1) {
            const tr = el("tr", "workspace-companion-pane__grid-row");
            const row = ensureRow(r);
            for (let c = 0; c < maxCols; c += 1) {
                const td = el("td", "workspace-companion-pane__grid-cell");
                const input = el("input", "workspace-companion-pane__grid-input");
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
        table.__rows = rows;
        table.__sheetName = sheet.name;
    };
    const collectSpreadsheetRows = () => {
        const table = body.querySelector(".workspace-companion-pane__grid");
        return {
            name: table?.__sheetName ?? "Sheet1",
            rows: table?.__rows?.map((row) => [...row]) ?? [[""]],
        };
    };
    const renderFile = (file) => {
        current = file;
        dirty = false;
        saveButton.hidden = !file.editable;
        saveButton.disabled = true;
        revokeBlob();
        pathLabel.textContent = file.relativePath;
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
            const editor = el("textarea", "workspace-companion-pane__editor");
            editor.value = file.content ?? "";
            editor.spellcheck = false;
            editor.readOnly = !file.editable;
            if (file.editable)
                editor.addEventListener("input", markDirty);
            body.replaceChildren(editor);
            if (file.truncated) {
                setStatus("Đã cắt bớt — tệp lớn hơn 512 KiB", 0);
            }
            return;
        }
        if (file.kind === "image" && file.dataBase64 && file.mimeType) {
            const img = el("img", "workspace-companion-pane__image");
            img.src = `data:${file.mimeType};base64,${file.dataBase64}`;
            img.alt = file.relativePath;
            body.replaceChildren(img);
            return;
        }
        if (file.kind === "pdf" && file.dataBase64) {
            blobUrl = base64ToBlobUrl(file.dataBase64, "application/pdf");
            const frame = el("iframe", "workspace-companion-pane__pdf");
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
            if (!file.editable)
                setStatus("Chỉ xem — bảo toàn công thức và định dạng XLSX", 0);
            return;
        }
        body.replaceChildren(el("p", "workspace-companion-pane__message", "Không hiển thị được tệp."));
    };
    const load = async (relativePath) => {
        if (dirty && openPath !== null && relativePath !== openPath) {
            setStatus("Bạn có thay đổi chưa lưu. Hãy lưu trước khi mở tệp khác.", 0);
            return;
        }
        openPath = relativePath;
        body.replaceChildren(el("p", "workspace-companion-pane__message", "Đang tải..."));
        try {
            const file = await client.readWorkspaceFileContent(relativePath);
            renderFile(file);
        }
        catch (error) {
            body.replaceChildren(el("p", "workspace-companion-pane__message workspace-companion-pane__message--error", error instanceof Error ? error.message : "Không tải được tệp."));
        }
    };
    saveButton.addEventListener("click", () => {
        if (openPath === null || current === null || !current.editable)
            return;
        void (async () => {
            saveButton.disabled = true;
            try {
                if (current.kind === "text") {
                    const editor = body.querySelector(".workspace-companion-pane__editor");
                    await client.writeWorkspaceFileContent(openPath, {
                        kind: "text",
                        content: editor?.value ?? "",
                    });
                }
                else if (current.kind === "spreadsheet") {
                    const sheet = collectSpreadsheetRows();
                    await client.writeWorkspaceFileContent(openPath, {
                        kind: "spreadsheet",
                        sheets: [sheet],
                    });
                }
                dirty = false;
                setStatus("Đã lưu", 2500);
                await load(openPath);
            }
            catch (error) {
                setStatus(error instanceof Error ? error.message : "Lưu thất bại", 4000);
                saveButton.disabled = false;
            }
        })();
    });
    return {
        open: load,
        refresh: async () => {
            if (openPath === null)
                return;
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
//# sourceMappingURL=workspace-companion-pane.js.map