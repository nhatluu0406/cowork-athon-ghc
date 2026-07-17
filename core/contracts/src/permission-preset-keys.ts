/**
 * Canonical `PermissionPreset` key ↔ `PermissionActionKind` mapping (D1 fix, follow-up finding
 * 2). Shared by validation ({@link import("./dispatch.js").validateAgentDefinition}, which
 * rejects an unenforceable key) and enforcement (`service/src/files/tool-permission-proxy.ts`,
 * which looks a preset up by this SAME mapping) so the two can never silently drift apart.
 *
 * The live base policy (`LIVE_SESSION_PERMISSION_POLICY`, `service/src/runtime/opencode-config.ts`)
 * gates every file mutation through the single `edit` key and command execution through `bash`;
 * a narrowing preset restricts the SAME keys. `isNarrowingPreset` (`dispatch.ts`) accepts ANY
 * string key — a key it does not recognize simply defaults its base rank to `ask`, so a `deny`
 * on an unknown key like `"*"` or `"delete"` always "narrows" and validates. But
 * `ToolPermissionProxy` only ever consults `ENFORCEABLE_PRESET_KEYS` — a key outside that set is
 * accepted, persisted, and displayed, yet NEVER enforced: a silent no-op that looks like a
 * lockdown and isn't. `validateAgentDefinition` therefore rejects such a key outright.
 */

import type { PermissionActionKind } from "./permission.js";

/**
 * Every {@link PermissionActionKind}. Kept in lockstep with the union by the `never`
 * exhaustiveness check inside {@link presetKeyForActionKind}: adding a new action kind without
 * updating that `switch` is a compile error, so this list can never silently fall behind.
 */
const ALL_PERMISSION_ACTION_KINDS: readonly PermissionActionKind[] = [
  "file_create",
  "file_edit",
  "file_delete",
  "file_move",
  "command_exec",
  "ms365_write",
  "network_access",
];

/**
 * Map a boundary action kind to the preset key that governs it. `ms365_write` maps here only for
 * exhaustiveness — MS365 tool calls do not flow through `ToolPermissionProxy` (they submit
 * directly to the `PermissionGate`), so a preset never actually governs an MS365 write today.
 */
export function presetKeyForActionKind(kind: PermissionActionKind): string {
  switch (kind) {
    case "file_create":
    case "file_edit":
    case "file_delete":
    case "file_move":
    case "ms365_write":
      return "edit";
    case "command_exec":
      return "bash";
    case "network_access":
      return "network";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * The exact set of `PermissionPreset` keys the runtime boundary ever consults — DERIVED from
 * {@link presetKeyForActionKind}, never hand-kept in a second place.
 */
export const ENFORCEABLE_PRESET_KEYS: ReadonlySet<string> = new Set(
  ALL_PERMISSION_ACTION_KINDS.map(presetKeyForActionKind),
);
