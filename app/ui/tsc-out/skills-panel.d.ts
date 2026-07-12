/**
 * Minimal functional Skills UI: service-owned discovery, enable/disable, bounded preview.
 */
import type { ServiceClient, SkillView } from "./service-client.js";
export interface SkillsPanelHandle {
    refresh(): Promise<void>;
}
export declare function mountSkillsPanel(root: HTMLElement, client: ServiceClient, onChanged: (skills: readonly SkillView[]) => void): SkillsPanelHandle;
//# sourceMappingURL=skills-panel.d.ts.map