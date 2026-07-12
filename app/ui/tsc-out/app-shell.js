/**
 * HuyTT12-inspired Cowork GHC application shell.
 *
 * Presentation + view-model only. Talks to the shell bridge and loopback service client.
 */
import { initialSessionView, sanitizeErrorMessage } from "@cowork-ghc/service/execution";
import { buildActivitySnapshot, markRunningAsCancelled, mergeEvEvents, snapshotFromSessionView, toRelativePath, } from "./activity-model.js";
import { createActivityPanel, permissionEntryFromDecision, persistedToSnapshot, renderActivityPanel, showFilePreview, showFileReview, snapshotToPersisted, } from "./activity-panel.js";
import { getShellBridge } from "./bridge.js";
import { createConversationManager, formatConversationMeta, needsContinuation, } from "./conversation-controller.js";
import { createReadinessController } from "./readiness-controller.js";
import { assessSendPreflight, buildReadinessInput, localServiceStatus, providerStatus, shouldShowContinuationBanner, } from "./provider-readiness.js";
import { closeModalWithFocus, createModalKeyHandler, openModalWithFocus, } from "./modal-focus.js";
import { startEvStream } from "./ev-stream-client.js";
import { mountLlmSettingsPanel } from "./llm-settings-panel.js";
import { createPermissionController } from "./permission-controller.js";
import { createServiceClient, ServiceClientError, } from "./service-client.js";
import { mountSettingsView } from "./settings-view.js";
import { mountWorkspacePicker } from "./workspace-picker.js";
import { mountSkillsPanel } from "./skills-panel.js";
import { planRuntimeTurn } from "./runtime-turn-planner.js";
import { planDispatchPrompt } from "./attachment-context.js";
import { SECRET_ATTACHMENT_MESSAGE } from "./attachment-secret-policy.js";
import { sanitizeAssistantForDisplay } from "./assistant-output.js";
import { createPendingAttachmentId, totalValidBytes, } from "./attachment-pending.js";
import { resolveFinalAssistantText, runtimePhaseForCompleted, shouldPollSessionView, STREAM_POLL_INTERVAL_MS, STREAM_STALL_AFTER_ACTIVITY_MS, STREAM_WATCHDOG_MS, mapTerminalToRuntimePhase, } from "./session-finalization.js";
const DEFAULT_TITLE = "Cuộc trò chuyện mới";
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function shortPath(path) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2)
        return path;
    return `.../${parts.slice(-2).join("/")}`;
}
function phaseLabel(phase) {
    switch (phase) {
        case "idle":
            return "Chưa bắt đầu";
        case "starting":
            return "Đang khởi động";
        case "ready":
            return "Phiên đã sẵn sàng";
        case "running":
            return "Đang xử lý";
        case "cancelling":
            return "Đang hủy";
        case "completed":
            return "Đã hoàn tất";
        case "completed_without_final_message":
            return "Đã hoàn tất (không có phản hồi cuối)";
        case "denied":
            return "Đã bị từ chối";
        case "cancelled":
            return "Đã hủy";
        case "failed":
            return "Có lỗi xảy ra";
    }
}
function safeError(error) {
    if (error instanceof ServiceClientError)
        return sanitizeErrorMessage(error.message);
    if (error instanceof Error)
        return sanitizeErrorMessage(error.message);
    return "Có lỗi xảy ra.";
}
function renderComposerPreflight(dom, preflight, hasPrompt) {
    const show = hasPrompt &&
        !preflight.canSend &&
        preflight.showSettingsCta &&
        preflight.message.length > 0;
    dom.composerPreflight.hidden = !show;
    if (!show)
        return;
    dom.composerPreflightMessage.textContent = preflight.message;
    dom.composerPreflightCta.hidden = !preflight.showSettingsCta;
}
function createDynamicClient(state) {
    return new Proxy({}, {
        get(_target, prop) {
            const client = state.client;
            if (client === null) {
                return () => Promise.reject(new Error("Service chưa sẵn sàng."));
            }
            const value = client[prop];
            return typeof value === "function" ? value.bind(client) : value;
        },
    });
}
function textFromComposer(input) {
    return (input.textContent ?? "").trim();
}
function setComposerText(input, text) {
    input.textContent = text;
}
function saveComposerDraft(state, dom) {
    const id = state.conv.state.activeConversationId;
    if (id === null)
        return;
    const text = textFromComposer(dom.composerInput);
    if (text.length > 0)
        state.composerDrafts.set(id, text);
    else
        state.composerDrafts.delete(id);
}
function restoreComposerDraft(state, dom, conversationId) {
    const draft = conversationId === null ? "" : (state.composerDrafts.get(conversationId) ?? "");
    setComposerText(dom.composerInput, draft);
}
function appendMessage(dom, role, text = "", historical = false, attachments, skills) {
    dom.emptyState.hidden = true;
    const row = el("div", `msg msg--${role}${historical ? " msg--historical" : ""}`);
    if (role === "assistant")
        row.append(el("div", "msg__avatar", "AI"));
    const body = el("div", "msg__body");
    body.append(el("div", "msg__name", role === "user" ? "Bạn" : "Cowork GHC"));
    const textBox = el("div", "msg__text");
    const p = document.createElement("p");
    p.textContent = text;
    textBox.append(p);
    if (attachments !== undefined && attachments.length > 0) {
        textBox.append(renderAttachmentMetaList(attachments));
    }
    if (skills !== undefined && skills.length > 0) {
        const skillWrap = el("div", "msg__skills");
        for (const skill of skills) {
            const chip = el("span", "skill-use-chip", `Skill: ${skill.name} · v${skill.version}`);
            chip.title = `${skill.source} · ${skill.contentHash}`;
            skillWrap.append(chip);
        }
        textBox.append(skillWrap);
    }
    body.append(textBox);
    row.append(body);
    dom.transcriptInner.insertBefore(row, dom.thinking);
    dom.transcriptInner.parentElement?.scrollTo({ top: dom.transcriptInner.scrollHeight });
    return row;
}
function renderAttachmentMetaList(attachments) {
    const wrap = el("div", "msg__attachments");
    for (const att of attachments) {
        const chip = el("span", "attachment-chip attachment-chip--historical");
        chip.title = att.relativePath;
        const status = att.inclusionStatus ?? "included";
        const statusNote = status === "included"
            ? att.truncated
                ? " (đã cắt)"
                : ""
            : status === "omitted_by_budget"
                ? " (không gửi — vượt ngân sách)"
                : status === "rejected"
                    ? " (bị từ chối)"
                    : "";
        chip.textContent = `📎 ${att.filename}${statusNote}`;
        wrap.append(chip);
    }
    return wrap;
}
function renderPendingAttachmentChips(dom, pending, onRemove) {
    dom.attachmentChips.replaceChildren();
    if (pending.length === 0) {
        dom.attachmentChips.hidden = true;
        return;
    }
    dom.attachmentChips.hidden = false;
    for (const item of pending) {
        const chip = el("span", `attachment-chip${item.status === "error" ? " attachment-chip--error" : ""}`);
        chip.title = item.relativePath;
        const trunc = item.metadata?.truncated === true ? " (đã cắt)" : "";
        chip.append(el("span", "attachment-chip__label", item.status === "error" ? `⚠ ${item.filename}` : `📎 ${item.filename}${trunc}`));
        const remove = el("button", "attachment-chip__remove", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", `Gỡ ${item.filename}`);
        remove.addEventListener("click", () => onRemove(item.id));
        chip.append(remove);
        if (item.status === "error" && item.errorMessage !== undefined) {
            chip.title = item.errorMessage;
        }
        dom.attachmentChips.append(chip);
    }
}
function isComposerLocked(state) {
    const record = state.conv.state.activeRecord;
    const phase = state.conv.state.runtimePhase;
    if (phase === "running" || phase === "starting" || phase === "cancelling")
        return false;
    if (!needsContinuation(record))
        return false;
    return !state.continuationUnlocked;
}
function clearTranscript(dom) {
    for (const child of [...dom.transcriptInner.children]) {
        if (child !== dom.emptyState && child !== dom.thinking)
            child.remove();
    }
    dom.emptyState.hidden = false;
}
function renderTranscriptFromRecord(dom, record) {
    clearTranscript(dom);
    if (record === null || record.messages.length === 0)
        return;
    dom.emptyState.hidden = true;
    for (const message of record.messages) {
        appendMessage(dom, message.role, message.text, true, message.attachments, message.skills);
    }
}
function renderSessionList(dom, state, onSelect, onRename, onDelete) {
    dom.sessionList.replaceChildren();
    const { summaries, loading, listError, activeConversationId, searchQuery } = state.conv.state;
    if (loading) {
        dom.sessionList.append(el("p", "sidebar__empty", "Đang tải…"));
        return;
    }
    if (listError !== null) {
        dom.sessionList.append(el("p", "sidebar__empty", listError));
        return;
    }
    if (summaries.length === 0) {
        dom.sessionList.append(el("p", "sidebar__empty", searchQuery.length > 0 ? "Không tìm thấy cuộc trò chuyện." : "Chưa có cuộc trò chuyện."));
        return;
    }
    for (const summary of summaries) {
        const item = el("button", "history-item");
        if (summary.id === activeConversationId)
            item.classList.add("history-item--active");
        item.type = "button";
        item.append(el("span", "history-item__title", summary.title));
        item.append(el("span", "history-item__meta", formatConversationMeta(summary)));
        item.addEventListener("click", () => onSelect(summary.id));
        item.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            const action = window.prompt("Đổi tên (nhập tiêu đề mới) hoặc gõ DELETE để xóa:", summary.title);
            if (action === null)
                return;
            if (action.trim().toUpperCase() === "DELETE") {
                onDelete(summary.id);
                return;
            }
            const trimmed = action.trim();
            if (trimmed.length > 0 && trimmed !== summary.title)
                onRename(summary.id, trimmed);
        });
        dom.sessionList.append(item);
    }
}
function mapPermissionToOperation(kind) {
    switch (kind) {
        case "file_create":
            return "create";
        case "file_edit":
            return "edit";
        case "file_delete":
            return "delete";
        case "file_move":
            return "move";
        default:
            return undefined;
    }
}
async function capturePermissionBeforeSnapshot(state, request) {
    if (state.client === null)
        return;
    const kind = request.action.kind;
    if (kind !== "file_create" &&
        kind !== "file_edit" &&
        kind !== "file_delete" &&
        kind !== "file_move") {
        return;
    }
    const targetPath = request.action.targetPath;
    if (targetPath === undefined)
        return;
    const relativePath = toRelativePath(targetPath, state.activeWorkspace);
    try {
        const before = await state.client.captureFileReviewSnapshot(relativePath);
        const op = mapPermissionToOperation(kind);
        state.pendingBeforeSnapshots.set(request.requestId, {
            relativePath,
            before,
            ...(op !== undefined ? { operation: op } : {}),
        });
    }
    catch {
        // best effort
    }
}
async function finalizeFileMutationReview(state, event, sessionId, dom) {
    if (state.client === null)
        return;
    const relativePath = toRelativePath(event.path, state.activeWorkspace);
    let pendingEntry;
    for (const [requestId, entry] of state.pendingBeforeSnapshots) {
        if (entry.relativePath === relativePath) {
            pendingEntry = entry;
            state.pendingBeforeSnapshots.delete(requestId);
            break;
        }
    }
    const permissionEntry = [...state.permissionHistory]
        .reverse()
        .find((p) => p.targetSummary === relativePath || p.targetSummary.endsWith(relativePath));
    const permissionDecision = permissionEntry?.decision === "allowed_once" ||
        permissionEntry?.decision === "allowed_always" ||
        permissionEntry?.decision === "denied" ||
        permissionEntry?.decision === "timeout"
        ? permissionEntry.decision
        : undefined;
    if (permissionDecision === "denied")
        return;
    try {
        let after;
        for (let attempt = 0; attempt < 6; attempt += 1) {
            after = await state.client.captureFileReviewSnapshot(relativePath);
            if (after.exists && (after.kind !== "text" || after.content !== undefined || after.contentRedacted)) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (after === undefined)
            return;
        const review = await state.client.buildFileReview({
            id: `review-${event.seq}`,
            relativePath,
            at: event.at,
            seq: event.seq,
            source: "runtime_tool",
            operation: event.operation,
            runtimeTurnId: sessionId,
            ...(permissionDecision !== undefined ? { permissionDecision } : {}),
            ...(pendingEntry?.before !== undefined ? { before: pendingEntry.before } : {}),
            after,
        });
        state.fileReviews = [...state.fileReviews, review];
        refreshActivityUi(state, dom);
        void persistActivity(state);
    }
    catch {
        // best effort
    }
}
function permissionActionLabel(kind) {
    switch (kind) {
        case "file_create":
            return "Tạo tệp";
        case "file_edit":
            return "Sửa tệp";
        case "file_delete":
            return "Xóa tệp";
        case "file_move":
            return "Di chuyển tệp";
        case "command_exec":
            return "Chạy lệnh";
        default:
            return "Yêu cầu quyền";
    }
}
function rebuildActivitySnapshot(state) {
    const base = state.evEvents.length > 0
        ? buildActivitySnapshot(state.evEvents, state.activeWorkspace, state.permissionHistory, !state.activityLive, state.fileReviews)
        : state.lastView.sessionId.length > 0 && state.activityLive
            ? snapshotFromSessionView(state.lastView, state.activeWorkspace, state.permissionHistory, false, state.fileReviews)
            : buildActivitySnapshot([], state.activeWorkspace, state.permissionHistory, !state.activityLive, state.fileReviews);
    const attachmentPaths = state.activitySnapshot?.attachmentContextPaths ?? base.attachmentContextPaths;
    return { ...base, attachmentContextPaths: attachmentPaths };
}
function refreshActivityUi(state, dom) {
    state.activitySnapshot = rebuildActivitySnapshot(state);
    renderActivityPanel(dom.activityPanel, state.activitySnapshot);
}
async function persistActivity(state) {
    const id = state.conv.state.activeConversationId;
    if (state.client === null || id === null || state.activitySnapshot === null)
        return;
    try {
        await state.client.patchConversation(id, {
            activity: snapshotToPersisted(state.activitySnapshot),
        });
    }
    catch {
        // best effort
    }
}
function loadActivityFromRecord(state, record) {
    state.evEvents = [];
    state.permissionHistory = [];
    state.activityLive = false;
    state.fileReviews = [];
    state.pendingBeforeSnapshots = new Map();
    const persisted = persistedToSnapshot(record?.activity);
    if (persisted !== null) {
        state.activitySnapshot = persisted;
        state.permissionHistory = [...persisted.permissionHistory];
        state.fileReviews = [...persisted.fileReviews];
        return;
    }
    state.activitySnapshot = null;
}
function resetLiveActivity(state) {
    state.evEvents = [];
    state.permissionHistory = [];
    state.activityLive = true;
    state.activitySnapshot = null;
    state.fileReviews = [];
    state.pendingBeforeSnapshots = new Map();
}
function renderState(dom, state, handlers) {
    const phase = state.conv.state.runtimePhase;
    const record = state.conv.state.activeRecord;
    dom.workspaceLabel.textContent = state.activeWorkspace === null ? "Chưa chọn workspace" : shortPath(state.activeWorkspace);
    dom.workspaceLabel.title = state.activeWorkspace ?? "";
    const providerCopy = providerStatus(state.settings, state.connectionTestState);
    dom.providerStatus.textContent = providerCopy.label;
    dom.providerStatus.title = providerCopy.detail;
    dom.providerStatus.classList.toggle("is-ok", providerCopy.ok);
    dom.executionStatus.textContent = phaseLabel(phase);
    dom.chatTitle.textContent = record?.title ?? DEFAULT_TITLE;
    dom.chatSub.textContent =
        record?.status === "interrupted"
            ? "Phiên trước đã gián đoạn — mở lại lịch sử hoặc tạo phiên tiếp nối."
            : "Cowork GHC sử dụng workspace và provider đã cấu hình.";
    const showContinuation = shouldShowContinuationBanner(state.conv.state.activeConversationId, record, phase);
    if (showContinuation) {
        if (!dom.continuationBanner.isConnected) {
            dom.chat.insertBefore(dom.continuationBanner, dom.transcript);
        }
        dom.continuationBanner.hidden = false;
        dom.continuationButton.hidden = false;
    }
    else if (dom.continuationBanner.isConnected) {
        dom.continuationBanner.remove();
    }
    const locked = isComposerLocked(state);
    const readinessInput = buildReadinessInput(state.localServiceReady, state);
    const sendPreflight = assessSendPreflight(readinessInput);
    const composerText = textFromComposer(dom.composerInput);
    renderComposerPreflight(dom, sendPreflight, composerText.length > 0);
    dom.composer.classList.toggle("is-running", phase === "running" || phase === "cancelling");
    dom.composer.classList.toggle("is-locked", locked);
    dom.composerInput.contentEditable = locked ? "false" : "true";
    dom.attachButton.disabled =
        locked ||
            phase === "starting" ||
            phase === "running" ||
            phase === "cancelling" ||
            state.activeWorkspace === null;
    dom.thinking.hidden = phase !== "running" && phase !== "starting" && phase !== "cancelling";
    dom.sendButton.disabled =
        locked ||
            phase === "starting" ||
            phase === "running" ||
            phase === "cancelling" ||
            composerText.length === 0;
    dom.cancelButton.hidden = phase !== "running" && phase !== "cancelling";
    dom.cancelButton.disabled = phase !== "running";
    dom.newConversationButton.disabled =
        phase === "starting" || phase === "running" || state.activeWorkspace === null;
    renderSessionList(dom, state, handlers.onSelect, handlers.onRename, handlers.onDelete);
    renderPendingAttachmentChips(dom, state.pendingAttachments, (id) => {
        state.pendingAttachments = state.pendingAttachments.filter((a) => a.id !== id);
        renderState(dom, state, handlers);
    });
    refreshActivityUi(state, dom);
}
async function refreshSettings(state, dom, handlers) {
    if (state.client === null)
        return;
    try {
        state.settings = await state.client.getSettings();
        state.activeWorkspace = state.settings.activeWorkspace?.rootPath ?? null;
    }
    catch {
        state.settings = null;
    }
    renderState(dom, state, handlers);
}
async function awaitLiveClient(state, readiness) {
    readiness.retry();
    for (let i = 0; i < 120; i += 1) {
        if (state.client !== null) {
            try {
                await state.client.health();
                return state.client;
            }
            catch {
                // Service may still be restarting into live mode.
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Không kết nối lại được local service.");
}
function updateAssistantBubble(state, text) {
    const assistant = state.activeAssistant?.querySelector(".msg__text p") ?? null;
    if (assistant !== null)
        assistant.textContent = text;
}
function stopStreamWatchdog(state) {
    if (state.streamWatchdog !== null) {
        clearInterval(state.streamWatchdog);
        state.streamWatchdog = null;
    }
}
function touchStreamActivity(state) {
    state.lastStreamActivityAt = Date.now();
}
function startStreamWatchdog(state, dom, sessionId, handlers) {
    stopStreamWatchdog(state);
    touchStreamActivity(state);
    state.streamWatchdog = setInterval(() => {
        if (state.conv.state.runtimePhase !== "running" && state.conv.state.runtimePhase !== "cancelling") {
            stopStreamWatchdog(state);
            return;
        }
        const idleFor = Date.now() - state.lastStreamActivityAt;
        if (idleFor < STREAM_STALL_AFTER_ACTIVITY_MS)
            return;
        if (idleFor > STREAM_WATCHDOG_MS) {
            stopStreamWatchdog(state);
            void (async () => {
                await state.conv.setRuntimePhase("failed");
                const msg = "Phiên không phản hồi sau thời gian chờ.";
                updateAssistantBubble(state, msg);
                await state.conv.recordAssistantMessage(msg);
                renderState(dom, state, handlers);
            })();
            return;
        }
        if (state.client === null || state.finalizingTurn)
            return;
        void (async () => {
            try {
                const refreshed = await state.client.getRuntimeSession(sessionId);
                if (refreshed.view.terminal !== null) {
                    stopStreamWatchdog(state);
                    await finalizeConversationTurn(state, dom, refreshed.view, handlers, sessionId);
                }
            }
            catch {
                // best effort poll
            }
        })();
    }, STREAM_POLL_INTERVAL_MS);
}
async function finalizeConversationTurn(state, dom, view, handlers, sessionId) {
    if (view.terminal === null || state.finalizingTurn)
        return;
    const terminal = view.terminal;
    state.finalizingTurn = true;
    stopStreamWatchdog(state);
    let fetchedText = null;
    if (shouldPollSessionView(view) && state.client !== null) {
        try {
            const refreshed = await state.client.getRuntimeSession(sessionId);
            if (refreshed.view.text.trim().length > 0)
                fetchedText = refreshed.view.text.trim();
            if (refreshed.view.text.trim().length > view.text.trim().length) {
                view = { ...view, text: refreshed.view.text };
            }
        }
        catch {
            // best effort
        }
    }
    let resolved;
    if (view.terminal === "completed") {
        resolved = resolveFinalAssistantText(view.text, fetchedText);
    }
    else if (terminal === "denied") {
        const text = view.text.trim().length > 0 ? view.text.trim() : "Yêu cầu đã bị từ chối.";
        resolved = { text, outcome: "denied" };
    }
    else if (terminal === "cancelled") {
        const text = view.text.trim().length > 0 ? view.text.trim() : "Phiên đã bị hủy.";
        resolved = { text, outcome: "cancelled" };
    }
    else {
        const text = view.error?.message?.trim() ??
            view.text.trim() ??
            "Có lỗi xảy ra trong phiên.";
        resolved = { text, outcome: "failed" };
    }
    state.lastView = view;
    state.assistantText = resolved.text;
    const displayText = sanitizeAssistantForDisplay(resolved.text);
    updateAssistantBubble(state, displayText);
    state.activityLive = false;
    const phase = terminal === "completed"
        ? runtimePhaseForCompleted(resolved, terminal)
        : mapTerminalToRuntimePhase(terminal);
    await state.conv.setRuntimePhase(phase);
    await state.conv.recordAssistantMessage(sanitizeAssistantForDisplay(resolved.text));
    const turnStatus = terminal === "completed"
        ? "completed"
        : terminal === "cancelled" || terminal === "denied"
            ? "cancelled"
            : "errored";
    await state.conv.completeRuntimeTurn(sessionId, turnStatus);
    await persistActivity(state);
    state.finalizingTurn = false;
    state.continuationUnlocked = true;
    renderState(dom, state, handlers);
}
function stopStream(state) {
    stopStreamWatchdog(state);
    state.stream?.stop();
    state.stream = null;
    state.streamSessionId = null;
}
function bindEvStream(state, dom, handlers, sessionId) {
    const bootstrap = state.bootstrap;
    if (bootstrap?.serviceBaseUrl === undefined || bootstrap.clientToken === undefined)
        return;
    stopStream(state);
    state.streamSessionId = sessionId;
    state.stream = startEvStream({
        baseUrl: bootstrap.serviceBaseUrl,
        clientToken: bootstrap.clientToken,
        sessionId,
        onEvent: (event) => {
            if (!state.conv.shouldApplyStreamView(sessionId))
                return;
            touchStreamActivity(state);
            state.evEvents = [...mergeEvEvents(state.evEvents, [event])];
            refreshActivityUi(state, dom);
            if (event.kind === "file_mutation") {
                void finalizeFileMutationReview(state, event, sessionId, dom);
            }
        },
        onView: (view) => {
            if (!state.conv.shouldApplyStreamView(sessionId))
                return;
            touchStreamActivity(state);
            state.lastView = view;
            state.assistantText = view.text;
            updateAssistantBubble(state, sanitizeAssistantForDisplay(view.text));
            refreshActivityUi(state, dom);
            if (view.terminal !== null) {
                void finalizeConversationTurn(state, dom, view, handlers, sessionId);
                return;
            }
            renderState(dom, state, handlers);
        },
        onError: (message) => {
            if (!state.conv.shouldApplyStreamView(sessionId))
                return;
            stopStreamWatchdog(state);
            void state.conv.setRuntimePhase("failed");
            appendMessage(dom, "assistant", message);
            renderState(dom, state, handlers);
        },
    });
    startStreamWatchdog(state, dom, sessionId, handlers);
}
async function ensureLive(state, readiness) {
    await getShellBridge().connectLive();
    const client = await awaitLiveClient(state, readiness);
    const bootstrap = await getShellBridge().getBootstrap();
    if (!bootstrap.serviceBaseUrl || !bootstrap.clientToken)
        throw new Error("Shell chưa cung cấp kết nối live.");
    state.bootstrap = bootstrap;
    return client;
}
async function ensureRuntimeSession(state, dom, readiness, handlers) {
    if (state.client === null)
        throw new Error("Service chưa sẵn sàng.");
    await refreshSettings(state, dom, handlers);
    const preflight = assessSendPreflight(buildReadinessInput(state.localServiceReady, state));
    if (!preflight.canSend) {
        renderComposerPreflight(dom, preflight, true);
        throw new Error(preflight.message);
    }
    if (state.activeWorkspace === null) {
        throw new Error("Chọn workspace trước.");
    }
    const model = state.settings?.defaultModel;
    if (model === null || model === undefined) {
        throw new Error("Cấu hình model chưa hợp lệ.");
    }
    const record = state.conv.state.activeRecord;
    if (record === null)
        throw new Error("Chưa chọn cuộc trò chuyện.");
    const plan = await planRuntimeTurn(state.client, record);
    if (plan.action === "reuse") {
        state.lastView = (await state.client.getRuntimeSession(plan.runtimeSessionId)).view;
        bindEvStream(state, dom, handlers, plan.runtimeSessionId);
        state.conv.state.runtimePhase = "ready";
        return { runtimeSessionId: plan.runtimeSessionId, contextMessages: [] };
    }
    state.conv.state.runtimePhase = "starting";
    renderState(dom, state, handlers);
    const client = await ensureLive(state, readiness);
    if (record.runtimeSessionId !== null) {
        await state.conv.startContinuation();
    }
    const meta = await client.createSession({
        workspaceId: state.activeWorkspace,
        title: record.title,
        model,
    });
    await state.conv.linkRuntimeSession(meta.id);
    state.lastView = initialSessionView(meta.id);
    state.conv.state.runtimePhase = "ready";
    bindEvStream(state, dom, handlers, meta.id);
    renderState(dom, state, handlers);
    return { runtimeSessionId: meta.id, contextMessages: plan.priorMessages };
}
async function switchConversation(state, dom, handlers, id) {
    const currentId = state.conv.state.activeConversationId;
    if (currentId === id)
        return;
    const unsent = textFromComposer(dom.composerInput);
    if (unsent.length > 0 && currentId !== null) {
        const ok = window.confirm("Bỏ nội dung chưa gửi và chuyển cuộc trò chuyện?");
        if (!ok)
            return;
    }
    saveComposerDraft(state, dom);
    state.pendingAttachments = [];
    stopStream(state);
    state.activeAssistant = null;
    state.assistantText = "";
    state.lastView = initialSessionView("");
    await state.conv.select(id);
    state.continuationUnlocked = !needsContinuation(state.conv.state.activeRecord);
    loadActivityFromRecord(state, state.conv.state.activeRecord);
    renderTranscriptFromRecord(dom, state.conv.state.activeRecord);
    restoreComposerDraft(state, dom, id);
    renderState(dom, state, handlers);
    dom.composerInput.focus();
}
async function newConversation(state, dom, handlers) {
    if (state.client === null)
        throw new Error("Service chưa sẵn sàng.");
    await refreshSettings(state, dom, handlers);
    if (state.activeWorkspace === null)
        throw new Error("Chọn workspace trước.");
    const unsent = textFromComposer(dom.composerInput);
    if (unsent.length > 0 && state.conv.state.activeConversationId !== null) {
        const ok = window.confirm("Bỏ nội dung chưa gửi và tạo cuộc trò chuyện mới?");
        if (!ok)
            return;
    }
    saveComposerDraft(state, dom);
    stopStream(state);
    state.activeAssistant = null;
    state.assistantText = "";
    state.lastView = initialSessionView("");
    const model = state.settings?.defaultModel;
    await state.conv.createNew(state.activeWorkspace, model?.providerID, model?.modelID);
    clearTranscript(dom);
    setComposerText(dom.composerInput, "");
    resetLiveActivity(state);
    renderState(dom, state, handlers);
    dom.composerInput.focus();
}
async function readAttachmentSnapshots(state, pending) {
    if (state.client === null || state.activeWorkspace === null) {
        return { snapshots: [], errors: ["Service chưa sẵn sàng."] };
    }
    const valid = pending.filter((p) => p.status === "valid");
    const snapshots = [];
    const errors = [];
    let priorBytes = 0;
    for (const item of valid) {
        const winPath = state.activeWorkspace.endsWith("\\") || state.activeWorkspace.endsWith("/")
            ? `${state.activeWorkspace}${item.relativePath.replace(/\//g, "\\")}`
            : `${state.activeWorkspace}\\${item.relativePath.replace(/\//g, "\\")}`;
        const result = await state.client.readWorkspaceAttachment(winPath, priorBytes);
        if (!result.ok) {
            errors.push(`${item.filename}: ${result.message}`);
            continue;
        }
        snapshots.push({ metadata: result.metadata, content: result.content });
        priorBytes += result.content.length;
    }
    return { snapshots, errors };
}
async function pickAttachment(state, dom, handlers) {
    if (state.activeWorkspace === null) {
        window.alert("Chọn workspace trước khi đính kèm tệp.");
        return;
    }
    if (state.client === null)
        return;
    const picked = await getShellBridge().pickWorkspaceFile(state.activeWorkspace);
    if (picked.canceled || picked.filePath === undefined)
        return;
    const priorBytes = totalValidBytes(state.pendingAttachments);
    const result = await state.client.readWorkspaceAttachment(picked.filePath, priorBytes);
    if (!result.ok) {
        const isSecret = result.reason === "secret_file";
        state.pendingAttachments = [
            ...state.pendingAttachments,
            {
                id: createPendingAttachmentId(),
                relativePath: picked.filePath,
                filename: picked.filePath.split(/[\\/]/).pop() ?? picked.filePath,
                status: "error",
                errorMessage: isSecret ? SECRET_ATTACHMENT_MESSAGE : result.message,
            },
        ];
        renderState(dom, state, handlers);
        return;
    }
    state.pendingAttachments = [
        ...state.pendingAttachments,
        {
            id: createPendingAttachmentId(),
            relativePath: result.metadata.relativePath,
            filename: result.metadata.filename,
            status: "valid",
            metadata: result.metadata,
        },
    ];
    renderState(dom, state, handlers);
}
function recordAttachmentActivity(state, included, rejected) {
    const base = state.activitySnapshot ?? {
        items: [],
        fileChanges: [],
        fileReviews: state.fileReviews,
        permissionHistory: state.permissionHistory,
        runtimeReadPaths: [],
        attachmentContextPaths: [],
        readPaths: [],
        terminalState: null,
    };
    const items = [...base.items];
    let seq = items.length > 0 ? Math.max(...items.map((i) => i.seq)) + 1 : 1;
    const at = new Date().toISOString();
    for (const att of included) {
        items.push({
            id: `att-${seq}`,
            kind: "file",
            label: att.truncated
                ? `Đã đưa tệp vào ngữ cảnh (đã cắt): ${att.filename}`
                : `Đã đưa tệp vào ngữ cảnh: ${att.filename}`,
            status: "success",
            at,
            seq,
            relativePath: att.relativePath,
            fileEventKind: "attachment_context",
            source: "user_attachment",
            detail: `${att.sizeBytes} byte`,
        });
        seq += 1;
    }
    for (const rej of rejected) {
        items.push({
            id: `att-err-${seq}`,
            kind: "error",
            label: `Tệp đính kèm bị từ chối: ${rej.filename}`,
            status: "failed",
            at,
            seq,
            detail: rej.reason,
        });
        seq += 1;
    }
    const attachmentContextPaths = [
        ...new Set([...base.attachmentContextPaths, ...included.map((m) => m.relativePath)]),
    ];
    state.activitySnapshot = { ...base, items, attachmentContextPaths };
    state.activityLive = true;
}
async function sendPrompt(state, dom, readiness, handlers) {
    const prompt = textFromComposer(dom.composerInput);
    if (prompt.length === 0)
        return;
    if (isComposerLocked(state))
        return;
    const preflight = assessSendPreflight(buildReadinessInput(state.localServiceReady, state));
    if (!preflight.canSend) {
        renderComposerPreflight(dom, preflight, true);
        renderState(dom, state, handlers);
        return;
    }
    const pendingSnapshot = [...state.pendingAttachments];
    const { snapshots, errors } = await readAttachmentSnapshots(state, pendingSnapshot);
    if (errors.length > 0) {
        window.alert(errors.join("\n"));
        return;
    }
    if (state.client === null)
        return;
    const enabledSkills = await state.client.enabledSkillSnapshots();
    const priorMessages = state.conv.state.activeRecord?.messages ?? [];
    const dispatchPlan = planDispatchPrompt(priorMessages, snapshots, prompt, undefined, enabledSkills);
    if (!dispatchPlan.ok) {
        window.alert(dispatchPlan.message);
        return;
    }
    if (state.conv.state.activeConversationId === null) {
        await newConversation(state, dom, handlers);
    }
    if (state.client === null || state.conv.state.activeConversationId === null)
        return;
    const { runtimeSessionId } = await ensureRuntimeSession(state, dom, readiness, handlers);
    resetLiveActivity(state);
    const includedMetadata = dispatchPlan.includedMetadata;
    appendMessage(dom, "user", prompt, false, includedMetadata.length > 0 ? includedMetadata : undefined, dispatchPlan.skillMetadata.length > 0 ? dispatchPlan.skillMetadata : undefined);
    state.activeAssistant = appendMessage(dom, "assistant", "");
    const pendingCleared = state.pendingAttachments;
    setComposerText(dom.composerInput, "");
    state.pendingAttachments = [];
    state.composerDrafts.delete(state.conv.state.activeConversationId);
    await state.conv.recordUserMessage(prompt, includedMetadata.length > 0 ? includedMetadata : undefined, dispatchPlan.skillMetadata.length > 0 ? dispatchPlan.skillMetadata : undefined);
    await state.conv.markLastActive();
    state.conv.state.runtimePhase = "running";
    state.continuationUnlocked = true;
    recordAttachmentActivity(state, includedMetadata, []);
    renderState(dom, state, handlers);
    const dispatchText = dispatchPlan.text;
    const result = await state.client.sendSessionMessage(runtimeSessionId, dispatchText);
    if (!result.accepted) {
        state.pendingAttachments = pendingCleared;
        if (result.reason === "session_completed") {
            await state.conv.startContinuation();
            const retry = await ensureRuntimeSession(state, dom, readiness, handlers);
            const retryPlan = planDispatchPrompt(retry.contextMessages, snapshots, prompt, undefined, enabledSkills);
            if (!retryPlan.ok) {
                await state.conv.setRuntimePhase("failed");
                appendMessage(dom, "assistant", retryPlan.message);
                renderState(dom, state, handlers);
                return;
            }
            const second = await state.client.sendSessionMessage(retry.runtimeSessionId, retryPlan.text);
            if (!second.accepted) {
                await state.conv.setRuntimePhase("failed");
                appendMessage(dom, "assistant", "Không gửi được yêu cầu sau khi tạo phiên tiếp nối.");
            }
        }
        else {
            await state.conv.setRuntimePhase("failed");
            appendMessage(dom, "assistant", result.reason === "runtime_not_attached" ? "Runtime chưa sẵn sàng." : "Không gửi được yêu cầu.");
        }
        renderState(dom, state, handlers);
        return;
    }
    refreshActivityUi(state, dom);
}
async function cancelRun(state, dom, handlers) {
    const runtimeId = state.conv.state.runtimeSessionId;
    if (state.client === null || runtimeId === null || state.conv.state.runtimePhase !== "running")
        return;
    state.conv.state.runtimePhase = "cancelling";
    renderState(dom, state, handlers);
    await Promise.race([
        state.client.cancelSession(runtimeId).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 8_000)),
    ]);
    stopStream(state);
    state.activityLive = false;
    if (state.activitySnapshot !== null) {
        state.activitySnapshot = markRunningAsCancelled(state.activitySnapshot);
    }
    await state.conv.setRuntimePhase("cancelled");
    await persistActivity(state);
    state.lastView = { ...state.lastView, status: "cancelled", terminal: "cancelled" };
    renderState(dom, state, handlers);
}
function createShell(root) {
    root.className = "app-shell";
    root.replaceChildren();
    const topbar = el("header", "topbar");
    topbar.append(el("div", "topbar__brand", "Cowork GHC"));
    const serviceStatus = el("span", "topbar__status", "Local service: Đang khởi động");
    const providerStatus = el("button", "topbar__gateway topbar__provider-status", "Provider: Chưa cấu hình");
    providerStatus.type = "button";
    const modelLabel = providerStatus;
    const settingsButton = el("button", "icon-btn", "Cài đặt");
    settingsButton.type = "button";
    settingsButton.setAttribute("aria-label", "Mở cài đặt");
    topbar.append(el("div", "topbar__spacer"), serviceStatus, providerStatus, settingsButton);
    const workspace = el("main", "workspace");
    const sidebar = el("aside", "sidebar");
    const nav = el("nav", "sidebar-tabs");
    const coworkTab = el("button", "sidebar-tab sidebar-tab--active", "Cowork");
    coworkTab.type = "button";
    coworkTab.setAttribute("aria-selected", "true");
    const skillsTab = el("button", "sidebar-tab", "Skills");
    skillsTab.type = "button";
    skillsTab.setAttribute("aria-selected", "false");
    nav.append(coworkTab, skillsTab);
    const newConversationButton = el("button", "sidebar__new-btn", "Cuộc trò chuyện mới");
    newConversationButton.type = "button";
    const workspaceBox = el("section", "workspace-slot");
    const workspaceLabel = el("p", "workspace-context", "Chưa chọn workspace");
    const sessionSearch = el("input", "sidebar__search");
    sessionSearch.type = "search";
    sessionSearch.placeholder = "Tìm cuộc trò chuyện…";
    sessionSearch.setAttribute("aria-label", "Tìm cuộc trò chuyện");
    const sessionList = el("div", "sidebar__history");
    const coworkSidebarPanel = el("div", "sidebar__cowork-panel");
    coworkSidebarPanel.append(newConversationButton, workspaceLabel, workspaceBox, sessionSearch, el("h2", "sidebar__heading", "Phiên"), sessionList);
    const skillsPanel = el("section", "skills-panel");
    skillsPanel.hidden = true;
    sidebar.append(nav, coworkSidebarPanel, skillsPanel);
    const chat = el("section", "chat-area");
    const header = el("div", "chat-header");
    const headerInfo = el("div", "chat-header__info");
    const chatTitle = el("div", "chat-header__title", DEFAULT_TITLE);
    const chatSub = el("div", "chat-header__sub", "Cowork GHC sử dụng workspace và provider đã cấu hình.");
    headerInfo.append(chatTitle, chatSub);
    const headerActions = el("div", "chat-header__actions");
    const skillsButton = el("button", "label-btn skills-open", "Skills: 0 bật");
    skillsButton.type = "button";
    const activityMobileToggle = el("button", "label-btn activity-mobile-toggle", "Hoạt động");
    activityMobileToggle.type = "button";
    activityMobileToggle.setAttribute("aria-label", "Mở bảng hoạt động");
    activityMobileToggle.setAttribute("aria-expanded", "false");
    headerActions.append(activityMobileToggle, skillsButton);
    header.append(el("div", "chat-header__icon", "AI"), headerInfo, headerActions);
    const continuationBanner = el("div", "continuation-banner");
    continuationBanner.hidden = true;
    continuationBanner.append(el("span", "continuation-banner__text", "Đây là lịch sử đã lưu — không phải phiên runtime đang chạy."));
    const continuationButton = el("button", "label-btn", "Tiếp tục cuộc trò chuyện này");
    continuationButton.type = "button";
    continuationBanner.append(continuationButton);
    const transcript = el("div", "transcript");
    const transcriptInner = el("div", "transcript__inner");
    const emptyState = el("div", "empty-state");
    emptyState.append(el("h2", "empty-state__title", "Bắt đầu làm việc với Cowork GHC"));
    emptyState.append(el("p", "empty-state__copy", "Chọn workspace, cấu hình provider/model, rồi tạo cuộc trò chuyện mới hoặc gửi yêu cầu."));
    const thinking = el("div", "thinking");
    thinking.hidden = true;
    thinking.append(el("span", "thinking__dots", "..."), el("span", "thinking__label", "Đang xử lý"));
    transcriptInner.append(emptyState, thinking);
    transcript.append(transcriptInner);
    const composer = el("div", "composer");
    const composerBox = el("div", "composer__box");
    const composerInput = el("div", "composer__input");
    composerInput.contentEditable = "true";
    composerInput.setAttribute("role", "textbox");
    composerInput.setAttribute("aria-multiline", "true");
    composerInput.setAttribute("aria-label", "Nhập yêu cầu");
    composerInput.setAttribute("data-placeholder", "Nhập yêu cầu cho Cowork GHC...");
    const composerBar = el("div", "composer__bar");
    const attachButton = el("button", "icon-btn attach-btn", "+");
    attachButton.type = "button";
    attachButton.title = "Đính kèm tệp văn bản trong workspace";
    attachButton.setAttribute("aria-label", "Đính kèm");
    const attachLabel = el("span", "model-picker attach-label", "Đính kèm");
    const cancelButton = el("button", "stop-btn", "Dừng");
    cancelButton.type = "button";
    cancelButton.hidden = true;
    const sendButton = el("button", "send-btn", "Gửi");
    sendButton.type = "button";
    const attachmentChips = el("div", "composer__attachments");
    attachmentChips.hidden = true;
    composerBar.append(attachButton, attachLabel, el("div", "composer__spacer"), cancelButton, sendButton);
    const composerPreflight = el("div", "composer-preflight");
    composerPreflight.hidden = true;
    composerPreflight.setAttribute("role", "status");
    const composerPreflightMessage = el("p", "composer-preflight__message");
    const composerPreflightCta = el("button", "label-btn composer-preflight__cta", "Mở cài đặt provider");
    composerPreflightCta.type = "button";
    composerPreflight.append(composerPreflightMessage, composerPreflightCta);
    const composerHint = el("div", "composer__hint", "Enter để gửi, Shift+Enter xuống dòng");
    composerBox.append(composerInput, attachmentChips, composerPreflight, composerBar);
    composer.append(composerBox, composerHint);
    chat.append(header, transcript, composer);
    const rightPanel = el("aside", "right-panel");
    const rpHeader = el("div", "rp-header");
    rpHeader.append(el("span", "rp-header__title", "Hoạt động"));
    const executionStatus = el("p", "execution-status", "Chưa bắt đầu");
    const planCard = el("section", "plan-card");
    planCard.append(el("div", "plan-card__hd", "Kế hoạch"));
    const planSteps = el("div", "plan-card__steps");
    planCard.append(planSteps);
    const outputSection = el("section", "file-section");
    outputSection.append(el("div", "file-section__label", "Tệp đầu ra"));
    const outputFiles = el("div", "output-files");
    outputSection.append(outputFiles);
    const inputSection = el("section", "file-section");
    inputSection.append(el("div", "file-section__label", "Tệp đã đọc"));
    const inputFiles = el("div", "input-files");
    inputSection.append(inputFiles);
    const permissionSummary = el("p", "permission-summary", "Quyền: chưa có yêu cầu.");
    rightPanel.append(rpHeader, executionStatus, planCard, outputSection, inputSection, permissionSummary);
    workspace.append(sidebar, chat, rightPanel);
    const statusbar = el("footer", "statusbar");
    const serviceDetail = el("span", "statusbar__left", "Đang khởi động");
    statusbar.append(serviceDetail, el("span", "statusbar__right", "OpenCode chỉ chạy khi bạn gửi yêu cầu."));
    const settingsModal = el("div", "modal");
    settingsModal.hidden = true;
    settingsModal.setAttribute("role", "dialog");
    settingsModal.setAttribute("aria-modal", "true");
    settingsModal.setAttribute("aria-label", "Cài đặt");
    settingsModal.setAttribute("aria-hidden", "true");
    const settingsPanel = el("div", "modal__panel");
    const settingsHeader = el("div", "modal__header");
    const modalTitle = el("h2", "modal__title", "Cài đặt");
    modalTitle.tabIndex = -1;
    settingsHeader.append(modalTitle);
    const closeSettings = el("button", "icon-btn", "Đóng");
    closeSettings.type = "button";
    settingsHeader.append(closeSettings);
    const settingsBody = el("div", "modal__body");
    settingsPanel.append(settingsHeader, settingsBody);
    settingsModal.append(settingsPanel);
    let settingsOpener = null;
    const modalKeyHandler = createModalKeyHandler({
        panel: settingsPanel,
        closeButton: closeSettings,
        onClose: () => {
            closeModalWithFocus(settingsModal, settingsOpener, modalKeyHandler);
            settingsOpener = null;
        },
    });
    root.append(topbar, workspace, statusbar, settingsModal);
    const domPartial = {
        root,
        serviceStatus,
        providerStatus,
        serviceDetail,
        workspaceLabel,
        modelLabel,
        sessionSearch,
        sessionList,
        chatTitle,
        chatSub,
        chat,
        transcript,
        continuationBanner,
        continuationButton,
        transcriptInner,
        emptyState,
        thinking,
        composer,
        composerInput,
        composerHint,
        composerPreflight,
        composerPreflightMessage,
        composerPreflightCta,
        attachButton,
        attachmentChips,
        sendButton,
        cancelButton,
        newConversationButton,
        settingsModal,
        settingsPanel,
        settingsBody,
        settingsButton,
        closeSettingsButton: closeSettings,
        settingsOpener: null,
        modalKeyHandler,
        activityPanel: createActivityPanel(rightPanel),
        executionStatus,
        permissionSummary,
        sidebar,
        rightPanel,
        activityMobileToggle,
        coworkTab,
        skillsTab,
        coworkSidebarPanel,
        skillsPanel,
        skillsButton,
    };
    const openSettings = () => {
        settingsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : settingsButton;
        const initial = settingsBody.querySelector(".llm-provider-select") ??
            settingsBody.querySelector(".llm-settings-title") ??
            closeSettings;
        openModalWithFocus(settingsModal, initial, modalKeyHandler);
    };
    settingsButton.addEventListener("click", openSettings);
    providerStatus.addEventListener("click", openSettings);
    composerPreflightCta.addEventListener("click", openSettings);
    closeSettings.addEventListener("click", () => {
        closeModalWithFocus(settingsModal, settingsOpener, modalKeyHandler);
        settingsOpener = null;
    });
    activityMobileToggle.addEventListener("click", () => {
        const open = workspace.classList.toggle("activity-drawer-open");
        activityMobileToggle.setAttribute("aria-expanded", open ? "true" : "false");
        activityMobileToggle.textContent = open ? "Ẩn hoạt động" : "Hoạt động";
        domPartial.activityPanel.toggle.setAttribute("aria-label", open ? "Thu gọn bảng hoạt động" : "Mở rộng bảng hoạt động");
    });
    const showSkills = (show) => {
        coworkSidebarPanel.hidden = show;
        skillsPanel.hidden = !show;
        coworkTab.classList.toggle("sidebar-tab--active", !show);
        skillsTab.classList.toggle("sidebar-tab--active", show);
        coworkTab.setAttribute("aria-selected", show ? "false" : "true");
        skillsTab.setAttribute("aria-selected", show ? "true" : "false");
    };
    coworkTab.addEventListener("click", () => showSkills(false));
    skillsTab.addEventListener("click", () => showSkills(true));
    skillsButton.addEventListener("click", () => showSkills(true));
    return domPartial;
}
export function mountCoworkApp(root) {
    const dom = createShell(root);
    const state = {
        client: null,
        bootstrap: null,
        settings: null,
        activeWorkspace: null,
        conv: createConversationManager(() => state.client),
        stream: null,
        streamSessionId: null,
        lastView: initialSessionView(""),
        assistantText: "",
        activeAssistant: null,
        composerDrafts: new Map(),
        evEvents: [],
        permissionHistory: [],
        activitySnapshot: null,
        activityLive: false,
        fileReviews: [],
        pendingBeforeSnapshots: new Map(),
        streamWatchdog: null,
        lastStreamActivityAt: 0,
        finalizingTurn: false,
        pendingAttachments: [],
        continuationUnlocked: true,
        localServiceReady: false,
        connectionTestState: "unknown",
    };
    const handlers = {
        onSelect: (id) => {
            void switchConversation(state, dom, handlers, id).catch((error) => {
                appendMessage(dom, "assistant", safeError(error));
                renderState(dom, state, handlers);
            });
        },
        onRename: (id, title) => {
            void state.conv.rename(id, title).then(() => renderState(dom, state, handlers));
        },
        onDelete: (id) => {
            if (!window.confirm("Xóa cuộc trò chuyện này? Workspace và khoá provider không bị xóa."))
                return;
            const wasActive = state.conv.state.activeConversationId === id;
            void (async () => {
                if (wasActive && state.conv.state.runtimePhase === "running" && state.conv.state.runtimeSessionId !== null) {
                    await state.client?.cancelSession(state.conv.state.runtimeSessionId).catch(() => undefined);
                    stopStream(state);
                }
                await state.conv.deleteConversation(id);
                if (wasActive) {
                    clearTranscript(dom);
                    setComposerText(dom.composerInput, "");
                }
                renderState(dom, state, handlers);
            })();
        },
    };
    let featuresMounted = false;
    let conversationRestored = false;
    let searchTimer = null;
    const dynamicClient = createDynamicClient(state);
    const readiness = createReadinessController({
        getBootstrap: () => getShellBridge().getBootstrap(),
        createClient: (baseUrl, clientToken) => {
            state.bootstrap = { serviceBaseUrl: baseUrl, clientToken };
            state.client = createServiceClient(baseUrl, clientToken);
            return state.client;
        },
        onState: (readinessState) => {
            const copy = localServiceStatus(readinessState);
            dom.serviceStatus.textContent = copy.label;
            dom.serviceStatus.classList.toggle("is-ok", copy.ok);
            dom.serviceDetail.textContent = copy.detail;
            state.localServiceReady = readinessState.phase === "ready";
            if (readinessState.phase === "ready" && state.client !== null) {
                void refreshSettings(state, dom, handlers);
                void state.conv.refreshList().then(async () => {
                    if (!conversationRestored && state.conv.state.activeConversationId === null) {
                        const lastId = await state.client.getLastActiveConversationId();
                        const pick = lastId ?? state.conv.state.summaries[0]?.id ?? null;
                        if (pick !== null) {
                            await state.conv.select(pick);
                            state.continuationUnlocked = !needsContinuation(state.conv.state.activeRecord);
                            loadActivityFromRecord(state, state.conv.state.activeRecord);
                            renderTranscriptFromRecord(dom, state.conv.state.activeRecord);
                            restoreComposerDraft(state, dom, pick);
                        }
                        conversationRestored = true;
                    }
                    renderState(dom, state, handlers);
                });
                if (!featuresMounted) {
                    featuresMounted = true;
                    mountWorkspacePicker(dom.sidebar.querySelector(".workspace-slot"), {
                        bridge: getShellBridge(),
                        client: dynamicClient,
                        onActivated: (rootPath) => {
                            state.activeWorkspace = rootPath;
                            void refreshSettings(state, dom, handlers);
                            renderState(dom, state, handlers);
                        },
                        onDeactivated: () => {
                            state.activeWorkspace = null;
                            renderState(dom, state, handlers);
                        },
                    });
                    mountLlmSettingsPanel(dom.settingsBody, {
                        client: dynamicClient,
                        getBootstrap: () => getShellBridge().getBootstrap(),
                        onSettingsUpdated: (view) => {
                            state.settings = view;
                            state.activeWorkspace = view.activeWorkspace?.rootPath ?? state.activeWorkspace;
                            renderState(dom, state, handlers);
                        },
                        onConnectionTestResult: (ok) => {
                            state.connectionTestState = ok ? "ok" : "failed";
                            renderState(dom, state, handlers);
                        },
                    });
                    mountSettingsView(dom.settingsBody, { client: dynamicClient });
                    mountSkillsPanel(dom.skillsPanel, dynamicClient, (skills) => {
                        const enabled = skills.filter((skill) => skill.status === "enabled").length;
                        dom.skillsButton.textContent = `Skills: ${enabled} bật`;
                        dom.skillsButton.setAttribute("aria-label", `Mở Skills, ${enabled} đang bật`);
                    });
                    const permissions = createPermissionController({
                        client: dynamicClient,
                        container: dom.root,
                        onPending: (request) => {
                            void capturePermissionBeforeSnapshot(state, request);
                            const target = request.action.targetPath !== undefined
                                ? toRelativePath(request.action.targetPath, state.activeWorkspace)
                                : request.action.description;
                            const entry = permissionEntryFromDecision({
                                requestId: request.requestId,
                                actionLabel: permissionActionLabel(request.action.kind),
                                targetSummary: target,
                                decision: "pending",
                                at: request.requestedAt,
                            });
                            if (!state.permissionHistory.some((p) => p.requestId === request.requestId)) {
                                state.permissionHistory = [...state.permissionHistory, entry];
                                refreshActivityUi(state, dom);
                            }
                        },
                        onDecision: ({ request, outcome, requestedDecision }) => {
                            const target = request.action.targetPath !== undefined
                                ? toRelativePath(request.action.targetPath, state.activeWorkspace)
                                : request.action.description;
                            const decision = outcome.status !== "resolved"
                                ? "denied"
                                : requestedDecision === "deny"
                                    ? "denied"
                                    : outcome.scope === "always"
                                        ? "allowed_always"
                                        : "allowed_once";
                            const entry = permissionEntryFromDecision({
                                requestId: request.requestId,
                                actionLabel: permissionActionLabel(request.action.kind),
                                targetSummary: target,
                                decision,
                                at: request.requestedAt,
                            });
                            state.permissionHistory = [
                                ...state.permissionHistory.filter((p) => p.requestId !== request.requestId),
                                entry,
                            ];
                            refreshActivityUi(state, dom);
                            void persistActivity(state);
                        },
                    });
                    permissions.start();
                    dom.activityPanel.outputFiles.addEventListener("click", (event) => {
                        const target = event.target;
                        const row = target.closest(".file-row--clickable");
                        if (row === null || state.client === null)
                            return;
                        const relativePath = row.dataset["relativePath"];
                        const operation = row.dataset["operation"];
                        if (relativePath === undefined || operation === undefined)
                            return;
                        const change = state.activitySnapshot?.fileChanges.find((c) => c.relativePath === relativePath && c.operation === operation);
                        if (change === undefined)
                            return;
                        const reviewId = row.dataset["reviewId"];
                        const review = reviewId !== undefined
                            ? state.activitySnapshot?.fileReviews.find((r) => r.id === reviewId) ??
                                state.fileReviews.find((r) => r.id === reviewId)
                            : state.fileReviews.find((r) => r.relativePath === relativePath && r.operation === operation);
                        if (review !== undefined) {
                            showFileReview(dom.activityPanel, review);
                            return;
                        }
                        void showFilePreview(dom.activityPanel, state.client, change);
                    });
                }
            }
        },
    });
    dom.newConversationButton.addEventListener("click", () => {
        void newConversation(state, dom, handlers).catch((error) => {
            appendMessage(dom, "assistant", safeError(error));
            renderState(dom, state, handlers);
        });
    });
    dom.continuationButton.addEventListener("click", () => {
        void (async () => {
            await state.conv.startContinuation();
            state.continuationUnlocked = true;
            if (dom.continuationBanner.isConnected) {
                dom.continuationBanner.remove();
            }
            dom.composerInput.focus();
            renderState(dom, state, handlers);
        })();
    });
    dom.attachButton.addEventListener("click", () => {
        void pickAttachment(state, dom, handlers).catch((error) => {
            window.alert(safeError(error));
            renderState(dom, state, handlers);
        });
    });
    dom.sessionSearch.addEventListener("input", () => {
        if (searchTimer !== null)
            clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            void state.conv.setSearch(dom.sessionSearch.value).then(() => renderState(dom, state, handlers));
        }, 200);
    });
    dom.sendButton.addEventListener("click", () => {
        void sendPrompt(state, dom, readiness, handlers).catch((error) => {
            const preflight = assessSendPreflight(buildReadinessInput(state.localServiceReady, state));
            if (!preflight.canSend) {
                renderComposerPreflight(dom, preflight, true);
                renderState(dom, state, handlers);
                return;
            }
            void state.conv.setRuntimePhase("failed");
            appendMessage(dom, "assistant", safeError(error));
            renderState(dom, state, handlers);
        });
    });
    dom.cancelButton.addEventListener("click", () => {
        void cancelRun(state, dom, handlers).catch((error) => {
            void state.conv.setRuntimePhase("failed");
            appendMessage(dom, "assistant", safeError(error));
            renderState(dom, state, handlers);
        });
    });
    dom.composerInput.addEventListener("input", () => renderState(dom, state, handlers));
    dom.composerInput.addEventListener("keydown", (event) => {
        if (!(event instanceof KeyboardEvent))
            return;
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            dom.sendButton.click();
        }
    });
    dom.chatTitle.addEventListener("dblclick", () => {
        const id = state.conv.state.activeConversationId;
        if (id === null)
            return;
        const next = window.prompt("Đổi tên cuộc trò chuyện:", state.conv.state.activeRecord?.title ?? "");
        if (next === null)
            return;
        const trimmed = next.trim();
        if (trimmed.length === 0)
            return;
        handlers.onRename(id, trimmed);
    });
    renderState(dom, state, handlers);
    readiness.start();
}
//# sourceMappingURL=app-shell.js.map