/**
 * HuyTT12-inspired Cowork GHC application shell.
 *
 * Presentation + view-model only. Talks to the shell bridge and loopback service client.
 */

import { initialSessionView, sanitizeErrorMessage, type SessionView } from "@cowork-ghc/service/execution";
import type { EvEvent, RendererBootstrap } from "@cowork-ghc/contracts";
import {
  buildActivitySnapshot,
  markRunningAsCancelled,
  mergeEvEvents,
  snapshotFromSessionView,
  toRelativePath,
  type ActivitySnapshot,
  type PermissionHistoryEntry,
} from "./activity-model.js";
import {
  createActivityPanel,
  permissionEntryFromDecision,
  persistedToSnapshot,
  renderActivityPanel,
  showFilePreview,
  snapshotToPersisted,
  type ActivityPanelDom,
} from "./activity-panel.js";
import { getShellBridge } from "./bridge.js";
import {
  createConversationManager,
  formatConversationMeta,
  needsContinuation,
  type ConversationManager,
  type RuntimePhase,
} from "./conversation-controller.js";
import { createReadinessController, type ReadinessState } from "./readiness-controller.js";
import { startEvStream, type EvStreamHandle } from "./ev-stream-client.js";
import { mountLlmSettingsPanel } from "./llm-settings-panel.js";
import { createPermissionController } from "./permission-controller.js";
import {
  createServiceClient,
  ServiceClientError,
  type ConversationRecord,
  type ServiceClient,
  type SettingsView,
} from "./service-client.js";
import { mountSettingsView } from "./settings-view.js";
import { mountWorkspacePicker } from "./workspace-picker.js";

interface AppState {
  client: ServiceClient | null;
  bootstrap: RendererBootstrap | null;
  settings: SettingsView | null;
  activeWorkspace: string | null;
  conv: ConversationManager;
  stream: EvStreamHandle | null;
  streamSessionId: string | null;
  lastView: SessionView;
  assistantText: string;
  activeAssistant: HTMLElement | null;
  composerDrafts: Map<string, string>;
  evEvents: EvEvent[];
  permissionHistory: PermissionHistoryEntry[];
  activitySnapshot: ActivitySnapshot | null;
  activityLive: boolean;
}

interface AppDom {
  root: HTMLElement;
  serviceStatus: HTMLElement;
  serviceDetail: HTMLElement;
  workspaceLabel: HTMLElement;
  modelLabel: HTMLElement;
  sessionSearch: HTMLInputElement;
  sessionList: HTMLElement;
  chatTitle: HTMLElement;
  chatSub: HTMLElement;
  continuationBanner: HTMLElement;
  continuationButton: HTMLButtonElement;
  transcriptInner: HTMLElement;
  emptyState: HTMLElement;
  thinking: HTMLElement;
  composer: HTMLElement;
  composerInput: HTMLElement;
  composerHint: HTMLElement;
  sendButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  newConversationButton: HTMLButtonElement;
  settingsModal: HTMLElement;
  settingsBody: HTMLElement;
  activityPanel: ActivityPanelDom;
  executionStatus: HTMLElement;
  permissionSummary: HTMLElement;
  sidebar: HTMLElement;
  rightPanel: HTMLElement;
}

const DEFAULT_TITLE = "Cuộc trò chuyện mới";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join("/")}`;
}

function modelSummary(settings: SettingsView | null): string {
  if (settings?.defaultModel === null || settings?.defaultModel === undefined) return "Chưa cấu hình model";
  const row = settings.providers.find((p) => p.providerId === settings.defaultModel?.providerID);
  const cred = row?.hasCredential ? "đã có khoá" : "chưa có khoá";
  return `${settings.defaultModel.modelID} (${cred})`;
}

function phaseLabel(phase: RuntimePhase): string {
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
    case "cancelled":
      return "Đã hủy";
    case "failed":
      return "Có lỗi xảy ra";
  }
}

function readinessCopy(state: ReadinessState): { label: string; detail: string; ok: boolean } {
  switch (state.phase) {
    case "starting":
      return { label: "Đang khởi động service", detail: "Đang nhận cấu hình kết nối.", ok: false };
    case "connecting":
      return { label: "Đang kết nối service", detail: `Lần thử ${state.attempt}.`, ok: false };
    case "ready":
      return { label: "Đã kết nối local service", detail: "Cowork GHC core sẵn sàng.", ok: true };
    case "not_connected":
      return { label: "Chưa kết nối", detail: state.detail, ok: false };
    case "unreachable":
      return { label: "Không kết nối được", detail: state.detail, ok: false };
  }
}

function safeError(error: unknown): string {
  if (error instanceof ServiceClientError) return sanitizeErrorMessage(error.message);
  if (error instanceof Error) return sanitizeErrorMessage(error.message);
  return "Có lỗi xảy ra.";
}

function createDynamicClient(state: AppState): ServiceClient {
  return new Proxy({} as ServiceClient, {
    get(_target, prop) {
      const client = state.client;
      if (client === null) {
        return () => Promise.reject(new Error("Service chưa sẵn sàng."));
      }
      const value = client[prop as keyof ServiceClient];
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

function textFromComposer(input: HTMLElement): string {
  return (input.textContent ?? "").trim();
}

function setComposerText(input: HTMLElement, text: string): void {
  input.textContent = text;
}

function saveComposerDraft(state: AppState, dom: AppDom): void {
  const id = state.conv.state.activeConversationId;
  if (id === null) return;
  const text = textFromComposer(dom.composerInput);
  if (text.length > 0) state.composerDrafts.set(id, text);
  else state.composerDrafts.delete(id);
}

function restoreComposerDraft(state: AppState, dom: AppDom, conversationId: string | null): void {
  const draft = conversationId === null ? "" : (state.composerDrafts.get(conversationId) ?? "");
  setComposerText(dom.composerInput, draft);
}

function appendMessage(dom: AppDom, role: "user" | "assistant", text = "", historical = false): HTMLElement {
  dom.emptyState.hidden = true;
  const row = el("div", `msg msg--${role}${historical ? " msg--historical" : ""}`);
  if (role === "assistant") row.append(el("div", "msg__avatar", "AI"));
  const body = el("div", "msg__body");
  body.append(el("div", "msg__name", role === "user" ? "Bạn" : "Cowork GHC"));
  const textBox = el("div", "msg__text");
  const p = document.createElement("p");
  p.textContent = text;
  textBox.append(p);
  body.append(textBox);
  row.append(body);
  dom.transcriptInner.insertBefore(row, dom.thinking);
  dom.transcriptInner.parentElement?.scrollTo({ top: dom.transcriptInner.scrollHeight });
  return row;
}

function clearTranscript(dom: AppDom): void {
  for (const child of [...dom.transcriptInner.children]) {
    if (child !== dom.emptyState && child !== dom.thinking) child.remove();
  }
  dom.emptyState.hidden = false;
}

function renderTranscriptFromRecord(dom: AppDom, record: ConversationRecord | null): void {
  clearTranscript(dom);
  if (record === null || record.messages.length === 0) return;
  dom.emptyState.hidden = true;
  for (const message of record.messages) {
    appendMessage(dom, message.role, message.text, true);
  }
}

function renderSessionList(
  dom: AppDom,
  state: AppState,
  onSelect: (id: string) => void,
  onRename: (id: string, title: string) => void,
  onDelete: (id: string) => void,
): void {
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
    dom.sessionList.append(
      el(
        "p",
        "sidebar__empty",
        searchQuery.length > 0 ? "Không tìm thấy cuộc trò chuyện." : "Chưa có cuộc trò chuyện.",
      ),
    );
    return;
  }

  for (const summary of summaries) {
    const item = el("button", "history-item");
    if (summary.id === activeConversationId) item.classList.add("history-item--active");
    item.type = "button";
    item.append(el("span", "history-item__title", summary.title));
    item.append(el("span", "history-item__meta", formatConversationMeta(summary)));
    item.addEventListener("click", () => onSelect(summary.id));
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const action = window.prompt("Đổi tên (nhập tiêu đề mới) hoặc gõ DELETE để xóa:", summary.title);
      if (action === null) return;
      if (action.trim().toUpperCase() === "DELETE") {
        onDelete(summary.id);
        return;
      }
      const trimmed = action.trim();
      if (trimmed.length > 0 && trimmed !== summary.title) onRename(summary.id, trimmed);
    });
    dom.sessionList.append(item);
  }
}

function permissionActionLabel(kind: string): string {
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

function rebuildActivitySnapshot(state: AppState): ActivitySnapshot {
  if (state.evEvents.length > 0) {
    return buildActivitySnapshot(
      state.evEvents,
      state.activeWorkspace,
      state.permissionHistory,
      !state.activityLive,
    );
  }
  if (state.lastView.sessionId.length > 0 && state.activityLive) {
    return snapshotFromSessionView(
      state.lastView,
      state.activeWorkspace,
      state.permissionHistory,
      false,
    );
  }
  return buildActivitySnapshot([], state.activeWorkspace, state.permissionHistory, !state.activityLive);
}

function refreshActivityUi(state: AppState, dom: AppDom): void {
  state.activitySnapshot = rebuildActivitySnapshot(state);
  renderActivityPanel(dom.activityPanel, state.activitySnapshot);
}

async function persistActivity(state: AppState): Promise<void> {
  const id = state.conv.state.activeConversationId;
  if (state.client === null || id === null || state.activitySnapshot === null) return;
  try {
    await state.client.patchConversation(id, {
      activity: snapshotToPersisted(state.activitySnapshot),
    });
  } catch {
    // best effort
  }
}

function loadActivityFromRecord(state: AppState, record: ConversationRecord | null): void {
  state.evEvents = [];
  state.permissionHistory = [];
  state.activityLive = false;
  const persisted = persistedToSnapshot(
    record?.activity as Record<string, unknown> | undefined,
  );
  if (persisted !== null) {
    state.activitySnapshot = persisted;
    state.permissionHistory = [...persisted.permissionHistory];
    return;
  }
  state.activitySnapshot = null;
}

function resetLiveActivity(state: AppState): void {
  state.evEvents = [];
  state.permissionHistory = [];
  state.activityLive = true;
  state.activitySnapshot = null;
}

function renderState(dom: AppDom, state: AppState, handlers: {
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}): void {
  const phase = state.conv.state.runtimePhase;
  const record = state.conv.state.activeRecord;

  dom.workspaceLabel.textContent = state.activeWorkspace === null ? "Chưa chọn workspace" : shortPath(state.activeWorkspace);
  dom.workspaceLabel.title = state.activeWorkspace ?? "";
  dom.modelLabel.textContent = modelSummary(state.settings);
  dom.executionStatus.textContent = phaseLabel(phase);
  dom.chatTitle.textContent = record?.title ?? DEFAULT_TITLE;
  dom.chatSub.textContent =
    record?.status === "interrupted"
      ? "Phiên trước đã gián đoạn — mở lại lịch sử hoặc tạo phiên tiếp nối."
      : needsContinuation(record)
        ? "Mở lại lịch sử. Gửi tin nhắn mới cần phiên runtime tiếp nối."
        : "Cowork GHC sử dụng workspace và provider đã cấu hình.";

  const showContinuation = needsContinuation(record) && phase !== "running" && phase !== "starting";
  dom.continuationBanner.hidden = !showContinuation;
  dom.continuationButton.hidden = !showContinuation;

  dom.composer.classList.toggle("is-running", phase === "running" || phase === "cancelling");
  dom.thinking.hidden = phase !== "running" && phase !== "starting" && phase !== "cancelling";
  dom.sendButton.disabled =
    phase === "starting" ||
    phase === "running" ||
    phase === "cancelling" ||
    textFromComposer(dom.composerInput).length === 0 ||
    state.activeWorkspace === null;
  dom.cancelButton.hidden = phase !== "running" && phase !== "cancelling";
  dom.cancelButton.disabled = phase !== "running";
  dom.newConversationButton.disabled =
    phase === "starting" || phase === "running" || state.activeWorkspace === null;

  renderSessionList(dom, state, handlers.onSelect, handlers.onRename, handlers.onDelete);
  refreshActivityUi(state, dom);
}

async function refreshSettings(state: AppState, dom: AppDom, handlers: Parameters<typeof renderState>[2]): Promise<void> {
  if (state.client === null) return;
  try {
    state.settings = await state.client.getSettings();
    state.activeWorkspace = state.settings.activeWorkspace?.rootPath ?? null;
  } catch {
    state.settings = null;
  }
  renderState(dom, state, handlers);
}

async function awaitLiveClient(
  state: AppState,
  readiness: ReturnType<typeof createReadinessController>,
): Promise<ServiceClient> {
  readiness.retry();
  for (let i = 0; i < 120; i += 1) {
    if (state.client !== null) {
      try {
        await state.client.health();
        return state.client;
      } catch {
        // Service may still be restarting into live mode.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Không kết nối lại được local service.");
}

function stopStream(state: AppState): void {
  state.stream?.stop();
  state.stream = null;
  state.streamSessionId = null;
}

function bindEvStream(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
  sessionId: string,
): void {
  const bootstrap = state.bootstrap;
  if (bootstrap?.serviceBaseUrl === undefined || bootstrap.clientToken === undefined) return;
  stopStream(state);
  state.streamSessionId = sessionId;
  state.stream = startEvStream({
    baseUrl: bootstrap.serviceBaseUrl,
    clientToken: bootstrap.clientToken,
    sessionId,
    onEvent: (event) => {
      if (!state.conv.shouldApplyStreamView(sessionId)) return;
      state.evEvents = [...mergeEvEvents(state.evEvents, [event])];
      refreshActivityUi(state, dom);
    },
    onView: (view) => {
      if (!state.conv.shouldApplyStreamView(sessionId)) return;
      state.lastView = view;
      state.assistantText = view.text;
      const assistant = state.activeAssistant?.querySelector<HTMLElement>(".msg__text p") ?? null;
      if (assistant !== null) assistant.textContent = view.text;
      if (view.terminal === "completed") void state.conv.setRuntimePhase("completed");
      if (view.terminal === "cancelled") void state.conv.setRuntimePhase("cancelled");
      if (view.terminal === "errored" || view.terminal === "denied") {
        void state.conv.setRuntimePhase("failed");
        if (view.error?.message && view.text.trim().length === 0) {
          appendMessage(dom, "assistant", view.error.message);
        }
      }
      refreshActivityUi(state, dom);
      if (view.terminal !== null) {
        state.activityLive = false;
        void state.conv.recordAssistantMessage(view.text).then(async () => {
          await persistActivity(state);
          renderState(dom, state, handlers);
        });
      }
      renderState(dom, state, handlers);
    },
    onError: (message) => {
      if (!state.conv.shouldApplyStreamView(sessionId)) return;
      void state.conv.setRuntimePhase("failed");
      appendMessage(dom, "assistant", message);
      renderState(dom, state, handlers);
    },
  });
}

async function ensureLive(
  state: AppState,
  readiness: ReturnType<typeof createReadinessController>,
): Promise<ServiceClient> {
  await getShellBridge().connectLive();
  const client = await awaitLiveClient(state, readiness);
  const bootstrap = await getShellBridge().getBootstrap();
  if (!bootstrap.serviceBaseUrl || !bootstrap.clientToken) throw new Error("Shell chưa cung cấp kết nối live.");
  state.bootstrap = bootstrap;
  return client;
}

async function ensureRuntimeSession(
  state: AppState,
  dom: AppDom,
  readiness: ReturnType<typeof createReadinessController>,
  handlers: Parameters<typeof renderState>[2],
): Promise<string> {
  if (state.client === null) throw new Error("Service chưa sẵn sàng.");
  await refreshSettings(state, dom, handlers);
  if (
    state.activeWorkspace === null ||
    state.settings?.defaultModel === null ||
    state.settings?.defaultModel === undefined
  ) {
    throw new Error("Chọn workspace và cấu hình model trước.");
  }

  const record = state.conv.state.activeRecord;
  if (record === null) throw new Error("Chưa chọn cuộc trò chuyện.");

  if (state.conv.state.runtimeSessionId !== null && !needsContinuation(record)) {
    const runtimeId = state.conv.state.runtimeSessionId;
    try {
      const continued = await state.client.continueRuntimeSession(runtimeId);
      if (continued.canPrompt) {
        state.lastView = continued.view;
        bindEvStream(state, dom, handlers, runtimeId);
        state.conv.state.runtimePhase = "ready";
        return runtimeId;
      }
    } catch {
      // Runtime session unavailable — create a new one below.
    }
  }

  state.conv.state.runtimePhase = "starting";
  renderState(dom, state, handlers);
  const client = await ensureLive(state, readiness);

  if (needsContinuation(record)) {
    await state.conv.startContinuation();
  }

  const meta = await client.createSession({
    workspaceId: state.activeWorkspace,
    title: record.title,
    model: state.settings.defaultModel,
  });
  await state.conv.linkRuntimeSession(meta.id);
  state.lastView = initialSessionView(meta.id);
  state.conv.state.runtimePhase = "ready";
  bindEvStream(state, dom, handlers, meta.id);
  renderState(dom, state, handlers);
  return meta.id;
}

async function switchConversation(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
  id: string,
): Promise<void> {
  const currentId = state.conv.state.activeConversationId;
  if (currentId === id) return;
  const unsent = textFromComposer(dom.composerInput);
  if (unsent.length > 0 && currentId !== null) {
    const ok = window.confirm("Bỏ nội dung chưa gửi và chuyển cuộc trò chuyện?");
    if (!ok) return;
  }
  saveComposerDraft(state, dom);
  stopStream(state);
  state.activeAssistant = null;
  state.assistantText = "";
  state.lastView = initialSessionView("");
  await state.conv.select(id);
  loadActivityFromRecord(state, state.conv.state.activeRecord);
  renderTranscriptFromRecord(dom, state.conv.state.activeRecord);
  restoreComposerDraft(state, dom, id);
  renderState(dom, state, handlers);
  dom.composerInput.focus();
}

async function newConversation(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
): Promise<void> {
  if (state.client === null) throw new Error("Service chưa sẵn sàng.");
  await refreshSettings(state, dom, handlers);
  if (state.activeWorkspace === null) throw new Error("Chọn workspace trước.");

  const unsent = textFromComposer(dom.composerInput);
  if (unsent.length > 0 && state.conv.state.activeConversationId !== null) {
    const ok = window.confirm("Bỏ nội dung chưa gửi và tạo cuộc trò chuyện mới?");
    if (!ok) return;
  }

  saveComposerDraft(state, dom);
  stopStream(state);
  state.activeAssistant = null;
  state.assistantText = "";
  state.lastView = initialSessionView("");

  const model = state.settings?.defaultModel;
  await state.conv.createNew(
    state.activeWorkspace,
    model?.providerID,
    model?.modelID,
  );
  clearTranscript(dom);
  setComposerText(dom.composerInput, "");
  resetLiveActivity(state);
  renderState(dom, state, handlers);
  dom.composerInput.focus();
}

async function sendPrompt(
  state: AppState,
  dom: AppDom,
  readiness: ReturnType<typeof createReadinessController>,
  handlers: Parameters<typeof renderState>[2],
): Promise<void> {
  const prompt = textFromComposer(dom.composerInput);
  if (prompt.length === 0) return;

  if (state.conv.state.activeConversationId === null) {
    await newConversation(state, dom, handlers);
  }
  if (state.client === null || state.conv.state.activeConversationId === null) return;

  const runtimeId = await ensureRuntimeSession(state, dom, readiness, handlers);

  resetLiveActivity(state);
  appendMessage(dom, "user", prompt);
  state.activeAssistant = appendMessage(dom, "assistant", "");
  setComposerText(dom.composerInput, "");
  state.composerDrafts.delete(state.conv.state.activeConversationId);
  await state.conv.recordUserMessage(prompt);
  state.conv.state.runtimePhase = "running";
  renderState(dom, state, handlers);

  const result = await state.client.sendSessionMessage(runtimeId, prompt);
  if (!result.accepted) {
    if (result.reason === "session_completed") {
      await state.conv.startContinuation();
      const retryId = await ensureRuntimeSession(state, dom, readiness, handlers);
      const retry = await state.client.sendSessionMessage(retryId, prompt);
      if (!retry.accepted) {
        await state.conv.setRuntimePhase("failed");
        appendMessage(dom, "assistant", "Không gửi được yêu cầu sau khi tạo phiên tiếp nối.");
      }
    } else {
      await state.conv.setRuntimePhase("failed");
      appendMessage(
        dom,
        "assistant",
        result.reason === "runtime_not_attached" ? "Runtime chưa sẵn sàng." : "Không gửi được yêu cầu.",
      );
    }
    renderState(dom, state, handlers);
  }
}

async function cancelRun(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
): Promise<void> {
  const runtimeId = state.conv.state.runtimeSessionId;
  if (state.client === null || runtimeId === null || state.conv.state.runtimePhase !== "running") return;
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

function createShell(root: HTMLElement): AppDom {
  root.className = "app-shell";
  root.replaceChildren();

  const topbar = el("header", "topbar");
  topbar.append(el("div", "topbar__brand", "Cowork GHC"));
  const serviceStatus = el("span", "topbar__status", "Đang khởi động");
  const modelLabel = el("button", "topbar__gateway", "Chưa cấu hình model");
  modelLabel.type = "button";
  const settingsButton = el("button", "icon-btn", "Cài đặt");
  settingsButton.type = "button";
  topbar.append(el("div", "topbar__spacer"), serviceStatus, modelLabel, settingsButton);

  const workspace = el("main", "workspace");
  const sidebar = el("aside", "sidebar");
  const nav = el("nav", "sidebar-tabs");
  const coworkTab = el("button", "sidebar-tab sidebar-tab--active", "Cowork");
  coworkTab.type = "button";
  const skillsTab = el("button", "sidebar-tab sidebar-tab--disabled", "Skills");
  skillsTab.type = "button";
  skillsTab.disabled = true;
  nav.append(coworkTab, skillsTab);
  const newConversationButton = el("button", "sidebar__new-btn", "Cuộc trò chuyện mới");
  newConversationButton.type = "button";
  const workspaceBox = el("section", "workspace-slot");
  const workspaceLabel = el("p", "workspace-context", "Chưa chọn workspace");
  const sessionSearch = el("input", "sidebar__search") as HTMLInputElement;
  sessionSearch.type = "search";
  sessionSearch.placeholder = "Tìm cuộc trò chuyện…";
  sessionSearch.setAttribute("aria-label", "Tìm cuộc trò chuyện");
  const sessionList = el("div", "sidebar__history");
  sidebar.append(
    nav,
    newConversationButton,
    workspaceLabel,
    workspaceBox,
    sessionSearch,
    el("h2", "sidebar__heading", "Phiên"),
    sessionList,
  );

  const chat = el("section", "chat-area");
  const header = el("div", "chat-header");
  const headerInfo = el("div", "chat-header__info");
  const chatTitle = el("div", "chat-header__title", DEFAULT_TITLE);
  const chatSub = el("div", "chat-header__sub", "Cowork GHC sử dụng workspace và provider đã cấu hình.");
  headerInfo.append(chatTitle, chatSub);
  const headerActions = el("div", "chat-header__actions");
  const skillsButton = el("button", "label-btn label-btn--disabled", "Skills: Chưa khả dụng");
  skillsButton.type = "button";
  skillsButton.disabled = true;
  headerActions.append(skillsButton);
  header.append(el("div", "chat-header__icon", "AI"), headerInfo, headerActions);

  const continuationBanner = el("div", "continuation-banner");
  continuationBanner.hidden = true;
  continuationBanner.append(el("span", "continuation-banner__text", "Đây là lịch sử đã lưu — không phải phiên runtime đang chạy."));
  const continuationButton = el("button", "label-btn", "Tạo phiên tiếp nối") as HTMLButtonElement;
  continuationButton.type = "button";
  continuationBanner.append(continuationButton);

  const transcript = el("div", "transcript");
  const transcriptInner = el("div", "transcript__inner");
  const emptyState = el("div", "empty-state");
  emptyState.append(el("h2", "empty-state__title", "Bắt đầu làm việc với Cowork GHC"));
  emptyState.append(
    el("p", "empty-state__copy", "Chọn workspace, cấu hình provider/model, rồi tạo cuộc trò chuyện mới hoặc gửi yêu cầu."),
  );
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
  const disabledAttach = el("button", "icon-btn", "+");
  disabledAttach.type = "button";
  disabledAttach.disabled = true;
  const cancelButton = el("button", "stop-btn", "Dừng");
  cancelButton.type = "button";
  cancelButton.hidden = true;
  const sendButton = el("button", "send-btn", "Gửi");
  sendButton.type = "button";
  composerBar.append(
    disabledAttach,
    el("span", "model-picker", "Đính kèm: Chưa khả dụng"),
    el("div", "composer__spacer"),
    cancelButton,
    sendButton,
  );
  const composerHint = el("div", "composer__hint", "Enter để gửi, Shift+Enter xuống dòng");
  composerBox.append(composerInput, composerBar);
  composer.append(composerBox, composerHint);
  chat.append(header, continuationBanner, transcript, composer);

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
  const settingsPanel = el("div", "modal__panel");
  const settingsHeader = el("div", "modal__header");
  settingsHeader.append(el("h2", "modal__title", "Cài đặt"));
  const closeSettings = el("button", "icon-btn", "Đóng");
  closeSettings.type = "button";
  settingsHeader.append(closeSettings);
  const settingsBody = el("div", "modal__body");
  settingsPanel.append(settingsHeader, settingsBody);
  settingsModal.append(settingsPanel);

  root.append(topbar, workspace, statusbar, settingsModal);

  settingsButton.addEventListener("click", () => {
    settingsModal.hidden = false;
  });
  modelLabel.addEventListener("click", () => {
    settingsModal.hidden = false;
  });
  closeSettings.addEventListener("click", () => {
    settingsModal.hidden = true;
  });

  return {
    root,
    serviceStatus,
    serviceDetail,
    workspaceLabel,
    modelLabel,
    sessionSearch,
    sessionList,
    chatTitle,
    chatSub,
    continuationBanner,
    continuationButton,
    transcriptInner,
    emptyState,
    thinking,
    composer,
    composerInput,
    composerHint,
    sendButton,
    cancelButton,
    newConversationButton,
    settingsModal,
    settingsBody,
    activityPanel: createActivityPanel(rightPanel),
    executionStatus,
    permissionSummary,
    sidebar,
    rightPanel,
  };
}

export function mountCoworkApp(root: HTMLElement): void {
  const dom = createShell(root);
  const state: AppState = {
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
  };

  const handlers = {
    onSelect: (id: string) => {
      void switchConversation(state, dom, handlers, id).catch((error) => {
        appendMessage(dom, "assistant", safeError(error));
        renderState(dom, state, handlers);
      });
    },
    onRename: (id: string, title: string) => {
      void state.conv.rename(id, title).then(() => renderState(dom, state, handlers));
    },
    onDelete: (id: string) => {
      if (!window.confirm("Xóa cuộc trò chuyện này? Workspace và khoá provider không bị xóa.")) return;
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
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const dynamicClient = createDynamicClient(state);
  const readiness = createReadinessController({
    getBootstrap: () => getShellBridge().getBootstrap(),
    createClient: (baseUrl, clientToken) => {
      state.bootstrap = { serviceBaseUrl: baseUrl, clientToken };
      state.client = createServiceClient(baseUrl, clientToken);
      return state.client;
    },
    onState: (readinessState) => {
      const copy = readinessCopy(readinessState);
      dom.serviceStatus.textContent = copy.label;
      dom.serviceStatus.classList.toggle("is-ok", copy.ok);
      dom.serviceDetail.textContent = copy.detail;
      if (readinessState.phase === "ready" && state.client !== null) {
        void refreshSettings(state, dom, handlers);
        void state.conv.refreshList().then(() => renderState(dom, state, handlers));
        if (!featuresMounted) {
          featuresMounted = true;
          mountWorkspacePicker(dom.sidebar.querySelector(".workspace-slot") as HTMLElement, {
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
          });
          mountSettingsView(dom.settingsBody, { client: dynamicClient });
          const permissions = createPermissionController({
            client: dynamicClient,
            container: dom.root,
            onPending: (request) => {
              const target =
                request.action.targetPath !== undefined
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
              const target =
                request.action.targetPath !== undefined
                  ? toRelativePath(request.action.targetPath, state.activeWorkspace)
                  : request.action.description;
              const decision =
                outcome.status !== "resolved"
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
            const target = event.target as HTMLElement;
            const row = target.closest<HTMLElement>(".file-row--clickable");
            if (row === null || state.client === null) return;
            const relativePath = row.dataset["relativePath"];
            const operation = row.dataset["operation"];
            if (relativePath === undefined || operation === undefined) return;
            const change = state.activitySnapshot?.fileChanges.find(
              (c) => c.relativePath === relativePath && c.operation === operation,
            );
            if (change === undefined) return;
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
      dom.continuationBanner.hidden = true;
      dom.composerInput.focus();
      renderState(dom, state, handlers);
    })();
  });

  dom.sessionSearch.addEventListener("input", () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void state.conv.setSearch(dom.sessionSearch.value).then(() => renderState(dom, state, handlers));
    }, 200);
  });

  dom.sendButton.addEventListener("click", () => {
    void sendPrompt(state, dom, readiness, handlers).catch((error) => {
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
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      dom.sendButton.click();
    }
  });

  dom.chatTitle.addEventListener("dblclick", () => {
    const id = state.conv.state.activeConversationId;
    if (id === null) return;
    const next = window.prompt("Đổi tên cuộc trò chuyện:", state.conv.state.activeRecord?.title ?? "");
    if (next === null) return;
    const trimmed = next.trim();
    if (trimmed.length === 0) return;
    handlers.onRename(id, trimmed);
  });

  renderState(dom, state, handlers);
  readiness.start();
}
