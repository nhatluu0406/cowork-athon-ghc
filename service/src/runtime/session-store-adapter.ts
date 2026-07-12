/**
 * LIVE {@link SessionStore} over the supervised OpenCode child (CGHC-028 Wave A2).
 *
 * Fills the Tier 2 session-store seam (`compose-service.ts` default: reject-everything). OpenCode's
 * own store is the content source of truth (ONE session mechanism); this adapter carries only the
 * light, secret-free metadata the app owns (id, title, timestamps, workspace, model ref) and never
 * writes `auth.json`/`env.json`. A live OpenCode `serve` is bound to one workspace (its `cwd`), so
 * every session it holds belongs to that ONE `workspaceId`, which the adapter stamps on each record
 * (OpenCode does not echo a workspace on `GET /session`).
 *
 * ROUTES (flag for Wave C live confirmation against the pinned OpenAPI):
 *  - create  POST   /session            (confirmed in-repo: capture tool + design)
 *  - list    GET    /session            (assumed; SDK `session.list`)
 *  - get     GET    /session/{id}       (assumed; SDK `session.get`)
 *  - rename  PATCH  /session/{id}       (assumed; SDK `session.update` — NOT confirmed in-repo)
 *  - replay  GET    /session/{id}/message → SYNTHESIZE `message.part.updated` frames
 *            (assumed; SDK `session.messages` — NOT confirmed in-repo)
 *
 * `replay` reconstructs the RAW `/event` frame shape the CGHC-012 mapper folds: OpenCode persists
 * MESSAGES + PARTS, not event frames, so each stored part becomes a
 * `{ type: "message.part.updated", properties: { sessionID, part } }` envelope — identical to the
 * live `/event` frame the mapper already understands, so the rebuilt view matches the live path.
 */

import type { ModelRef, SessionId } from "@cowork-ghc/contracts";
import type { WorkspaceId } from "@cowork-ghc/contracts";
import type {
  CreateSessionInput,
  SessionStore,
  StoredSession,
} from "../session/index.js";
import type { OpencodeHttp } from "./opencode-client.js";

export interface OpencodeSessionStoreOptions {
  readonly http: OpencodeHttp;
  /** The single workspace this runtime child serves (its launch `cwd`). */
  readonly workspaceId: WorkspaceId;
  /** Fallback clock when the child omits a timestamp (deterministic in tests). */
  readonly now?: () => string;
}

export function createOpencodeSessionStore(options: OpencodeSessionStoreOptions): SessionStore {
  const { http, workspaceId } = options;
  const now = options.now ?? (() => new Date().toISOString());

  const toStored = (info: unknown, model?: ModelRef): StoredSession => {
    const rec = asRecord(info);
    const times = readTimes(rec);
    const base = {
      id: readId(rec) ?? "",
      title: readString(rec, "title") ?? "Untitled",
      workspaceId,
      createdAt: times.created ?? now(),
      updatedAt: times.updated ?? now(),
    };
    return model !== undefined ? { ...base, model } : base;
  };

  return {
    async create(input: CreateSessionInput): Promise<StoredSession> {
      const info = await http.json<unknown>({
        operation: "session.create",
        method: "POST",
        path: "/session",
        body: input.title !== undefined ? { title: input.title } : {},
      });
      return toStored(info, input.model);
    },

    async list(): Promise<readonly StoredSession[]> {
      const rows = await http.json<unknown>({
        operation: "session.list",
        method: "GET",
        path: "/session",
      });
      return asArray(rows).map((row) => toStored(row));
    },

    async get(id: SessionId): Promise<StoredSession | undefined> {
      const info = await http.jsonOrNull<unknown>({
        operation: "session.get",
        method: "GET",
        path: `/session/${encodeURIComponent(id)}`,
      });
      return info === null ? undefined : toStored(info);
    },

    async rename(id: SessionId, title: string): Promise<StoredSession> {
      const info = await http.json<unknown>({
        operation: "session.rename",
        method: "PATCH",
        path: `/session/${encodeURIComponent(id)}`,
        body: { title },
      });
      return toStored(info);
    },

    async replay(id: SessionId): Promise<readonly unknown[]> {
      const messages = await http.json<unknown>({
        operation: "session.replay",
        method: "GET",
        path: `/session/${encodeURIComponent(id)}/message`,
      });
      const frames: unknown[] = [];
      for (const message of asArray(messages)) {
        const rec = asRecord(message);
        const info = asRecord(rec.info);
        const infoId = readString(info, "id");
        const infoRole = readString(info, "role");
        if (infoId !== undefined && (infoRole === "user" || infoRole === "assistant")) {
          frames.push({
            type: "message.updated",
            properties: { sessionID: id, info: { id: infoId, role: infoRole, sessionID: id } },
          });
        }
        for (const part of partsOf(message)) {
          frames.push({ type: "message.part.updated", properties: { sessionID: id, part } });
        }
      }
      return frames;
    },
  };
}

// --- local, decoupled read helpers (no dependency on the execution module) ---------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** OpenCode may key the id as `id` / `sessionID`, or nest it under `info`. */
function readId(rec: Record<string, unknown>): string | undefined {
  return (
    readString(rec, "id") ??
    readString(rec, "sessionID") ??
    (rec.info !== undefined ? readId(asRecord(rec.info)) : undefined)
  );
}

/** Read `time.{created,updated}` (epoch millis) as ISO, tolerating an absent/`info`-nested block. */
function readTimes(
  rec: Record<string, unknown>,
): { created?: string | undefined; updated?: string | undefined } {
  const source = rec.time !== undefined ? rec : asRecord(rec.info);
  const time = asRecord(source.time);
  return { created: toIso(time.created), updated: toIso(time.updated) };
}

function toIso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

/** Parts of one message row: `{ info, parts }`, or a bare part element as a tolerant fallback. */
function partsOf(message: unknown): readonly unknown[] {
  const rec = asRecord(message);
  if (Array.isArray(rec.parts)) return rec.parts;
  if (typeof rec.type === "string") return [rec];
  return [];
}
