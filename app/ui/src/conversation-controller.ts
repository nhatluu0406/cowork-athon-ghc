/**
 * Conversation list + persistence controller (session management slice).
 *
 * Owns Cowork conversation identity separate from the OpenCode runtime session id.
 * The UI calls this module; it talks to the loopback conversation + session routes only.
 */

import type { SessionView } from "@cowork-ghc/service/execution";
import type {
  AttachmentMetadata,
  ConversationProviderSnapshot,
  ConversationRecord,
  ConversationStatus,
  ConversationSummary,
  CreateConversationInput,
  RuntimeTurnRecord,
  ServiceClient,
  SkillUseMetadata,
} from "./service-client.js";

export type RuntimePhase =
  | "idle"
  | "starting"
  | "ready"
  | "running"
  | "cancelling"
  | "completed"
  | "completed_without_final_message"
  | "denied"
  | "failed"
  | "cancelled";

export interface ConversationManagerState {
  summaries: readonly ConversationSummary[];
  activeConversationId: string | null;
  activeRecord: ConversationRecord | null;
  runtimeSessionId: string | null;
  runtimePhase: RuntimePhase;
  searchQuery: string;
  loading: boolean;
  listError: string | null;
  continuationAvailable: boolean;
}

export interface ConversationManager {
  readonly state: ConversationManagerState;
  refreshList(): Promise<void>;
  setSearch(query: string): Promise<void>;
  createNew(
    workspacePath: string,
    providerId?: string,
    modelId?: string,
    providerSnapshot?: ConversationProviderSnapshot,
  ): Promise<ConversationRecord>;
  select(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  /** Clear runtime binding so a new OpenCode session can be created for the same conversation. */
  startContinuation(): Promise<string>;
  linkRuntimeSession(runtimeSessionId: string, startedAt?: string): Promise<void>;
  completeRuntimeTurn(runtimeSessionId: string, status: RuntimeTurnRecord["status"]): Promise<void>;
  markLastActive(): Promise<void>;
  recordUserMessage(
    text: string,
    attachments?: readonly AttachmentMetadata[],
    skills?: readonly SkillUseMetadata[],
  ): Promise<void>;
  recordAssistantMessage(text: string): Promise<void>;
  setRuntimePhase(phase: RuntimePhase): Promise<void>;
  markInterrupted(): Promise<void>;
  shouldApplyStreamView(sessionId: string): boolean;
  mapTerminalToStatus(terminal: SessionView["terminal"]): ConversationStatus | null;
}

const TERMINAL_STATUSES: readonly ConversationStatus[] = [
  "completed",
  "cancelled",
  "errored",
  "interrupted",
];

function statusLabel(status: ConversationStatus): string {
  switch (status) {
    case "draft":
      return "Nháp";
    case "ready":
      return "Sẵn sàng";
    case "running":
      return "Đang chạy";
    case "completed":
      return "Đã hoàn tất";
    case "cancelled":
      return "Đã hủy";
    case "errored":
      return "Có lỗi";
    case "interrupted":
      return "Đã gián đoạn";
  }
}

export function formatConversationMeta(summary: ConversationSummary): string {
  const rel = formatRelativeTime(summary.updatedAt);
  if (summary.status === "ready" && summary.messageCount > 0) return rel;
  return `${statusLabel(summary.status)} · ${rel}`;
}

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export function needsContinuation(record: ConversationRecord | null): boolean {
  if (record === null) return false;
  if (record.runtimeSessionId === null) return record.messages.length > 0;
  return TERMINAL_STATUSES.includes(record.status);
}

export function createConversationManager(
  getClient: () => ServiceClient | null,
): ConversationManager {
  const state: ConversationManagerState = {
    summaries: [],
    activeConversationId: null,
    activeRecord: null,
    runtimeSessionId: null,
    runtimePhase: "idle",
    searchQuery: "",
    loading: false,
    listError: null,
    continuationAvailable: false,
  };

  async function client(): Promise<ServiceClient> {
    const c = getClient();
    if (c === null) throw new Error("Service chưa sẵn sàng.");
    return c;
  }

  async function syncRecord(record: ConversationRecord): Promise<void> {
    state.activeRecord = record;
    state.activeConversationId = record.id;
    state.runtimeSessionId = record.runtimeSessionId;
    state.continuationAvailable = needsContinuation(record);
    const summary: ConversationSummary = {
      id: record.id,
      title: record.title,
      workspacePath: record.workspacePath,
      runtimeSessionId: record.runtimeSessionId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      messageCount: record.messageCount,
      ...(record.providerId !== undefined ? { providerId: record.providerId } : {}),
      ...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
      ...(record.parentId !== undefined ? { parentId: record.parentId } : {}),
    };
    const idx = state.summaries.findIndex((s) => s.id === record.id);
    if (idx >= 0) {
      const next = [...state.summaries];
      next[idx] = summary;
      state.summaries = next.sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
    }
  }

  return {
    state,

    async refreshList() {
      state.loading = true;
      state.listError = null;
      try {
        const list = await (await client()).listConversations(
          state.searchQuery.length > 0 ? state.searchQuery : undefined,
        );
        state.summaries = list;
      } catch (error) {
        state.listError = error instanceof Error ? error.message : "Không tải được danh sách.";
        state.summaries = [];
      } finally {
        state.loading = false;
      }
    },

    async setSearch(query) {
      state.searchQuery = query;
      await this.refreshList();
    },

    async createNew(workspacePath, providerId, modelId, providerSnapshot) {
      const input: CreateConversationInput = {
        workspacePath,
        ...(providerId !== undefined ? { providerId } : {}),
        ...(modelId !== undefined ? { modelId } : {}),
        ...(providerSnapshot !== undefined ? { providerSnapshot } : {}),
      };
      const record = await (await client()).createConversation(input);
      await this.refreshList();
      await syncRecord(record);
      state.runtimePhase = "idle";
      state.continuationAvailable = false;
      return record;
    },

    async select(id) {
      try {
        const record = await (await client()).getConversation(id);
        await syncRecord(record);
        state.runtimePhase =
          record.status === "running"
            ? "running"
            : record.status === "completed"
              ? "completed"
              : record.status === "cancelled"
                ? "cancelled"
                : record.status === "errored" || record.status === "interrupted"
                  ? "failed"
                  : "idle";
        await (await client()).patchConversation(id, { lastActive: true });
      } catch {
        state.listError = "Không mở được phiên này.";
        await this.refreshList();
      }
    },

    async rename(id, title) {
      const record = await (await client()).patchConversation(id, { title });
      await syncRecord(record);
      await this.refreshList();
    },

    async deleteConversation(id) {
      await (await client()).deleteConversation(id);
      if (state.activeConversationId === id) {
        state.activeConversationId = null;
        state.activeRecord = null;
        state.runtimeSessionId = null;
        state.runtimePhase = "idle";
        state.continuationAvailable = false;
      }
      await this.refreshList();
    },

    async startContinuation() {
      if (state.activeConversationId === null) throw new Error("Chưa chọn cuộc trò chuyện.");
      const patched = await (await client()).patchConversation(state.activeConversationId, {
        runtimeSessionId: null,
        status: "draft",
      });
      await syncRecord(patched);
      state.runtimeSessionId = null;
      state.runtimePhase = "idle";
      state.continuationAvailable = false;
      return state.activeConversationId;
    },

    async linkRuntimeSession(runtimeSessionId, startedAt) {
      if (state.activeConversationId === null) return;
      const at = startedAt ?? new Date().toISOString();
      const record = await (await client()).patchConversation(state.activeConversationId, {
        runtimeSessionId,
        status: "ready",
        registerRuntimeTurn: {
          runtimeSessionId,
          startedAt: at,
          status: "running",
        },
      });
      await syncRecord(record);
    },

    async completeRuntimeTurn(runtimeSessionId, status) {
      if (state.activeConversationId === null) return;
      const record = await (await client()).patchConversation(state.activeConversationId, {
        completeRuntimeTurn: {
          runtimeSessionId,
          status,
          completedAt: new Date().toISOString(),
        },
      });
      await syncRecord(record);
    },

    async markLastActive() {
      if (state.activeConversationId === null) return;
      await (await client()).patchConversation(state.activeConversationId, { lastActive: true });
    },

    async recordUserMessage(text, attachments, skills) {
      if (state.activeConversationId === null) return;
      const record = await (await client()).appendConversationMessage(
        state.activeConversationId,
        "user",
        text,
        attachments,
        skills,
      );
      await syncRecord(record);
      await (await client()).patchConversation(state.activeConversationId, { status: "running" });
      state.runtimePhase = "running";
    },

    async recordAssistantMessage(text) {
      if (state.activeConversationId === null || text.trim().length === 0) return;
      const record = await (await client()).appendConversationMessage(
        state.activeConversationId,
        "assistant",
        text,
      );
      await syncRecord(record);
    },

    async setRuntimePhase(phase) {
      state.runtimePhase = phase;
      if (state.activeConversationId === null) return;
      const status = runtimePhaseToStatus(phase);
      if (status === null) return;
      try {
        const record = await (await client()).patchConversation(state.activeConversationId, {
          status,
        });
        await syncRecord(record);
        await this.refreshList();
      } catch {
        // best effort
      }
    },

    async markInterrupted() {
      if (state.activeConversationId === null) return;
      const record = await (await client()).patchConversation(state.activeConversationId, {
        status: "interrupted",
      });
      await syncRecord(record);
      state.continuationAvailable = true;
    },

    shouldApplyStreamView(sessionId) {
      return state.runtimeSessionId === sessionId;
    },

    mapTerminalToStatus(terminal) {
      if (terminal === null) return null;
      if (terminal === "completed") return "completed";
      if (terminal === "cancelled") return "cancelled";
      return "errored";
    },
  };
}

function runtimePhaseToStatus(phase: RuntimePhase): ConversationStatus | null {
  switch (phase) {
    case "running":
    case "starting":
    case "cancelling":
      return "running";
    case "completed":
    case "completed_without_final_message":
      return "completed";
    case "cancelled":
    case "denied":
      return "cancelled";
    case "failed":
      return "errored";
    default:
      return null;
  }
}
