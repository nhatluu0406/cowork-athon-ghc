/**
 * Minimal Workspace Navigator.
 *
 * Renderer-only tree state. Filesystem reads stay behind the typed service client.
 */
import type { ServiceClient } from "./service-client.js";
interface WorkspaceNavigatorOptions {
    readonly client: ServiceClient;
    readonly getWorkspaceRoot: () => string | null;
    readonly onFileSelected: (relativePath: string) => void;
}
export interface WorkspaceNavigatorHandle {
    refresh(): Promise<void>;
    selectPath(relativePath: string): void;
}
export declare function mountWorkspaceNavigator(container: HTMLElement, options: WorkspaceNavigatorOptions): WorkspaceNavigatorHandle;
export {};
//# sourceMappingURL=workspace-navigator.d.ts.map