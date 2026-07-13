/**
 * Mount shim: bridges the React `SkillsPanel` component onto the imperative
 * `mountSkillsPanel(root, client, onChanged) -> SkillsPanelHandle` contract still used by
 * `app-shell.ts`, so that call site needs no changes.
 */

import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { SkillsPanel, type SkillsPanelHandle } from "./SkillsPanel.js";
import type { ServiceClient, SkillView } from "./service-client.js";

export type { SkillsPanelHandle };

export function mountSkillsPanel(
  root: HTMLElement,
  client: ServiceClient,
  onChanged: (skills: readonly SkillView[]) => void,
): SkillsPanelHandle {
  const handleRef = createRef<SkillsPanelHandle>();
  createRoot(root).render(createElement(SkillsPanel, { client, onChanged, ref: handleRef }));
  return {
    refresh: () => handleRef.current?.refresh() ?? Promise.resolve(),
  };
}
