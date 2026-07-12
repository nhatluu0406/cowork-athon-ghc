/**
 * Recent-workspaces store — single source of truth for the picker's MRU list (CGHC-008, W2).
 *
 * The list holds ONLY non-secret data (an id, the absolute root path, and a timestamp). It is
 * a most-recently-used, de-duplicated, capacity-bounded list. Availability is NOT baked into
 * the stored entry: a folder can be renamed/removed after it was recorded, so the caller probes
 * existence at render/selection time via {@link listWithAvailability}. A missing folder is
 * reported `available: false` (UNAVAILABLE) — it is never silently dropped or allowed to crash
 * the render — so the user sees why it can't be reopened and can remove it explicitly.
 */

import type { WorkspaceGrant, WorkspaceId } from "@cowork-ghc/contracts";

/** A recorded workspace the user opened before. Contains no secret — path + timestamp only. */
export interface RecentWorkspaceEntry {
  readonly id: WorkspaceId;
  readonly rootPath: string;
  /** ISO-8601 timestamp of the most recent time this workspace was opened. */
  readonly lastOpenedAt: string;
}

/** A recent entry decorated with a freshly-probed availability flag (render/selection time). */
export interface RecentWorkspaceView extends RecentWorkspaceEntry {
  /** True when the folder still exists as a directory right now. */
  readonly available: boolean;
}

/** Probes whether a recorded root still exists as a directory. Injected for tests. */
export type RecentExistenceProbe = (rootPath: string) => Promise<boolean>;

export interface RecentWorkspacesOptions {
  /** Seed entries (e.g. loaded from persistence by a later task). MRU order preserved. */
  readonly initial?: readonly RecentWorkspaceEntry[];
  /** Maximum entries retained; oldest are evicted past this. Default 10. */
  readonly capacity?: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

/** The MRU store. One instance is the single source of truth for the recent list. */
export interface RecentWorkspaces {
  /** Record (or refresh to the front) a just-opened workspace. */
  record(grant: WorkspaceGrant): void;
  /** Current entries, most-recent first (no disk access). */
  list(): readonly RecentWorkspaceEntry[];
  /** Remove an entry by id; returns true when one existed. */
  remove(id: WorkspaceId): boolean;
  /** Entries most-recent first, each with a freshly-probed `available` flag. Keeps unavailable. */
  listWithAvailability(probe: RecentExistenceProbe): Promise<readonly RecentWorkspaceView[]>;
}

const DEFAULT_CAPACITY = 10;

/** Windows is case-insensitive; fold case there so the same folder de-dupes across picks. */
function pathKey(rootPath: string): string {
  return process.platform === "win32" ? rootPath.toLowerCase() : rootPath;
}

class RecentWorkspacesImpl implements RecentWorkspaces {
  /** Front (index 0) is most-recent. */
  private entries: RecentWorkspaceEntry[];
  private readonly capacity: number;
  private readonly now: () => Date;

  constructor(options: RecentWorkspacesOptions) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    this.now = options.now ?? (() => new Date());
    this.entries = (options.initial ?? []).slice(0, this.capacity).map((e) => ({ ...e }));
  }

  record(grant: WorkspaceGrant): void {
    const key = pathKey(grant.rootPath);
    const kept = this.entries.filter((e) => pathKey(e.rootPath) !== key);
    const entry: RecentWorkspaceEntry = {
      id: grant.id,
      rootPath: grant.rootPath,
      lastOpenedAt: this.now().toISOString(),
    };
    this.entries = [entry, ...kept].slice(0, this.capacity);
  }

  list(): readonly RecentWorkspaceEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  remove(id: WorkspaceId): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    return this.entries.length !== before;
  }

  async listWithAvailability(probe: RecentExistenceProbe): Promise<readonly RecentWorkspaceView[]> {
    // Probe in parallel; a probe rejection is treated as "unavailable" (never crashes render).
    return Promise.all(
      this.entries.map(async (entry) => {
        let available = false;
        try {
          available = await probe(entry.rootPath);
        } catch {
          available = false;
        }
        return { ...entry, available };
      }),
    );
  }
}

/** Build a recent-workspaces store (the single source of truth for the MRU list). */
export function createRecentWorkspaces(options: RecentWorkspacesOptions = {}): RecentWorkspaces {
  return new RecentWorkspacesImpl(options);
}
