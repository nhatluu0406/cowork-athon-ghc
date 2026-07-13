import type { ServiceClient } from "../service-client.js";
export interface WorkspaceViewDom {
    readonly root: HTMLElement;
    readonly docTabs: HTMLElement;
    readonly previewMeta: HTMLElement;
    readonly previewBody: HTMLElement;
    readonly emptyState: HTMLElement;
}
export declare function createWorkspaceView(): WorkspaceViewDom;
export interface OpenWorkspaceFileState {
    readonly relativePath: string;
    readonly label: string;
}
export declare function openWorkspaceFileInView(view: WorkspaceViewDom, client: ServiceClient, file: OpenWorkspaceFileState): Promise<void>;
export declare function clearWorkspaceView(view: WorkspaceViewDom): void;
//# sourceMappingURL=workspace-view.d.ts.map