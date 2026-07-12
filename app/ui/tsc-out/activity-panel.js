/**
 * Activity panel — right-side timeline, file changes, permission history, preview.
 */
import {} from "./activity-model.js";
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function opLabel(op) {
    switch (op) {
        case "create":
            return "Tạo";
        case "edit":
            return "Sửa";
        case "delete":
            return "Xóa";
        case "move":
            return "Di chuyển";
    }
}
function statusClass(status) {
    return `activity-item--${status}`;
}
function renderTimelineItem(item) {
    const row = el("div", `activity-item ${statusClass(item.status)}`);
    if (item.historical === true)
        row.classList.add("activity-item--historical");
    const head = el("div", "activity-item__head");
    head.append(el("span", "activity-item__dot"));
    head.append(el("span", "activity-item__label", item.label));
    row.append(head);
    if (item.summary !== undefined || item.relativePath !== undefined || item.detail !== undefined) {
        const details = el("details", "activity-item__details");
        details.append(el("summary", "activity-item__summary", "Chi tiết"));
        const body = el("div", "activity-item__body");
        if (item.relativePath !== undefined)
            body.append(el("p", "", item.relativePath));
        if (item.summary !== undefined)
            body.append(el("p", "", item.summary));
        if (item.detail !== undefined)
            body.append(el("p", "", item.detail));
        details.append(body);
        row.append(details);
    }
    return row;
}
export function createActivityPanel(rightPanel) {
    const header = rightPanel.querySelector(".rp-header");
    const toggle = el("button", "rp-header__toggle", "Thu gọn");
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Thu gọn bảng hoạt động");
    header?.append(toggle);
    const planCard = rightPanel.querySelector(".plan-card");
    const timelineSection = el("section", "activity-section");
    timelineSection.append(el("div", "activity-section__label", "Hoạt động"));
    const timeline = el("div", "activity-timeline");
    timelineSection.append(timeline);
    planCard?.replaceWith(timelineSection);
    const permSection = el("section", "activity-section");
    permSection.append(el("div", "activity-section__label", "Lịch sử quyền"));
    const permissionHistory = el("div", "permission-history");
    permSection.append(permissionHistory);
    const outputSection = rightPanel.querySelector(".file-section");
    const outputFiles = outputSection?.querySelector(".output-files");
    const inputSections = rightPanel.querySelectorAll(".file-section");
    const inputFiles = inputSections[1]?.querySelector(".input-files");
    const preview = el("section", "file-preview");
    preview.hidden = true;
    preview.append(el("div", "file-preview__label", "Xem trước"));
    preview.append(el("pre", "file-preview__body"));
    rightPanel.append(preview);
    const insertBefore = outputSection ?? null;
    rightPanel.insertBefore(permSection, insertBefore);
    toggle.addEventListener("click", () => {
        const collapsed = rightPanel.classList.toggle("right-panel--collapsed");
        toggle.textContent = collapsed ? "Mở rộng" : "Thu gọn";
    });
    return { root: rightPanel, timeline, permissionHistory, outputFiles, inputFiles, preview, toggle };
}
export function renderActivityPanel(dom, snapshot, emptyCopy = "Chưa có hoạt động.") {
    dom.timeline.replaceChildren();
    if (snapshot === null || snapshot.items.length === 0) {
        dom.timeline.append(el("p", "panel-empty", emptyCopy));
    }
    else {
        for (const item of snapshot.items)
            dom.timeline.append(renderTimelineItem(item));
    }
    dom.permissionHistory.replaceChildren();
    if (snapshot === null || snapshot.permissionHistory.length === 0) {
        dom.permissionHistory.append(el("p", "panel-empty", "Chưa có yêu cầu quyền."));
    }
    else {
        for (const entry of snapshot.permissionHistory) {
            const row = el("div", "permission-history__row");
            row.append(el("span", "permission-history__action", entry.actionLabel));
            row.append(el("span", "permission-history__target", entry.targetSummary));
            row.append(el("span", "permission-history__outcome", entry.outcomeLabel));
            dom.permissionHistory.append(row);
        }
    }
    dom.outputFiles.replaceChildren();
    if (snapshot === null || snapshot.fileChanges.length === 0) {
        dom.outputFiles.append(el("p", "panel-empty", "Chưa có thay đổi tệp đã xác minh."));
    }
    else {
        for (const change of snapshot.fileChanges) {
            dom.outputFiles.append(renderFileChangeRow(change));
        }
    }
    dom.inputFiles.replaceChildren();
    if (snapshot === null || snapshot.readPaths.length === 0) {
        dom.inputFiles.append(el("p", "panel-empty", "Tệp đã được đọc trong phiên: chưa có."));
    }
    else {
        dom.inputFiles.append(el("p", "panel-empty", "Tệp đã được đọc trong phiên:"));
        for (const path of snapshot.readPaths) {
            const row = el("div", "file-row");
            row.append(el("span", "file-row__name", path));
            dom.inputFiles.append(row);
        }
    }
}
function renderFileChangeRow(change) {
    const row = el("button", "file-row file-row--clickable");
    row.type = "button";
    row.dataset["relativePath"] = change.relativePath;
    row.dataset["operation"] = change.operation;
    row.append(el("span", "file-row__badge", opLabel(change.operation)));
    row.append(el("span", "file-row__name", change.relativePath));
    return row;
}
export async function showFilePreview(dom, client, change) {
    const body = dom.preview.querySelector(".file-preview__body");
    dom.preview.hidden = false;
    if (change.operation === "delete") {
        body.textContent = `Tệp đã bị xóa: ${change.relativePath}`;
        return;
    }
    try {
        const result = await client.previewWorkspaceFile(change.relativePath);
        if (result.kind === "binary") {
            body.textContent = `Tệp nhị phân — không xem trước dạng văn bản: ${change.relativePath}`;
            return;
        }
        if (result.kind === "missing") {
            body.textContent = `Không tìm thấy tệp trong workspace: ${change.relativePath}`;
            return;
        }
        const header = change.operation === "create"
            ? `Nội dung tệp mới (${change.relativePath})`
            : `Nội dung hiện tại (${change.relativePath})`;
        const suffix = result.truncated ? "\n\n[Đã cắt bớt — tệp lớn hơn giới hạn xem trước]" : "";
        body.textContent = `${header}\n\n${result.content ?? ""}${suffix}`;
    }
    catch (error) {
        body.textContent = error instanceof Error ? error.message : "Không tải được xem trước.";
    }
}
export function permissionEntryFromDecision(input) {
    const outcomeLabel = input.decision === "allowed_once"
        ? "Đã cho phép một lần"
        : input.decision === "allowed_always"
            ? "Đã cho phép luôn"
            : input.decision === "denied"
                ? "Đã từ chối"
                : input.decision === "timeout"
                    ? "Hết hạn — tự từ chối"
                    : "Đang chờ";
    return {
        id: `perm-${input.requestId}`,
        requestId: input.requestId,
        at: input.at ?? new Date().toISOString(),
        actionLabel: input.actionLabel,
        targetSummary: input.targetSummary,
        decision: input.decision,
        outcomeLabel,
    };
}
export function snapshotToPersisted(snapshot) {
    return {
        items: snapshot.items.map((i) => ({ ...i, historical: undefined })),
        fileChanges: snapshot.fileChanges,
        permissionHistory: snapshot.permissionHistory,
        readPaths: snapshot.readPaths,
        terminalState: snapshot.terminalState,
    };
}
export function persistedToSnapshot(raw) {
    if (raw === undefined)
        return null;
    const items = Array.isArray(raw["items"]) ? raw["items"] : [];
    const fileChanges = Array.isArray(raw["fileChanges"])
        ? raw["fileChanges"].map((f) => ({ ...f, verified: true }))
        : [];
    const permissionHistory = Array.isArray(raw["permissionHistory"])
        ? raw["permissionHistory"]
        : [];
    const readPaths = Array.isArray(raw["readPaths"]) ? raw["readPaths"] : [];
    const terminalState = typeof raw["terminalState"] === "string"
        ? raw["terminalState"]
        : null;
    return {
        items: items.map((i) => ({ ...i, historical: true })),
        fileChanges,
        permissionHistory,
        readPaths,
        terminalState,
    };
}
//# sourceMappingURL=activity-panel.js.map