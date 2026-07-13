/**
 * Mount shim: bridges the React `SkillsPanel` component onto the imperative
 * `mountSkillsPanel(root, client, onChanged) -> SkillsPanelHandle` contract still used by
 * `app-shell.ts`, so that call site needs no changes.
 */
import { type SkillsPanelHandle } from "./SkillsPanel.js";
import type { ServiceClient, SkillView } from "./service-client.js";
export type { SkillsPanelHandle };
export declare function mountSkillsPanel(root: HTMLElement, client: ServiceClient, onChanged: (skills: readonly SkillView[]) => void): SkillsPanelHandle;
//# sourceMappingURL=skills-panel.d.ts.map