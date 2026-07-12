/**
 * Conversation list + persistence controller (session management slice).
 *
 * Owns Cowork conversation identity separate from the OpenCode runtime session id.
 * The UI calls this module; it talks to the loopback conversation + session routes only.
 */
const TERMINAL_STATUSES = [
    "completed",
    "cancelled",
    "errored",
    "interrupted",
];
function statusLabel(status) {
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
export function formatConversationMeta(summary) {
    const rel = formatRelativeTime(summary.updatedAt);
    if (summary.status === "ready" && summary.messageCount > 0)
        return rel;
    return `${statusLabel(summary.status)} · ${rel}`;
}
function formatRelativeTime(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then))
        return "";
    const diffMs = Date.now() - then;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1)
        return "vừa xong";
    if (mins < 60)
        return `${mins} phút trước`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    if (days < 7)
        return `${days} ngày trước`;
    return new Date(iso).toLocaleDateString("vi-VN");
}
export function needsContinuation(record) {
    if (record === null)
        return false;
    if (record.runtimeSessionId === null)
        return record.messages.length > 0;
    return TERMINAL_STATUSES.includes(record.status);
}
export function createConversationManager(getClient) {
    const state = {
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
    async function client() {
        const c = getClient();
        if (c === null)
            throw new Error("Service chưa sẵn sàng.");
        return c;
    }
    async function syncRecord(record) {
        state.activeRecord = record;
        state.activeConversationId = record.id;
        state.runtimeSessionId = record.runtimeSessionId;
        state.continuationAvailable = needsContinuation(record);
        const summary = {
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
            state.summaries = next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        }
    }
    return {
        state,
        async refreshList() {
            state.loading = true;
            state.listError = null;
            try {
                const list = await (await client()).listConversations(state.searchQuery.length > 0 ? state.searchQuery : undefined);
                state.summaries = list;
            }
            catch (error) {
                state.listError = error instanceof Error ? error.message : "Không tải được danh sách.";
                state.summaries = [];
            }
            finally {
                state.loading = false;
            }
        },
        async setSearch(query) {
            state.searchQuery = query;
            await this.refreshList();
        },
        async createNew(workspacePath, providerId, modelId) {
            const record = await (await client()).createConversation({
                workspacePath,
                ...(providerId !== undefined ? { providerId } : {}),
                ...(modelId !== undefined ? { modelId } : {}),
            });
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
            }
            catch {
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
            if (state.activeConversationId === null)
                throw new Error("Chưa chọn cuộc trò chuyện.");
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
        async linkRuntimeSession(runtimeSessionId) {
            if (state.activeConversationId === null)
                return;
            const record = await (await client()).patchConversation(state.activeConversationId, {
                runtimeSessionId,
                status: "ready",
            });
            await syncRecord(record);
        },
        async recordUserMessage(text) {
            if (state.activeConversationId === null)
                return;
            const record = await (await client()).appendConversationMessage(state.activeConversationId, "user", text);
            await syncRecord(record);
            await (await client()).patchConversation(state.activeConversationId, { status: "running" });
            state.runtimePhase = "running";
        },
        async recordAssistantMessage(text) {
            if (state.activeConversationId === null || text.trim().length === 0)
                return;
            const record = await (await client()).appendConversationMessage(state.activeConversationId, "assistant", text);
            await syncRecord(record);
        },
        async setRuntimePhase(phase) {
            state.runtimePhase = phase;
            if (state.activeConversationId === null)
                return;
            const status = runtimePhaseToStatus(phase);
            if (status === null)
                return;
            try {
                const record = await (await client()).patchConversation(state.activeConversationId, {
                    status,
                });
                await syncRecord(record);
                await this.refreshList();
            }
            catch {
                // best effort
            }
        },
        async markInterrupted() {
            if (state.activeConversationId === null)
                return;
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
            if (terminal === null)
                return null;
            if (terminal === "completed")
                return "completed";
            if (terminal === "cancelled")
                return "cancelled";
            return "errored";
        },
    };
}
function runtimePhaseToStatus(phase) {
    switch (phase) {
        case "running":
        case "starting":
        case "cancelling":
            return "running";
        case "completed":
            return "completed";
        case "cancelled":
            return "cancelled";
        case "failed":
            return "errored";
        default:
            return null;
    }
}
//# sourceMappingURL=conversation-controller.js.map