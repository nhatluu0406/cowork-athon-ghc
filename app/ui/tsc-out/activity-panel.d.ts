/**
 * Activity panel — right-side timeline, file changes, permission history, preview.
 */
import type { ServiceClient } from "./service-client.js";
import { type ActivitySnapshot, type FileChangeItem, type PermissionHistoryEntry } from "./activity-model.js";
export interface ActivityPanelDom {
    readonly root: HTMLElement;
    readonly timeline: HTMLElement;
    readonly permissionHistory: HTMLElement;
    readonly outputFiles: HTMLElement;
    readonly inputFiles: HTMLElement;
    readonly preview: HTMLElement;
    readonly toggle: HTMLButtonElement;
}
export declare function createActivityPanel(rightPanel: HTMLElement): ActivityPanelDom;
export declare function renderActivityPanel(dom: ActivityPanelDom, snapshot: ActivitySnapshot | null, emptyCopy?: string): void;
export declare function showFilePreview(dom: ActivityPanelDom, client: ServiceClient, change: FileChangeItem): Promise<void>;
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