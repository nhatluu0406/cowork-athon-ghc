/**
 * SQLite-backed {@link ConversationStore} (Wave 0B / ADR 0007).
 *
 * Persists summaries, messages, provider snapshots, durable runtime turns,
 * attachment metadata, and File Work Review *references*. Does not store raw
 * token deltas or SSE frames. Workspace/file snapshot bytes stay on the filesystem.
 */

import { randomUUID } from "node:crypto";
import type { ConversationStore } from "../conversation/store.js";
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
} from "../conversation/types.js";
import { normalizeTitle, titleFromFirstMessage } from "../conversation/title.js";
import type { AppMetaRepository } from "./repositories.js";
import type { SqliteDatabase } from "./sqlite.js";

export const META_LAST_ACTIVE_CONVERSATION = "conversations.last_active_id";

export interface SqliteConversationStoreOptions {
  readonly db: SqliteDatabase;
  readonly appMeta: AppMetaRepository;
  readonly now?: () => string;
}

interface ConversationShell {
  readonly id: string;
  readonly title: string;
  readonly workspacePath: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly runtimeSessionId: string | null;
  readonly parentId?: string;
  readonly status: ConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly model?: ConversationRecord["model"];
  readonly providerSnapshot?: ConversationRecord["providerSnapshot"];
  readonly activity?: PersistedActivitySnapshot;
}

function shellOf(record: ConversationRecord): ConversationShell {
  const { messages: _m, runtimeTurns: _t, ...shell } = record;
  return {
    ...shell,
    messageCount: record.messages.length,
  };
}

function summaryOf(shell: ConversationShell): ConversationSummary {
  return {
    id: shell.id,
    title: shell.title,
    workspacePath: shell.workspacePath,
    runtimeSessionId: shell.runtimeSessionId,
    status: shell.status,
    createdAt: shell.createdAt,
    updatedAt: shell.updatedAt,
    messageCount: shell.messageCount,
    ...(shell.providerId !== undefined ? { providerId: shell.providerId } : {}),
    ...(shell.modelId !== undefined ? { modelId: shell.modelId } : {}),
    ...(shell.parentId !== undefined ? { parentId: shell.parentId } : {}),
  };
}

function parseShell(documentJson: string): ConversationShell {
  return JSON.parse(documentJson) as ConversationShell;
}

function parseMessage(documentJson: string): ConversationMessage {
  return JSON.parse(documentJson) as ConversationMessage;
}

function parseTurn(documentJson: string): RuntimeTurnRecord {
  return JSON.parse(documentJson) as RuntimeTurnRecord;
}

function reviewRefDocument(review: Record<string, unknown>): string {
  const relativePath = typeof review.relativePath === "string" ? review.relativePath : "";
  return JSON.stringify({
    id: typeof review.id === "string" ? review.id : "",
    relativePath,
    eventKind: review.eventKind,
    at: review.at,
    seq: review.seq,
    source: review.source,
    operation: review.operation,
    callId: review.callId,
    runtimeTurnId: review.runtimeTurnId,
    beforeHash: review.beforeHash,
    afterHash: review.afterHash,
    beforeExists: review.beforeExists,
    afterExists: review.afterExists,
    truncated: review.truncated,
    isBinary: review.isBinary,
    contentRedacted: review.contentRedacted,
  });
}

/** Persist one conversation graph (shell + messages + turns + attachment/review refs). */
export function persistConversationRecord(db: SqliteDatabase, record: ConversationRecord): void {
  const shell = shellOf(record);
  const upsertConv = db.prepare(
    "INSERT INTO conversations (id, document_json, updated_at) VALUES (@id, @documentJson, @updatedAt) " +
      "ON CONFLICT(id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at",
  );
  const deleteMessages = db.prepare("DELETE FROM messages WHERE conversation_id = ?");
  const insertMessage = db.prepare(
    "INSERT INTO messages (id, conversation_id, document_json, created_at) VALUES (@id, @conversationId, @documentJson, @createdAt)",
  );
  const deleteTurns = db.prepare("DELETE FROM runtime_turns WHERE conversation_id = ?");
  const insertTurn = db.prepare(
    "INSERT INTO runtime_turns (id, conversation_id, document_json, created_at) VALUES (@id, @conversationId, @documentJson, @createdAt)",
  );
  const deleteAttachments = db.prepare(
    "DELETE FROM conversation_attachments WHERE conversation_id = ?",
  );
  const insertAttachment = db.prepare(
    "INSERT INTO conversation_attachments (id, conversation_id, document_json) VALUES (@id, @conversationId, @documentJson)",
  );
  const deleteReviewRefs = db.prepare("DELETE FROM file_review_refs WHERE conversation_id = ?");
  const insertReviewRef = db.prepare(
    "INSERT INTO file_review_refs (id, conversation_id, relative_path, document_json) VALUES (@id, @conversationId, @relativePath, @documentJson)",
  );

  const run = db.transaction(() => {
    upsertConv.run({
      id: record.id,
      documentJson: JSON.stringify(shell),
      updatedAt: record.updatedAt,
    });

    deleteMessages.run(record.id);
    for (const message of record.messages) {
      insertMessage.run({
        id: message.id,
        conversationId: record.id,
        documentJson: JSON.stringify(message),
        createdAt: message.at,
      });
    }

    deleteTurns.run(record.id);
    for (const turn of record.runtimeTurns ?? []) {
      insertTurn.run({
        id: turn.runtimeSessionId,
        conversationId: record.id,
        documentJson: JSON.stringify(turn),
        createdAt: turn.startedAt,
      });
    }

    deleteAttachments.run(record.id);
    for (const message of record.messages) {
      for (const attachment of message.attachments ?? []) {
        insertAttachment.run({
          id: randomUUID(),
          conversationId: record.id,
          documentJson: JSON.stringify({
            messageId: message.id,
            ...attachment,
          }),
        });
      }
    }

    deleteReviewRefs.run(record.id);
    const seenReviewIds = new Set<string>();
    for (const review of record.activity?.fileReviews ?? []) {
      if (typeof review !== "object" || review === null) continue;
      const rec = review as Record<string, unknown>;
      const reviewId = typeof rec.id === "string" && rec.id.length > 0 ? rec.id : randomUUID();
      if (seenReviewIds.has(reviewId)) continue;
      seenReviewIds.add(reviewId);
      const relativePath = typeof rec.relativePath === "string" ? rec.relativePath : "";
      // Scope the PRIMARY KEY by conversation: OpenCode seq-based review ids collide globally.
      insertReviewRef.run({
        id: `${record.id}:${reviewId}`,
        conversationId: record.id,
        relativePath,
        documentJson: reviewRefDocument({ ...rec, id: reviewId }),
      });
    }
  });
  run();
}

export function createSqliteConversationStore(
  options: SqliteConversationStoreOptions,
): ConversationStore {
  const { db, appMeta } = options;
  const clock = options.now ?? (() => new Date().toISOString());

  const getConv = db.prepare(
    "SELECT document_json AS documentJson FROM conversations WHERE id = ?",
  );
  const listConv = db.prepare(
    "SELECT id, document_json AS documentJson FROM conversations ORDER BY updated_at DESC",
  );
  const deleteConv = db.prepare("DELETE FROM conversations WHERE id = ?");
  const listMessages = db.prepare(
    "SELECT document_json AS documentJson FROM messages WHERE conversation_id = ? ORDER BY rowid ASC",
  );
  const listTurns = db.prepare(
    "SELECT document_json AS documentJson FROM runtime_turns WHERE conversation_id = ? ORDER BY rowid ASC",
  );
  const deleteMessages = db.prepare("DELETE FROM messages WHERE conversation_id = ?");
  const deleteTurns = db.prepare("DELETE FROM runtime_turns WHERE conversation_id = ?");
  const deleteAttachments = db.prepare(
    "DELETE FROM conversation_attachments WHERE conversation_id = ?",
  );
  const deleteReviewRefs = db.prepare("DELETE FROM file_review_refs WHERE conversation_id = ?");

  function readRecord(id: string): ConversationRecord | undefined {
    const row = getConv.get(id) as { documentJson: string } | undefined;
    if (row === undefined) return undefined;
    const shell = parseShell(row.documentJson);
    const messages = (listMessages.all(id) as Array<{ documentJson: string }>).map((m) =>
      parseMessage(m.documentJson),
    );
    const turns = (listTurns.all(id) as Array<{ documentJson: string }>).map((t) =>
      parseTurn(t.documentJson),
    );
    // Rebuild with exactOptionalPropertyTypes: omit absent optionals (do not spread `undefined`).
    const record: ConversationRecord = {
      id: shell.id,
      title: shell.title,
      workspacePath: shell.workspacePath,
      runtimeSessionId: shell.runtimeSessionId,
      status: shell.status,
      createdAt: shell.createdAt,
      updatedAt: shell.updatedAt,
      messageCount: messages.length,
      messages,
      ...(shell.providerId !== undefined ? { providerId: shell.providerId } : {}),
      ...(shell.modelId !== undefined ? { modelId: shell.modelId } : {}),
      ...(shell.parentId !== undefined ? { parentId: shell.parentId } : {}),
      ...(shell.model !== undefined ? { model: shell.model } : {}),
      ...(shell.providerSnapshot !== undefined
        ? { providerSnapshot: shell.providerSnapshot }
        : {}),
      ...(shell.activity !== undefined ? { activity: shell.activity } : {}),
      ...(turns.length > 0 ? { runtimeTurns: turns } : {}),
    };
    return record;
  }

  function writeRecord(record: ConversationRecord): void {
    persistConversationRecord(db, record);
  }

  async function mutate(
    id: string,
    fn: (record: ConversationRecord) => ConversationRecord,
  ): Promise<ConversationRecord> {
    const existing = readRecord(id);
    if (existing === undefined) throw new Error(`Conversation not found: ${id}`);
    const next = fn(existing);
    writeRecord(next);
    return next;
  }

  return {
    async list(query) {
      const rows = listConv.all() as Array<{ id: string; documentJson: string }>;
      const q = query?.trim().toLowerCase();
      if (q === undefined || q.length === 0) {
        return rows.map((row) => summaryOf(parseShell(row.documentJson)));
      }
      const matches: ConversationSummary[] = [];
      for (const row of rows) {
        const shell = parseShell(row.documentJson);
        if (shell.title.toLowerCase().includes(q)) {
          matches.push(summaryOf(shell));
          continue;
        }
        const record = readRecord(shell.id);
        if (record === undefined) continue;
        if (record.messages.some((m) => m.role === "user" && m.text.toLowerCase().includes(q))) {
          matches.push(summaryOf(shellOf(record)));
        }
      }
      return matches.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },

    async get(id) {
      return readRecord(id);
    },

    async create(input) {
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
        ...(input.providerSnapshot !== undefined
          ? { providerSnapshot: input.providerSnapshot }
          : {}),
        ...(input.modelId !== undefined && input.providerId !== undefined
          ? { model: { providerID: input.providerId, modelID: input.modelId } }
          : {}),
      };
      writeRecord(record);
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

    async appendMessage(id, message: AppendMessageInput) {
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

    async compact(id, summary, throughMessageId) {
      return mutate(id, (record) => {
        // Summarizing costs an LLM round-trip, so messages can land while it runs. Only the
        // messages the caller actually summarized may be replaced; anything appended after
        // its snapshot must survive, or a turn that completed mid-compaction is destroyed
        // and is absent from the summary too.
        let tail: readonly ConversationMessage[] = [];
        if (throughMessageId !== undefined) {
          const cut = record.messages.findIndex((m) => m.id === throughMessageId);
          if (cut < 0) {
            throw new Error("Compaction boundary message no longer exists; refusing to drop history.");
          }
          tail = record.messages.slice(cut + 1);
        }

        const prefix = "[Ngữ cảnh cuộc trò chuyện trước — dùng để trả lời nhất quán; không lặp lại nguyên văn trừ khi được hỏi.]";
        const suffix = "[Hết ngữ cảnh — trả lời yêu cầu mới bên dưới.]";
        const msgText = `${prefix}\n- Lịch sử hội thoại cũ đã được dọn dẹp và nén lại thành tóm tắt:\n${summary}\n${suffix}`;

        const at = clock();
        const summaryMessage: ConversationMessage = {
          id: randomUUID(),
          role: "assistant",
          text: msgText,
          at,
        };

        const messages = [summaryMessage, ...tail];
        return { ...record, messages, messageCount: messages.length, updatedAt: at };
      });
    },

    async delete(id) {
      const existing = readRecord(id);
      if (existing === undefined) return false;
      const deleteAll = db.transaction((conversationId: string) => {
        deleteMessages.run(conversationId);
        deleteTurns.run(conversationId);
        deleteAttachments.run(conversationId);
        deleteReviewRefs.run(conversationId);
        deleteConv.run(conversationId);
      });
      deleteAll(id);
      if (appMeta.get(META_LAST_ACTIVE_CONVERSATION) === id) {
        appMeta.set(META_LAST_ACTIVE_CONVERSATION, "");
      }
      return true;
    },

    async getLastActiveId() {
      const id = appMeta.get(META_LAST_ACTIVE_CONVERSATION);
      if (id === null || id.length === 0) return null;
      return readRecord(id) !== undefined ? id : null;
    },

    async setLastActiveId(id) {
      if (readRecord(id) === undefined) return;
      appMeta.set(META_LAST_ACTIVE_CONVERSATION, id);
    },

    async recoverStaleRunning() {
      const rows = listConv.all() as Array<{ id: string; documentJson: string }>;
      let count = 0;
      for (const row of rows) {
        const shell = parseShell(row.documentJson);
        if (shell.status !== "running") continue;
        const record = readRecord(shell.id);
        if (record === undefined) continue;
        writeRecord({ ...record, status: "interrupted", updatedAt: clock() });
        count += 1;
      }
      return count;
    },
  };
}
