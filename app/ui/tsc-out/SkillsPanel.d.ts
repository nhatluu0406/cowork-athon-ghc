/**
 * Minimal functional Skills UI: service-owned discovery, enable/disable, bounded preview.
 *
 * React port of the former `mountSkillsPanel` DOM builder — markup, classnames, and copy are
 * unchanged. Mounted via the `mountSkillsPanel` shim in `skills-panel.ts`, which bridges the old
 * imperative `SkillsPanelHandle` contract onto this component through `useImperativeHandle`.
 */
import { type Ref } from "react";
import type { ServiceClient, SkillView } from "./service-client.js";
export interface SkillsPanelHandle {
    refresh(): Promise<void>;
}
export interface SkillsPanelProps {
    client: ServiceClient;
    onChanged: (skills: readonly SkillView[]) => void;
    ref?: Ref<SkillsPanelHandle>;
}
export declare function SkillsPanel({ client, onChanged, ref }: SkillsPanelProps): import("react").JSX.Element;
//# sourceMappingURL=SkillsPanel.d.ts.map