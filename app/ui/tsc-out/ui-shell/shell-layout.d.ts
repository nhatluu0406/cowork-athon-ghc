/** Work mode within the Cowork rail surface. */
export type WorkMode = "cowork" | "workspace";
export type ShellLayoutMode = "work" | "knowledge" | "integration";
export declare function shellLayoutModeForSurface(surfaceId: string): ShellLayoutMode;
export declare function shellHasSidebar(layout: ShellLayoutMode): boolean;
export declare function applyShellLayoutClasses(frame: HTMLElement, layout: ShellLayoutMode, inspectorOpen: boolean): void;
export declare function applyWorkMode(root: HTMLElement, sidebar: HTMLElement, coworkView: HTMLElement, workspaceView: HTMLElement, coworkPanel: HTMLElement, workspacePanel: HTMLElement, mode: WorkMode): void;
//# sourceMappingURL=shell-layout.d.ts.map