import type { RuntimePhase } from "../conversation-controller.js";
import type { SettingsView } from "../service-client.js";
import type { ConnectionTestState } from "../provider-readiness.js";
export interface StatusBarDom {
    readonly root: HTMLElement;
    readonly workspace: HTMLElement;
    readonly service: HTMLElement;
    readonly runtime: HTMLElement;
    readonly provider: HTMLButtonElement;
}
export declare function createStatusBar(): StatusBarDom;
export declare function renderStatusBar(dom: StatusBarDom, input: {
    readonly workspacePath: string | null;
    readonly serviceLabel: string;
    readonly serviceOk: boolean;
    readonly runtimePhase: RuntimePhase;
    readonly hasPendingPermission: boolean;
    readonly settings: SettingsView | null;
    readonly connectionTestState: ConnectionTestState;
}): void;
//# sourceMappingURL=status-bar.d.ts.map