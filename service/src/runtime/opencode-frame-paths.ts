/**
 * Normalize tool file paths inside raw OpenCode frames before EV mapping.
 *
 * Keeps canonical workspace-relative paths at the service boundary so the renderer never needs
 * folder-basename heuristics.
 */

import { asRecord, isRawOpencodeEvent, readString } from "../execution/opencode-events.js";
import { resolveWorkspaceRelativePath } from "../workspace/resolve-relative.js";

const PATH_KEYS = ["filePath", "path", "file"] as const;

function readToolInputPath(input: Record<string, unknown>): { key: string; value: string } | undefined {
  for (const key of PATH_KEYS) {
    const value = readString(input, key);
    if (value !== undefined && value.length > 0) return { key, value };
  }
  return undefined;
}

/** In-place clone + normalize file paths on tool parts and permission metadata. */
export async function normalizeOpencodeFramePaths(
  frame: unknown,
  workspaceRoot: string,
): Promise<unknown> {
  if (!isRawOpencodeEvent(frame)) return frame;

  if (frame.type === "permission.asked") {
    const props = asRecord(frame.properties);
    const metadata = asRecord(props.metadata);
    for (const key of PATH_KEYS) {
      const current = readString(metadata, key);
      if (current === undefined) continue;
      const resolved = await resolveWorkspaceRelativePath(workspaceRoot, current);
      if (resolved.ok) metadata[key] = resolved.relativePath;
    }
    const patterns = props.patterns;
    if (Array.isArray(patterns)) {
      const next: string[] = [];
      for (const entry of patterns) {
        if (typeof entry !== "string" || entry.length === 0) {
          next.push(typeof entry === "string" ? entry : "");
          continue;
        }
        if (entry.includes("*") || entry.includes("?")) {
          next.push(entry);
          continue;
        }
        const resolved = await resolveWorkspaceRelativePath(workspaceRoot, entry);
        next.push(resolved.ok ? resolved.relativePath : entry);
      }
      props.patterns = next;
    }
    return frame;
  }

  if (frame.type !== "message.part.updated") return frame;

  const props = asRecord(frame.properties);
  const part = asRecord(props.part);
  if (readString(part, "type") !== "tool") return frame;

  const state = asRecord(part.state);
  const input = asRecord(state.input);
  const found = readToolInputPath(input);
  if (found === undefined) return frame;

  const resolved = await resolveWorkspaceRelativePath(workspaceRoot, found.value);
  if (!resolved.ok) return frame;
  input[found.key] = resolved.relativePath;
  return frame;
}
