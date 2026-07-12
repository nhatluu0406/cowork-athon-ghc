/**
 * Activity panel — right-side timeline, file changes, permission history, file review.
 */

import type { FileMutationOp } from "@cowork-ghc/contracts";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import type { ServiceClient } from "./service-client.js";
import {
  type ActivityItem,
  type ActivitySnapshot,
  type FileChangeItem,
  type PermissionHistoryEntry,
} from "./activity-model.js";

export interface ActivityPanelDom {
  readonly root: HTMLElement;
  readonly plan: HTMLElement;
  readonly timeline: HTMLElement;
  readonly permissionHistory: HTMLElement;
  readonly outputFiles: HTMLElement;
  readonly inputFiles: HTMLElement;
  readonly workspacePreview: HTMLElement;
  readonly preview: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly tabs: readonly HTMLButtonElement[];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setRightPanelCollapsed(
  rightPanel: HTMLElement,
  toggle: HTMLButtonElement,
  collapsed: boolean,
): void {
  rightPanel.classList.toggle("right-panel--collapsed", collapsed);
  rightPanel.setAttribute("aria-hidden", collapsed ? "true" : "false");
  toggle.textContent = collapsed ? "Mở rộng" : "Thu gọn";
  toggle.setAttribute("aria-label", collapsed ? "Mở rộng bảng hoạt động" : "Thu gọn bảng hoạt động");
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function opLabel(op: FileMutationOp): string {
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

function statusClass(status: ActivityItem["status"]): string {
  return `activity-item--${status}`;
}

function renderTimelineItem(item: ActivityItem): HTMLElement {
  const row = el("div", `activity-item ${statusClass(item.status)}`);
  if (item.historical === true) row.classList.add("activity-item--historical");
  const head = el("div", "activity-item__head");
  head.append(el("span", "activity-item__dot"));
  head.append(el("span", "activity-item__label", item.label));
  row.append(head);
  if (item.summary !== undefined || item.relativePath !== undefined || item.detail !== undefined) {
    const details = el("details", "activity-item__details");
    details.append(el("summary", "activity-item__summary", "Chi tiết"));
    const body = el("div", "activity-item__body");
    if (item.relativePath !== undefined) body.append(el("p", "", item.relativePath));
    if (item.summary !== undefined) body.append(el("p", "", item.summary));
    if (item.detail !== undefined) body.append(el("p", "", item.detail));
    details.append(body);
    row.append(details);
  }
  return row;
}

export function createActivityPanel(rightPanel: HTMLElement): ActivityPanelDom {
  const header = rightPanel.querySelector(".rp-header");
  const toggle = el("button", "rp-header__toggle", "Thu gọn") as HTMLButtonElement;
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Thu gọn bảng hoạt động");
  header?.append(toggle);

  const planCard = rightPanel.querySelector(".plan-card");
  planCard?.classList.add("info-section", "info-section--plan");
  const plan = planCard?.querySelector(".plan-card__steps") as HTMLElement;
  planCard?.setAttribute("aria-label", "Kế hoạch");

  const panelTabs = el("div", "rp-tabs");
  const tabButtons: HTMLButtonElement[] = [];
  const tabData = [
    ["Kế hoạch", "plan"],
    ["Hoạt động", "activity"],
    ["Tệp", "files"],
    ["Xem lại", "review"],
  ] as const;
  for (const [label, key] of tabData) {
    const button = el("button", "rp-tab", label);
    button.type = "button";
    button.dataset["section"] = key;
    if (key === "activity") button.classList.add("rp-tab--active");
    panelTabs.append(button);
    tabButtons.push(button);
  }
  header?.after(panelTabs);

  const timelineSection = el("section", "activity-section");
  timelineSection.append(el("div", "activity-section__label", "Hoạt động"));
  const timeline = el("div", "activity-timeline");
  timelineSection.append(timeline);
  planCard?.after(timelineSection);

  const permSection = el("section", "activity-section");
  permSection.append(el("div", "activity-section__label", "Lịch sử quyền"));
  const permissionHistory = el("div", "permission-history");
  permSection.append(permissionHistory);

  const outputSection = rightPanel.querySelector(".file-section");
  outputSection?.classList.add("info-section", "info-section--files");
  const outputFiles = outputSection?.querySelector(".output-files") as HTMLElement;
  const inputSections = rightPanel.querySelectorAll(".file-section");
  inputSections[1]?.classList.add("info-section", "info-section--files");
  const inputFiles = inputSections[1]?.querySelector(".input-files") as HTMLElement;

  const preview = el("section", "file-preview");
  preview.hidden = true;
  preview.dataset["panelTab"] = "review";
  preview.append(el("div", "file-preview__label", "Xem lại thay đổi"));
  preview.append(el("div", "file-preview__meta"));
  preview.append(el("pre", "file-preview__body"));
  const actions = el("div", "file-preview__actions");
  preview.append(actions);
  rightPanel.append(preview);

  const insertBefore = outputSection ?? null;
  rightPanel.insertBefore(permSection, insertBefore);

  planCard?.setAttribute("data-panel-tab", "plan");
  timelineSection.dataset["panelTab"] = "activity";
  permSection.dataset["panelTab"] = "activity";
  outputSection?.setAttribute("data-panel-tab", "files");
  inputSections[1]?.setAttribute("data-panel-tab", "files");
  const workspacePreview = el("section", "file-preview file-preview--workspace");
  workspacePreview.dataset["panelTab"] = "files";
  workspacePreview.hidden = true;
  workspacePreview.append(el("div", "file-preview__label", "Tệp workspace"));
  workspacePreview.append(el("div", "file-preview__meta"));
  workspacePreview.append(el("pre", "file-preview__body"));
  const workspaceActions = el("div", "file-preview__actions");
  workspacePreview.append(workspaceActions);
  inputSections[1]?.after(workspacePreview);

  const activateTab = (key: string): void => {
    for (const button of tabButtons) {
      button.classList.toggle("rp-tab--active", button.dataset["section"] === key);
      button.setAttribute("aria-selected", button.dataset["section"] === key ? "true" : "false");
    }
    for (const section of rightPanel.querySelectorAll<HTMLElement>("[data-panel-tab]")) {
      const inactive = section.dataset["panelTab"] !== key;
      const unloadedWorkspacePreview =
        section.classList.contains("file-preview--workspace") && !section.classList.contains("file-preview--loaded");
      section.hidden = inactive || unloadedWorkspacePreview;
    }
  };
  for (const button of tabButtons) {
    button.addEventListener("click", () => activateTab(button.dataset["section"] ?? "activity"));
  }
  activateTab("activity");

  return {
    root: rightPanel,
    plan,
    timeline,
    permissionHistory,
    outputFiles,
    inputFiles,
    workspacePreview,
    preview,
    toggle,
    tabs: tabButtons,
  };
}

export function activateActivityPanelTab(dom: ActivityPanelDom, key: "plan" | "activity" | "files" | "review"): void {
  const tab = dom.tabs.find((button) => button.dataset["section"] === key);
  tab?.click();
}

export function renderActivityPanel(
  dom: ActivityPanelDom,
  snapshot: ActivitySnapshot | null,
  emptyCopy = "Chưa có hoạt động.",
): void {
  dom.plan.replaceChildren();
  const planItems = snapshot?.items.filter((item) => item.kind === "plan") ?? [];
  if (planItems.length === 0) {
    dom.plan.append(el("p", "panel-empty", "Chưa có kế hoạch từ runtime."));
  } else {
    for (const item of planItems) dom.plan.append(renderTimelineItem(item));
  }

  dom.timeline.replaceChildren();
  if (snapshot === null || snapshot.items.length === 0) {
    dom.timeline.append(el("p", "panel-empty", emptyCopy));
  } else {
    for (const item of snapshot.items) dom.timeline.append(renderTimelineItem(item));
  }

  dom.permissionHistory.replaceChildren();
  if (snapshot === null || snapshot.permissionHistory.length === 0) {
    dom.permissionHistory.append(el("p", "panel-empty", "Chưa có yêu cầu quyền."));
  } else {
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
  } else {
    for (const change of snapshot.fileChanges) {
      dom.outputFiles.append(renderFileChangeRow(change, snapshot.fileReviews));
    }
  }

  dom.inputFiles.replaceChildren();
  const attachmentPaths = snapshot?.attachmentContextPaths ?? [];
  const runtimePaths = snapshot?.runtimeReadPaths ?? [];
  if (attachmentPaths.length === 0 && runtimePaths.length === 0) {
    dom.inputFiles.append(el("p", "panel-empty", "Chưa có tệp đọc hoặc đính kèm trong phiên."));
  } else {
    if (attachmentPaths.length > 0) {
      dom.inputFiles.append(el("p", "panel-empty", "Tệp đã đưa vào ngữ cảnh:"));
      for (const path of attachmentPaths) {
        const row = el("div", "file-row");
        row.append(el("span", "file-row__badge", "Đính kèm"));
        row.append(el("span", "file-row__name", path));
        dom.inputFiles.append(row);
      }
    }
    if (runtimePaths.length > 0) {
      dom.inputFiles.append(el("p", "panel-empty", "Tệp runtime đã đọc:"));
      for (const path of runtimePaths) {
        const row = el("div", "file-row");
        row.append(el("span", "file-row__badge", "Đọc"));
        row.append(el("span", "file-row__name", path));
        dom.inputFiles.append(row);
      }
    }
  }
}

function renderFileChangeRow(
  change: FileChangeItem,
  reviews: readonly FileReviewArtifact[],
): HTMLElement {
  const row = el("button", "file-row file-row--clickable");
  row.type = "button";
  row.dataset["relativePath"] = change.relativePath;
  row.dataset["operation"] = change.operation;
  if (change.reviewId !== undefined) row.dataset["reviewId"] = change.reviewId;
  row.append(el("span", "file-row__badge", opLabel(change.operation)));
  row.append(el("span", "file-row__name", change.relativePath));
  const review = reviews.find((r) => r.id === change.reviewId);
  if (review?.contentRedacted === true) {
    row.append(el("span", "file-row__note", "Ẩn"));
  }
  return row;
}

function formatReviewBody(review: FileReviewArtifact): string {
  if (review.contentRedacted) {
    return "Nội dung bị ẩn vì file có thể chứa credential hoặc secret.";
  }
  if (review.isBinary) {
    return "File nhị phân đã thay đổi\nKhông hỗ trợ diff nội dung";
  }
  const parts: string[] = [];
  if (!review.beforeExists && review.operation === "create") {
    parts.push("Trước: (không tồn tại)");
  } else if (review.beforePreview !== undefined) {
    parts.push(`Trước:\n${review.beforePreview}`);
  } else if (!review.beforeExists) {
    parts.push("Trước: (không tồn tại)");
  }
  if (!review.afterExists && review.operation === "delete") {
    parts.push("Sau: (không tồn tại)");
  } else if (review.afterPreview !== undefined) {
    parts.push(`Sau:\n${review.afterPreview}`);
  } else if (!review.afterExists) {
    parts.push("Sau: (không tồn tại)");
  }
  if (review.unifiedDiff !== undefined && review.unifiedDiff.length > 0) {
    parts.push(`Diff:\n${review.unifiedDiff}`);
  }
  if (review.truncated || review.diffTruncated || review.previewTruncated) {
    parts.push("\n[Một phần nội dung đã bị giới hạn — không phải toàn bộ file]");
  }
  if (review.currentFileHashMismatch === true) {
    parts.push("\nSnapshot lúc Agent thực hiện\nFile hiện tại đã thay đổi sau đó");
  }
  return parts.join("\n\n");
}

export function showFileReview(dom: ActivityPanelDom, review: FileReviewArtifact): void {
  activateActivityPanelTab(dom, "review");
  const meta = dom.preview.querySelector(".file-preview__meta") as HTMLElement;
  const body = dom.preview.querySelector(".file-preview__body") as HTMLElement;
  const actions = dom.preview.querySelector(".file-preview__actions") as HTMLElement;
  dom.preview.hidden = false;
  meta.replaceChildren();
  meta.append(el("p", "", `Tệp: ${review.relativePath}`));
  meta.append(el("p", "", `Thao tác: ${review.operation ?? review.eventKind}`));
  meta.append(el("p", "", `Thời điểm: ${review.at}`));
  if (review.permissionDecision !== undefined) {
    const label =
      review.permissionDecision === "denied"
        ? "Đã từ chối"
        : review.permissionDecision === "allowed_always"
          ? "Đã cho phép luôn"
          : "Đã cho phép một lần";
    meta.append(el("p", "", `Quyền: ${label}`));
  }
  body.textContent = formatReviewBody(review);
  actions.replaceChildren();
  const copyBtn = el("button", "file-preview__copy", "Sao chép đường dẫn") as HTMLButtonElement;
  copyBtn.type = "button";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(review.relativePath);
  });
  actions.append(copyBtn);
}

export async function showWorkspaceFilePreview(
  dom: ActivityPanelDom,
  client: ServiceClient,
  relativePath: string,
): Promise<void> {
  activateActivityPanelTab(dom, "files");
  const meta = dom.workspacePreview.querySelector(".file-preview__meta") as HTMLElement;
  const body = dom.workspacePreview.querySelector(".file-preview__body") as HTMLElement;
  const actions = dom.workspacePreview.querySelector(".file-preview__actions") as HTMLElement;
  dom.workspacePreview.classList.add("file-preview--loaded");
  dom.workspacePreview.hidden = false;
  meta.replaceChildren(el("p", "", relativePath));
  body.textContent = "Đang tải xem trước...";
  actions.replaceChildren();
  const copyBtn = el("button", "file-preview__copy", "Sao chép relative path") as HTMLButtonElement;
  copyBtn.type = "button";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(relativePath);
  });
  actions.append(copyBtn);
  try {
    const result = await client.previewWorkspaceFile(relativePath);
    if (result.kind === "binary") {
      body.textContent = "Chưa hỗ trợ xem trước loại tệp này.";
      return;
    }
    if (result.kind === "missing") {
      body.textContent = "Không tìm thấy tệp trong workspace.";
      return;
    }
    const suffix = result.truncated ? "\n\n[Đã cắt bớt — tệp lớn hơn giới hạn xem trước 64 KiB]" : "";
    body.textContent = `${result.content ?? ""}${suffix}`;
  } catch (error) {
    body.textContent = error instanceof Error ? error.message : "Không tải được xem trước.";
  }
}

/** @deprecated Use showFileReview when a persisted artifact exists. */
export async function showFilePreview(
  dom: ActivityPanelDom,
  client: ServiceClient,
  change: FileChangeItem,
  review?: FileReviewArtifact,
): Promise<void> {
  if (review !== undefined) {
    showFileReview(dom, review);
    return;
  }
  activateActivityPanelTab(dom, "files");
  const body = dom.preview.querySelector(".file-preview__body") as HTMLElement;
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
    const header =
      change.operation === "create"
        ? `Nội dung tệp mới (${change.relativePath})`
        : `Nội dung hiện tại (${change.relativePath})`;
    const suffix = result.truncated ? "\n\n[Đã cắt bớt — tệp lớn hơn giới hạn xem trước]" : "";
    body.textContent = `${header}\n\n${result.content ?? ""}${suffix}`;
  } catch (error) {
    body.textContent = error instanceof Error ? error.message : "Không tải được xem trước.";
  }
}

export function permissionEntryFromDecision(input: {
  requestId: string;
  actionLabel: string;
  targetSummary: string;
  decision: PermissionHistoryEntry["decision"];
  at?: string;
}): PermissionHistoryEntry {
  const outcomeLabel =
    input.decision === "allowed_once"
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

export function snapshotToPersisted(snapshot: ActivitySnapshot): Record<string, unknown> {
  return {
    items: snapshot.items.map((i) => ({ ...i, historical: undefined })),
    fileChanges: snapshot.fileChanges,
    fileReviews: snapshot.fileReviews,
    permissionHistory: snapshot.permissionHistory,
    runtimeReadPaths: snapshot.runtimeReadPaths,
    attachmentContextPaths: snapshot.attachmentContextPaths,
    readPaths: snapshot.runtimeReadPaths,
    terminalState: snapshot.terminalState,
  };
}

export function persistedToSnapshot(raw: Record<string, unknown> | undefined): ActivitySnapshot | null {
  if (raw === undefined) return null;
  const items = Array.isArray(raw["items"]) ? (raw["items"] as ActivityItem[]) : [];
  const fileChanges = Array.isArray(raw["fileChanges"])
    ? (raw["fileChanges"] as FileChangeItem[]).map((f) => ({ ...f, verified: true as const }))
    : [];
  const fileReviews = Array.isArray(raw["fileReviews"])
    ? (raw["fileReviews"] as FileReviewArtifact[])
    : [];
  const permissionHistory = Array.isArray(raw["permissionHistory"])
    ? (raw["permissionHistory"] as PermissionHistoryEntry[])
    : [];
  const runtimeReadPaths = Array.isArray(raw["runtimeReadPaths"])
    ? (raw["runtimeReadPaths"] as string[])
    : Array.isArray(raw["readPaths"])
      ? (raw["readPaths"] as string[])
      : [];
  const attachmentContextPaths = Array.isArray(raw["attachmentContextPaths"])
    ? (raw["attachmentContextPaths"] as string[])
    : [];
  const terminalState =
    typeof raw["terminalState"] === "string"
      ? (raw["terminalState"] as ActivitySnapshot["terminalState"])
      : null;
  return {
    items: items.map((i) => ({ ...i, historical: true })),
    fileChanges,
    fileReviews,
    permissionHistory,
    runtimeReadPaths,
    attachmentContextPaths,
    readPaths: runtimeReadPaths,
    terminalState,
  };
}
