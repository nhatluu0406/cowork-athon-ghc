/**
 * Boot-time restore: replay persisted {@link McpStore} rows into a fresh {@link McpRegistry} so
 * MCP servers survive a relaunch. Best-effort per row — RE5 isolation already makes a rejecting
 * add/enable a captured diagnostic rather than a throw, so one bad row can never abort boot.
 */

import type { McpRegistry } from "../extensions/index.js";
import type { McpStore } from "../db/index.js";

/** Re-add every persisted server and re-enable the ones that were enabled before the restart. */
export async function loadMcpServersFromStore(registry: McpRegistry, store: McpStore): Promise<void> {
  for (const doc of store.list()) {
    const added = await registry.add({
      id: doc.id,
      name: doc.name,
      ...(doc.command !== undefined ? { command: doc.command } : {}),
      ...(doc.url !== undefined ? { url: doc.url } : {}),
    });
    if (added.ok && doc.enabled) {
      await registry.enable(doc.id);
    }
  }
}
