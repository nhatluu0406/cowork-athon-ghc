/**
 * Mount shim: bridges the React `SkillsPanel` component onto the imperative
 * `mountSkillsPanel(root, client, onChanged) -> SkillsPanelHandle` contract still used by
 * `app-shell.ts`, so that call site needs no changes.
 */
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { SkillsPanel } from "./SkillsPanel.js";
export function mountSkillsPanel(root, client, onChanged) {
    const handleRef = createRef();
    createRoot(root).render(createElement(SkillsPanel, { client, onChanged, ref: handleRef }));
    return {
        refresh: () => handleRef.current?.refresh() ?? Promise.resolve(),
    };
}
//# sourceMappingURL=skills-panel.js.map