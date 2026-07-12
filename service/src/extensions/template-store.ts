/**
 * TemplateStore seam + in-memory default (CGHC-026 RE4).
 *
 * The ONE source of truth for saved workflow-template CONTENT (a different state type from the
 * extension STATUS held in {@link import("./extension-state.js").ExtensionState}). A real
 * persistent store can be injected later; the default is in-memory (no disk, no network).
 */

import type { WorkflowTemplate } from "./template-registry.js";

export interface TemplateStore {
  /** Save (insert or overwrite) a template by id. */
  save(template: WorkflowTemplate): void;
  /** One template by id, or `undefined`. */
  get(id: string): WorkflowTemplate | undefined;
  /** All saved templates (snapshot). */
  list(): readonly WorkflowTemplate[];
  /** Remove a template; returns whether it existed. */
  delete(id: string): boolean;
}

export function createInMemoryTemplateStore(): TemplateStore {
  const templates = new Map<string, WorkflowTemplate>();
  return {
    save: (template) => void templates.set(template.id, template),
    get: (id) => templates.get(id),
    list: () => [...templates.values()],
    delete: (id) => templates.delete(id),
  };
}
