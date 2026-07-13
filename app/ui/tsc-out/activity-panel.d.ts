/**
 * Activity panel — right-side timeline, file changes, permission history, file review.
 */
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import type { ServiceClient } from "./service-client.js";
import { type ActivitySnapshot, type FileChangeItem, type PermissionHistoryEntry } from "./activity-model.js";
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
export declare function setRightPanelCollapsed(rightPanel: HTMLElement, toggle: HTMLButtonElement, collapsed: boolean): void;
export declare function createActivityPanel(rightPanel: HTMLElement): ActivityPanelDom;
export declare function activateActivityPanelTab(dom: ActivityPanelDom, key: "plan" | "activity" | "files" | "review"): void;
export declare function renderActivityPanel(dom: ActivityPanelDom, snapshot: ActivitySnapshot | null, emptyCopy?: string): void;
export declare function showFileReview(dom: ActivityPanelDom, review: FileReviewArtifact): void;
export declare function showWorkspaceFilePreview(dom: ActivityPanelDom, client: ServiceClient, relativePath: string): Promise<void>;
/** @deprecated Use showFileReview when a persisted artifact exists. */
export declare function showFilePreview(dom: ActivityPanelDom, client: ServiceClient, change: FileChangeItem, review?: FileReviewArtifact): Promise<void>;
export declare function permissionEntryFromDecision(input: {
    requestId: string;
    actionLabel: string;
    targetSummary: string;
    decision: PermissionHistoryEntry["decision"];
    at?: string;
}): PermissionHistoryEntry;
export declare function snapshotToPersisted(snapshot: ActivitySnapshot): Record<string, unknown>;
export declare function persistedToSnapshot(raw: Record<string, unknown> | undefined): ActivitySnapshot | null;
//# sourceMappingURL=activity-panel.d.ts.map