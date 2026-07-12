/**
 * Activity timeline model — folds real EV events into a session-scoped, Vietnamese UI timeline.
 *
 * Uses only observed {@link EvEvent} kinds from the CGHC-012 contract. Model token deltas are
 * excluded from activity (they are chat output, not tool events).
 */
const SECRET_PATTERN = /(?:api[_-]?key|secret|token|password|authorization|bearer\s+\S+)/gi;
export function toRelativePath(absoluteOrRelative, workspaceRoot) {
    if (workspaceRoot === null || workspaceRoot.length === 0) {
        return shortenPath(absoluteOrRelative);
    }
    const normRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
    const normPath = absoluteOrRelative.replace(/\\/g, "/").toLowerCase();
    if (normPath.startsWith(`${normRoot}/`)) {
        return absoluteOrRelative
            .slice(workspaceRoot.length)
            .replace(/^[/\\]+/u, "")
            .replace(/\\/g, "/");
    }
    return shortenPath(absoluteOrRelative);
}
function shortenPath(path) {
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length <= 2)
        return path;
    return `.../${parts.slice(-2).join("/")}`;
}
export function redactCommandText(text) {
    const collapsed = text.replace(SECRET_PATTERN, "[redacted]").replace(/\s+/gu, " ").trim();
    if (collapsed.length <= 120)
        return collapsed;
    return `${collapsed.slice(0, 119)}…`;
}
function mapStepStatus(status) {
    switch (status) {
        case "pending":
            return "pending";
        case "running":
            return "running";
        case "completed":
            return "success";
        case "cancelled":
            return "cancelled";
        case "errored":
            return "failed";
    }
}
function mapTerminalStatus(state) {
    switch (state) {
        case "completed":
            return "success";
        case "cancelled":
            return "cancelled";
        case "denied":
            return "denied";
        case "errored":
            return "failed";
    }
}
function terminalLabel(state) {
    switch (state) {
        case "completed":
            return "Đã hoàn thành";
        case "cancelled":
            return "Đã hủy";
        case "denied":
            return "Đã bị từ chối";
        case "errored":
            return "Có lỗi xảy ra";
    }
}
function toolActionLabel(toolName) {
    switch (toolName) {
        case "write":
            return "Đang tạo/cập nhật tệp";
        case "edit":
        case "patch":
        case "multiedit":
            return "Đang cập nhật tệp";
        case "read":
            return "Đang đọc tệp";
        case "list":
        case "glob":
        case "grep":
            return "Đang liệt kê/đọc tệp";
        case "bash":
        case "shell":
            return "Đang chạy lệnh";
        default:
            return `Đang dùng công cụ: ${toolName}`;
    }
}
function fileOpLabel(op) {
    switch (op) {
        case "create":
            return "Đã tạo tệp";
        case "edit":
            return "Đã sửa tệp";
        case "delete":
            return "Đã xóa tệp";
        case "move":
            return "Đã di chuyển tệp";
    }
}
function isReadTool(toolName) {
    return toolName === "read" || toolName === "list" || toolName === "glob" || toolName === "grep";
}
/** Merge events in seq order; ignore duplicates (`seq <= lastSeq`). */
export function mergeEvEvents(existing, incoming) {
    const bySeq = new Map();
    for (const event of existing)
        bySeq.set(event.seq, event);
    let maxSeq = existing.reduce((m, e) => Math.max(m, e.seq), 0);
    for (const event of incoming) {
        if (event.seq <= maxSeq && bySeq.has(event.seq))
            continue;
        if (event.seq > maxSeq)
            maxSeq = event.seq;
        bySeq.set(event.seq, event);
    }
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
export function buildActivitySnapshot(events, workspaceRoot, permissionHistory, historical = false) {
    const items = [];
    const fileChanges = [];
    const readPaths = new Set();
    const toolIndex = new Map();
    let terminalState = null;
    for (const event of events) {
        switch (event.kind) {
            case "token":
                break;
            case "plan":
                items.push({
                    id: `plan-${event.seq}`,
                    kind: "plan",
                    label: "Kế hoạch công việc",
                    status: "running",
                    at: event.at,
                    seq: event.seq,
                    detail: event.todos.map((t) => t.title).join(" · "),
                    historical,
                });
                break;
            case "step": {
                if (event.label === "Step finished")
                    break;
                items.push({
                    id: `step-${event.stepId}-${event.seq}`,
                    kind: "progress",
                    label: "Đang phân tích yêu cầu",
                    status: mapStepStatus(event.status),
                    at: event.at,
                    seq: event.seq,
                    historical,
                });
                break;
            }
            case "tool_call": {
                const rel = event.summary ? toRelativePath(event.summary, workspaceRoot) : undefined;
                const isShell = event.toolName === "bash" || event.toolName === "shell";
                const item = {
                    id: `tool-${event.callId}`,
                    kind: "tool",
                    label: toolActionLabel(event.toolName),
                    status: mapStepStatus(event.status),
                    at: event.at,
                    seq: event.seq,
                    toolName: event.toolName,
                    callId: event.callId,
                    ...(event.summary !== undefined
                        ? { summary: isShell ? redactCommandText(event.summary) : rel ?? event.summary }
                        : {}),
                    ...(rel !== undefined ? { relativePath: rel } : {}),
                    historical,
                };
                const idx = toolIndex.get(event.callId);
                if (idx !== undefined)
                    items[idx] = item;
                else {
                    toolIndex.set(event.callId, items.length);
                    items.push(item);
                }
                if (isReadTool(event.toolName) && rel !== undefined)
                    readPaths.add(rel);
                break;
            }
            case "file_mutation": {
                const rel = toRelativePath(event.path, workspaceRoot);
                items.push({
                    id: `file-${event.seq}`,
                    kind: "file",
                    label: fileOpLabel(event.operation),
                    status: "success",
                    at: event.at,
                    seq: event.seq,
                    relativePath: rel,
                    operation: event.operation,
                    historical,
                });
                fileChanges.push({
                    id: `fc-${event.seq}`,
                    operation: event.operation,
                    relativePath: rel,
                    at: event.at,
                    seq: event.seq,
                    verified: true,
                });
                break;
            }
            case "progress":
                items.push({
                    id: `progress-${event.seq}`,
                    kind: "progress",
                    label: event.label || "Đang xử lý",
                    status: "running",
                    at: event.at,
                    seq: event.seq,
                    historical,
                });
                break;
            case "error":
                items.push({
                    id: `error-${event.seq}`,
                    kind: "error",
                    label: "Có lỗi xảy ra",
                    status: "failed",
                    at: event.at,
                    seq: event.seq,
                    detail: event.message,
                    historical,
                });
                break;
            case "terminal":
                terminalState = event.state;
                items.push({
                    id: `terminal-${event.seq}`,
                    kind: "terminal",
                    label: terminalLabel(event.state),
                    status: mapTerminalStatus(event.state),
                    at: event.at,
                    seq: event.seq,
                    ...(event.message !== undefined ? { detail: event.message } : {}),
                    historical,
                });
                break;
            default:
                break;
        }
    }
    return {
        items,
        fileChanges,
        permissionHistory,
        readPaths: [...readPaths],
        terminalState,
    };
}
/** Rebuild a minimal snapshot from a persisted {@link SessionView} (backward compat). */
export function snapshotFromSessionView(view, workspaceRoot, permissionHistory = [], historical = false) {
    const synthetic = [];
    let seq = 1;
    const bump = () => {
        seq += 1;
        return seq;
    };
    const at = () => new Date(0).toISOString();
    if (view.progress !== undefined) {
        synthetic.push({
            sessionId: view.sessionId,
            seq: bump(),
            at: at(),
            kind: "progress",
            label: view.progress.label,
            ...(view.progress.ratio !== undefined ? { ratio: view.progress.ratio } : {}),
        });
    }
    for (const tool of view.toolCalls) {
        synthetic.push({
            sessionId: view.sessionId,
            seq: bump(),
            at: at(),
            kind: "tool_call",
            callId: tool.callId,
            toolName: tool.toolName,
            status: tool.status,
            ...(tool.summary !== undefined ? { summary: tool.summary } : {}),
        });
    }
    for (const mutation of view.fileMutations) {
        synthetic.push({
            sessionId: view.sessionId,
            seq: bump(),
            at: at(),
            kind: "file_mutation",
            operation: mutation.operation,
            path: mutation.path,
            ...(mutation.previousPath !== undefined ? { previousPath: mutation.previousPath } : {}),
        });
    }
    if (view.error !== null) {
        synthetic.push({
            sessionId: view.sessionId,
            seq: bump(),
            at: at(),
            kind: "error",
            message: view.error.message,
            ...(view.error.recovery !== undefined
                ? { recovery: { kind: "retry", label: view.error.recovery } }
                : {}),
        });
    }
    if (view.terminal !== null) {
        synthetic.push({
            sessionId: view.sessionId,
            seq: bump(),
            at: at(),
            kind: "terminal",
            state: view.terminal,
        });
    }
    return buildActivitySnapshot(synthetic, workspaceRoot, permissionHistory, historical);
}
export function markRunningAsCancelled(snapshot) {
    const items = snapshot.items.map((item) => item.status === "running" || item.status === "pending"
        ? { ...item, status: "cancelled", label: "Đã hủy" }
        : item);
    return { ...snapshot, items, terminalState: "cancelled" };
}
//# sourceMappingURL=activity-model.js.map