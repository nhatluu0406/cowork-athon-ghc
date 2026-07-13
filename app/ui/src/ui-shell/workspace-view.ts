import type { ServiceClient } from "../service-client.js";
import { el } from "./dom-utils.js";

export interface WorkspaceViewDom {
  readonly root: HTMLElement;
  readonly docTabs: HTMLElement;
  readonly previewMeta: HTMLElement;
  readonly previewBody: HTMLElement;
  readonly emptyState: HTMLElement;
}

export function createWorkspaceView(): WorkspaceViewDom {
  const root = el("section", "view view--workspace workspace-view");
  root.dataset["view"] = "workspace";
  root.hidden = true;

  const docTabs = el("div", "workspace-docs__tabs");
  docTabs.setAttribute("role", "tablist");

  const preview = el("div", "workspace-docs__preview");
  const emptyState = el("div", "workspace-empty");
  emptyState.append(
    el("h2", "workspace-empty__title", "Chọn một tệp để xem trước"),
    el("p", "workspace-empty__copy", "Duyệt workspace ở sidebar hoặc mở tệp từ cuộc trò chuyện."),
  );
  const previewMeta = el("div", "workspace-preview__meta");
  const previewBody = el("pre", "workspace-preview__body");
  preview.append(previewMeta, previewBody);
  preview.hidden = true;

  root.append(docTabs, emptyState, preview);
  return { root, docTabs, previewMeta, previewBody, emptyState };
}

export interface OpenWorkspaceFileState {
  readonly relativePath: string;
  readonly label: string;
}

export async function openWorkspaceFileInView(
  view: WorkspaceViewDom,
  client: ServiceClient,
  file: OpenWorkspaceFileState,
): Promise<void> {
  view.emptyState.hidden = true;
  const preview = view.previewBody.parentElement as HTMLElement;
  preview.hidden = false;

  view.docTabs.replaceChildren();
  const tab = el("button", "workspace-docs__tab workspace-docs__tab--active", file.label) as HTMLButtonElement;
  tab.type = "button";
  tab.title = file.relativePath;
  view.docTabs.append(tab);

  view.previewMeta.textContent = file.relativePath;
  view.previewBody.textContent = "Đang tải xem trước...";
  try {
    const result = await client.previewWorkspaceFile(file.relativePath);
    if (result.kind === "binary") {
      view.previewBody.textContent = "Chưa hỗ trợ xem trước loại tệp này.";
      return;
    }
    if (result.kind === "missing") {
      view.previewBody.textContent = "Không tìm thấy tệp trong workspace.";
      return;
    }
    const suffix = result.truncated ? "\n\n[Đã cắt bớt — tệp lớn hơn giới hạn xem trước 64 KiB]" : "";
    view.previewBody.textContent = `${result.content ?? ""}${suffix}`;
  } catch (error) {
    view.previewBody.textContent = error instanceof Error ? error.message : "Không tải được xem trước.";
  }
}

export function clearWorkspaceView(view: WorkspaceViewDom): void {
  view.docTabs.replaceChildren();
  view.previewMeta.textContent = "";
  view.previewBody.textContent = "";
  const preview = view.previewBody.parentElement as HTMLElement;
  preview.hidden = true;
  view.emptyState.hidden = false;
}
