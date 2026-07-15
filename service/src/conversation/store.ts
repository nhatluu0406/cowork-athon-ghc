/**
 * File-backed conversation store (legacy / tests without SQLite).
 * Production Wave 0B uses {@link createSqliteConversationStore} as the sole source.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppendMessageInput,
  ConversationMessage,
  ConversationPatch,
  ConversationRecord,
  ConversationSummary,
  CreateConversationInput,
  ConversationStatus,
  PersistedActivitySnapshot,
  RuntimeTurnRecord,
} from "./types.js";
import { normalizeTitle, titleFromFirstMessage } from "./title.js";

export interface ConversationStore {
  list(query?: string): Promise<readonly ConversationSummary[]>;
  get(id: string): Promise<ConversationRecord | undefined>;
  create(input: CreateConversationInput): Promise<ConversationRecord>;
  rename(id: string, title: string): Promise<ConversationRecord>;
  updateStatus(id: string, status: ConversationStatus): Promise<ConversationRecord>;
  setRuntimeSession(id: string, runtimeSessionId: string | null): Promise<ConversationRecord>;
  patch(id: string, patch: ConversationPatch): Promise<ConversationRecord>;
  setActivity(id: string, activity: PersistedActivitySnapshot): Promise<ConversationRecord>;
  appendMessage(id: string, message: AppendMessageInput): Promise<ConversationRecord>;
  delete(id: string): Promise<boolean>;
  recoverStaleRunning(): Promise<number>;
  getLastActiveId(): Promise<string | null>;
  setLastActiveId(id: string): Promise<void>;
}

export interface ConversationStoreOptions {
  readonly rootDir: string;
  readonly now?: () => string;
}

interface IndexFile {
  readonly version: 1;
  readonly conversations: readonly ConversationSummary[];
  readonly lastActiveConversationId?: string | null;
}

function summaryOf(record: ConversationRecord): ConversationSummary {
  const { messages: _messages, model: _model, ...summary } = record;
  return { ...summary, messageCount: record.messages.length };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export function createConversationStore(options: ConversationStoreOptions): ConversationStore {
  const root = options.rootDir;
  const indexPath = join(root, "index.json");
  const clock = options.now ?? (() => new Date().toISOString());

  async function ensureDir(): Promise<void> {
    await mkdir(root, { recursive: true });
  }

  async function readIndex(): Promise<IndexFile> {
    await ensureDir();
    try {
      const raw = await readFile(indexPath, "utf8");
      const parsed = JSON.parse(raw) as IndexFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.conversations)) {
        return { version: 1, conversations: [] };
      }
      return parsed;
    } catch {
      return { version: 1, conversations: [] };
    }
  }

  async function writeIndex(
    conversations: readonly ConversationSummary[],
    lastActiveConversationId?: string | null,
  ): Promise<void> {
    const sorted = [...conversations].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
    const index = await readIndex();
    const payload: IndexFile = {
      version: 1,
      conversations: sorted,
      ...(lastActiveConversationId !== undefined
        ? { lastActiveConversationId }
        : index.lastActiveConversationId !== undefined
          ? { lastActiveConversationId: index.lastActiveConversationId }
          : {}),
    };
    await atomicWriteJson(indexPath, payload);
  }

  async function readRecord(id: string): Promise<ConversationRecord | undefined> {
    try {
      const raw = await readFile(join(root, `${id}.json`), "utf8");
      return JSON.parse(raw) as ConversationRecord;
    } catch {
      return undefined;
    }
  }

  async function writeRecord(record: ConversationRecord): Promise<void> {
    await atomicWriteJson(join(root, `${record.id}.json`), record);
  }

  async function mutate(
    id: string,
    fn: (record: ConversationRecord) => ConversationRecord,
  ): Promise<ConversationRecord> {
    const existing = await readRecord(id);
    if (existing === undefined) throw new Error(`Conversation not found: ${id}`);
    const next = fn(existing);
    await writeRecord(next);
    const index = await readIndex();
    const summaries = index.conversations.filter((c) => c.id !== id);
    await writeIndex([summaryOf(next), ...summaries]);
    return next;
  }

  return {
    async list(query) {
      const index = await readIndex();
      const q = query?.trim().toLowerCase();
      if (q === undefined || q.length === 0) return index.conversations;
      const matches: ConversationSummary[] = [];
      for (const summary of index.conversations) {
        if (summary.title.toLowerCase().includes(q)) {
          matches.push(summary);
          continue;
        }
        const record = await readRecord(summary.id);
        if (record === undefined) continue;
        if (record.messages.some((m) => m.role === "user" && m.text.toLowerCase().includes(q))) {
          matches.push(summaryOf(record));
        }
      }
      return matches.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },

    async get(id) {
      return readRecord(id);
    },

    async create(input) {
      await ensureDir();
      const now = clock();
      const id = randomUUID();
      const record: ConversationRecord = {
        id,
        title: input.title?.trim() || "Cuộc trò chuyện mới",
        workspacePath: input.workspacePath,
        runtimeSessionId: null,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        messages: [],
        ...(input.providerId !== undefined ? { providerId: input.providerId } : {}),
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.providerSnapshot !== undefined ? { providerSnapshot: input.providerSnapshot } : {}),
        ...(input.modelId !== undefined && input.providerId !== undefined
          ? { model: { providerID: input.providerId, modelID: input.modelId } }
          : {}),
      };
      await writeRecord(record);
      const index = await readIndex();
      await writeIndex([summaryOf(record), ...index.conversations]);
      return record;
    },

    rename(id, title) {
      const normalized = normalizeTitle(title);
      return mutate(id, (record) => ({ ...record, title: normalized, updatedAt: clock() }));
    },

    updateStatus(id, status) {
      return mutate(id, (record) => ({ ...record, status, updatedAt: clock() }));
    },

    setRuntimeSession(id, runtimeSessionId) {
      return mutate(id, (record) => ({
        ...record,
        runtimeSessionId,
        updatedAt: clock(),
        status: runtimeSessionId === null ? record.status : "ready",
      }));
    },

    patch(id, patch) {
      return mutate(id, (record) => {
        let next: ConversationRecord = { ...record, updatedAt: clock() };
        if (patch.title !== undefined) {
          next = { ...next, title: normalizeTitle(patch.title) };
        }
        if (patch.status !== undefined) {
          next = { ...next, status: patch.status };
        }
        if (patch.runtimeSessionId !== undefined) {
          next = {
            ...next,
            runtimeSessionId: patch.runtimeSessionId,
            ...(patch.runtimeSessionId !== null && patch.status === undefined
              ? { status: "ready" as const }
              : {}),
          };
        }
        if (patch.activity !== undefined) {
          next = { ...next, activity: patch.activity };
        }
        if (patch.providerSnapshot !== undefined) {
          next = { ...next, providerSnapshot: patch.providerSnapshot };
        }
        if (patch.registerRuntimeTurn !== undefined) {
          const turns = [...(next.runtimeTurns ?? []), patch.registerRuntimeTurn];
          next = { ...next, runtimeTurns: turns };
        }
        if (patch.completeRuntimeTurn !== undefined) {
          const turns = [...(next.runtimeTurns ?? [])];
          const idx = turns.findIndex(
            (t) => t.runtimeSessionId === patch.completeRuntimeTurn!.runtimeSessionId,
          );
          if (idx >= 0) {
            const updated: RuntimeTurnRecord = {
              ...turns[idx]!,
              status: patch.completeRuntimeTurn.status,
              completedAt: patch.completeRuntimeTurn.completedAt,
            };
            turns[idx] = updated;
            next = { ...next, runtimeTurns: turns };
          }
        }
        return next;
      });
    },

    setActivity(id, activity) {
      return mutate(id, (record) => ({ ...record, activity, updatedAt: clock() }));
    },

    async appendMessage(id, message) {
      const text = message.text.trim();
      if (text.length === 0) throw new Error("Message text is required.");
      return mutate(id, (record) => {
        const at = clock();
        const entry: ConversationMessage = {
          id: randomUUID(),
          role: message.role,
          text,
          at,
          ...(message.attachments !== undefined && message.attachments.length > 0
            ? { attachments: message.attachments }
            : {}),
          ...(message.skills !== undefined && message.skills.length > 0
            ? { skills: message.skills }
            : {}),
        };
        const messages = [...record.messages, entry];
        const title =
          record.messages.length === 0 && message.role === "user"
            ? titleFromFirstMessage(text)
            : record.title;
        return {
          ...record,
          title,
          messages,
          messageCount: messages.length,
          updatedAt: at,
        };
      });
    },

    async delete(id) {
      const index = await readIndex();
      if (!index.conversations.some((c) => c.id === id)) return false;
      const lastActive =
        index.lastActiveConversationId === id ? null : index.lastActiveConversationId;
      await writeIndex(index.conversations.filter((c) => c.id !== id), lastActive);
      try {
        await unlink(join(root, `${id}.json`));
      } catch {
        // best effort
      }
      return true;
    },

    async getLastActiveId() {
      const index = await readIndex();
      const id = index.lastActiveConversationId;
      if (id === undefined || id === null) return null;
      if (!index.conversations.some((c) => c.id === id)) return null;
      return id;
    },

    async setLastActiveId(id) {
      const index = await readIndex();
      if (!index.conversations.some((c) => c.id === id)) return;
      await writeIndex(index.conversations, id);
    },

    async recoverStaleRunning() {
      const index = await readIndex();
      let count = 0;
      const next: ConversationSummary[] = [];
      for (const summary of index.conversations) {
        if (summary.status !== "running") {
          next.push(summary);
          continue;
        }
        const record = await readRecord(summary.id);
        if (record === undefined) {
          next.push(summary);
          continue;
        }
        const updated: ConversationRecord = { ...record, status: "interrupted", updatedAt: clock() };
        await writeRecord(updated);
        next.push(summaryOf(updated));
        count += 1;
      }
      if (count > 0) await writeIndex(next);
      return count;
    },
  };
}
