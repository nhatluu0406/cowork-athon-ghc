/**
 * Activity timeline model — folds real EV events into a session-scoped, Vietnamese UI timeline.
 *
 * Uses only observed {@link EvEvent} kinds from the CGHC-012 contract. Model token deltas are
 * excluded from activity (they are chat output, not tool events).
 */
import type { EvEvent, FileMutationOp, TerminalState } from "@cowork-ghc/contracts";
import type { SessionView } from "@cowork-ghc/service/execution";
import type { FileEventKind, FileEventSource, FileReviewArtifact } from "@cowork-ghc/service/file-review";
export type ActivityVisualStatus = "pending" | "running" | "success" | "warning" | "denied" | "cancelled" | "failed";
export interface ActivityItem {
    readonly id: string;
    readonly kind: "progress" | "tool" | "file" | "permission" | "terminal" | "error" | "plan";
    readonly label: string;
    readonly status: ActivityVisualStatus;
    readonly at: string;
    readonly seq: number;
    readonly toolName?: string;
    readonly callId?: string;
    readonly summary?: string;
    readonly relativePath?: string;
    readonly operation?: FileMutationOp;
    readonly fileEventKind?: FileEventKind;
    readonly source?: FileEventSource;
    readonly detail?: string;
    readonly historical?: boolean;
}
export interface PermissionHistoryEntry {
    readonly id: string;
    readonly requestId: string;
    readonly at: string;
    readonly actionLabel: string;
    readonly targetSummary: string;
    readonly decision: "allowed_once" | "allowed_always" | "denied" | "timeout" | "pending";
    readonly outcomeLabel: string;
}
export interface FileChangeItem {
    readonly id: string;
    readonly operation: FileMutationOp;
    readonly relativePath: string;
    readonly at: string;
    readonly seq: number;
    readonly callId?: string;
    readonly verified: true;
    readonly reviewId?: string;
}
export interface ActivitySnapshot {
    readonly items: readonly ActivityItem[];
    readonly fileChanges: readonly FileChangeItem[];
    readonly fileReviews: readonly FileReviewArtifact[];
    readonly permissionHistory: readonly PermissionHistoryEntry[];
    /** Workspace paths the runtime/tool read during the turn (not user attachments). */
    readonly runtimeReadPaths: readonly string[];
    /** Workspace paths included as attachment context (not runtime reads). */
    readonly attachmentContextPaths: readonly string[];
    /** @deprecated Use runtimeReadPaths — kept for backward compat on load. */
    readonly readPaths: readonly string[];
    readonly terminalState: TerminalState | null;
}
export declare function toRelativePath(absoluteOrRelative: string, workspaceRoot: string | null): string;
export declare function redactCommandText(text: string): string;
/** Merge events in seq order; ignore duplicates (`seq <= lastSeq`). */
export declare function mergeEvEvents(existing: readonly EvEvent[], incoming: readonly EvEvent[]): readonly EvEvent[];
export declare function buildActivitySnapshot(events: readonly EvEvent[], workspaceRoot: string | null, permissionHistory: readonly PermissionHistoryEntry[], historical?: boolean, fileReviews?: readonly FileReviewArtifact[]): ActivitySnapshot;
/** Rebuild a minimal snapshot from a persisted {@link SessionView} (backward compat). */
export declare function snapshotFromSessionView(view: SessionView, workspaceRoot: string | null, permissionHistory?: readonly PermissionHistoryEntry[], historical?: boolean, fileReviews?: readonly FileReviewArtifact[]): ActivitySnapshot;
export declare function markRunningAsCancelled(snapshot: ActivitySnapshot): ActivitySnapshot;
//# sourceMappingURL=activity-model.d.ts.map