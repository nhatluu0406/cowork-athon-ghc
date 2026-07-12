/**
 * Existence probe for the recent-workspaces list (CGHC-008, W2).
 *
 * The MRU list stores paths only; whether each still points at a real directory is decided
 * fresh at render/selection time. This is the production {@link RecentExistenceProbe}: it
 * returns `true` only when the path currently resolves to a directory, and `false` (never a
 * throw) for a missing / renamed / non-directory path, so an unavailable entry renders as
 * UNAVAILABLE instead of crashing the list.
 */

import { stat } from "node:fs/promises";
import type { RecentExistenceProbe } from "./recent.js";

/** Real filesystem existence-as-directory probe backed by `node:fs/promises`. */
export const nodeExistenceProbe: RecentExistenceProbe = async (rootPath: string) => {
  try {
    return (await stat(rootPath)).isDirectory();
  } catch {
    return false;
  }
};
