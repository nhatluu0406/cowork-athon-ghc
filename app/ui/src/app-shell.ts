/**
 * HuyTT12-inspired Cowork GHC application shell.
 *
 * Presentation + view-model only. Talks to the shell bridge and loopback service client.
 */

import type { FileReviewArtifact, FileSnapshotCapture } from "@cowork-ghc/service/file-review";
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
  setRightPanelCollapsed,
  showFilePreview,
  showFileReview,
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
import {
  assessSendPreflight,
  buildReadinessInput,
  localServiceStatus,
  providerModelLabel,
  providerStatus,
  shouldShowContinuationBanner,
  type ConnectionTestState,
} from "./provider-readiness.js";
import { startEvStream, type EvStreamHandle } from "./ev-stream-client.js";
import { mountProviderProfilesPanel } from "./provider-profiles-panel.js";
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
import { mountWorkspaceNavigator } from "./workspace-navigator.js";
import { mountSkillsPanel } from "./skills-panel.js";
import { mountSkillsSettingsPanel } from "./skills-settings-panel.js";
import { planRuntimeTurn } from "./runtime-turn-planner.js";
import { planDispatchPrompt, type AttachmentSnapshot } from "./attachment-context.js";
import { SECRET_ATTACHMENT_MESSAGE } from "./attachment-secret-policy.js";
import { sanitizeAssistantForDisplay } from "./assistant-output.js";
import {
  detectFileActionIntent,
  hasVerifiedFileAction,
  markFileActionUnverified,
  type FileActionIntent,
} from "./file-action-integrity.js";
import {
  createPendingAttachmentId,
  totalValidBytes,
  type PendingAttachment,
} from "./attachment-pending.js";
import type { AttachmentMetadata, SkillUseMetadata } from "./service-client.js";
import {
  resolveFinalAssistantText,
  runtimePhaseForCompleted,
  shouldPollSessionView,
  STREAM_POLL_INTERVAL_MS,
  STREAM_STALL_AFTER_ACTIVITY_MS,
  STREAM_WATCHDOG_MS,
  mapTerminalToRuntimePhase,
  type ResolvedFinalText,
} from "./session-finalization.js";
import { createProductIcon } from "./product-icons.js";
import { PRODUCT_SURFACES, hasKnowledgeGraphCapability, type ProductSurfaceDefinition, type ProductSurfaceId } from "./surface-registry.js";
import { createAppFrame, type AppFrameDom } from "./ui-shell/create-app-frame.js";
import {
  applyShellLayoutClasses,
  applyWorkMode,
  shellLayoutModeForSurface,
  type WorkMode,
} from "./ui-shell/shell-layout.js";
import { renderKnowledgeTab,
  setKnowledgeGraphCapability,
  type KnowledgeTab,
} from "./ui-shell/knowledge-view.js";
import { renderIntegrationSurface } from "./ui-shell/integration-view.js";
import { renderConversationProviderControl } from "./ui-shell/conversation-provider-control.js";
import { renderStatusBar } from "./ui-shell/status-bar.js";
import { mountWorkspaceCompanionPane, type WorkspaceCompanionPaneHandle } from "./workspace-companion-pane.js";
import type { WorkspaceNavigatorHandle } from "./workspace-navigator.js";

let workspaceCompanionHandle: WorkspaceCompanionPaneHandle | null = null;

interface RuntimeSessionReady {
  readonly runtimeSessionId: string;
  readonly contextMessages: readonly ConversationRecord["messages"][number][];
}

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
  fileReviews: FileReviewArtifact[];
  pendingBeforeSnapshots: Map<
    string,
    { readonly relativePath: string; readonly before: FileSnapshotCapture; readonly operation?: string }
  >;
  streamWatchdog: ReturnType<typeof setInterval> | null;
  lastStreamActivityAt: number;
  finalizingTurn: boolean;
  currentFileActionIntent: FileActionIntent | null;
  fileVerificationTasks: Set<Promise<void>>;
  pendingAttachments: PendingAttachment[];
  continuationUnlocked: boolean;
  localServiceReady: boolean;
  connectionTestState: ConnectionTestState;
  activeSurface: ProductSurfaceId;
  workMode: WorkMode;
  knowledgeTab: KnowledgeTab;
  serviceLabel: string;
  serviceOk: boolean;
}

type AppDom = AppFrameDom;

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

function icon(name: Parameters<typeof createProductIcon>[0], label?: string): SVGSVGElement {
  return createProductIcon(name, label);
}

function surfaceById(id: ProductSurfaceId): ProductSurfaceDefinition {
  return PRODUCT_SURFACES.find((surface) => surface.id === id) ?? PRODUCT_SURFACES[0]!;
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join("/")}`;
}

function safeError(error: unknown): string {
  if (error instanceof ServiceClientError) return sanitizeErrorMessage(error.message);
  if (error instanceof Error) return sanitizeErrorMessage(error.message);
  return "Có lỗi xảy ra.";
}

function renderComposerPreflight(
  dom: AppDom,
  preflight: ReturnType<typeof assessSendPreflight>,
  hasPrompt: boolean,
): void {
  const show =
    hasPrompt &&
    !preflight.canSend &&
    preflight.showSettingsCta &&
    preflight.message.length > 0;
  dom.composerPreflight.hidden = !show;
  if (!show) return;
  dom.composerPreflightMessage.textContent = preflight.message;
  dom.composerPreflightCta.hidden = !preflight.showSettingsCta;
}

function renderCoworkEmptyState(dom: AppDom, state: AppState, preflight: ReturnType<typeof assessSendPreflight>): void {
  const title = dom.emptyState.querySelector<HTMLElement>(".empty-state__title");
  const copy = dom.emptyState.querySelector<HTMLElement>(".empty-state__copy");
  if (state.activeWorkspace === null) {
    if (title !== null) title.textContent = "Chọn workspace để bắt đầu";
    if (copy !== null) copy.textContent = "Chọn một workspace ở sidebar trước khi gửi yêu cầu đầu tiên.";
    dom.emptyStateCta.hidden = true;
    return;
  }
  if (
    preflight.blockKind === "provider_missing" ||
    preflight.blockKind === "model_missing" ||
    preflight.blockKind === "credential_missing" ||
    preflight.blockKind === "base_url_invalid"
  ) {
    if (title !== null) title.textContent = "Cấu hình provider để bắt đầu";
    if (copy !== null) copy.textContent = preflight.message;
    dom.emptyStateCta.hidden = false;
    return;
  }
  if (title !== null) title.textContent = "Bạn muốn Cowork GHC làm gì?";
  if (copy !== null) copy.textContent = "Gửi yêu cầu đầu tiên để bắt đầu phiên làm việc với workspace hiện tại.";
  dom.emptyStateCta.hidden = true;
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

function appendMessage(
  dom: AppDom,
  role: "user" | "assistant",
  text = "",
  historical = false,
  attachments?: readonly AttachmentMetadata[],
  skills?: readonly SkillUseMetadata[],
): HTMLElement {
  dom.emptyState.hidden = true;
  const row = el("div", `msg msg--${role}${historical ? " msg--historical" : ""}`);
  if (role === "assistant") row.append(el("div", "msg__avatar", "AI"));
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

function renderAttachmentMetaList(attachments: readonly AttachmentMetadata[]): HTMLElement {
  const wrap = el("div", "msg__attachments");
  for (const att of attachments) {
    const chip = el("span", "attachment-chip attachment-chip--historical");
    chip.title = att.relativePath;
    const status = att.inclusionStatus ?? "included";
    const statusNote =
      status === "included"
        ? att.truncated
          ? " (đã cắt)"
          : ""
        : status === "omitted_by_budget"
          ? " (không gửi — vượt ngân sách)"
          : status === "rejected"
            ? " (bị từ chối)"
            : "";
    chip.append(icon("attachment"), el("span", "attachment-chip__label", `${att.filename}${statusNote}`));
    wrap.append(chip);
  }
  return wrap;
}

function renderPendingAttachmentChips(
  dom: AppDom,
  pending: readonly PendingAttachment[],
  onRemove: (id: string) => void,
): void {
  dom.attachmentChips.replaceChildren();
  if (pending.length === 0) {
    dom.attachmentChips.hidden = true;
    return;
  }
  dom.attachmentChips.hidden = false;
  for (const item of pending) {
    const chip = el("span", `attachment-chip${item.status === "error" ? " attachment-chip--error" : ""}`);
    chip.title = item.relativePath;
    const trunc =
      item.metadata?.truncated === true ? " (đã cắt)" : "";
    chip.append(
      icon(item.status === "error" ? "permission" : "attachment"),
      el("span", "attachment-chip__label", `${item.filename}${trunc}`),
    );
    const remove = el("button", "attachment-chip__remove") as HTMLButtonElement;
    remove.type = "button";
    remove.setAttribute("aria-label", `Gỡ ${item.filename}`);
    remove.append(icon("file-delete", "Gỡ tệp"));
    remove.addEventListener("click", () => onRemove(item.id));
    chip.append(remove);
    if (item.status === "error" && item.errorMessage !== undefined) {
      chip.title = item.errorMessage;
    }
    dom.attachmentChips.append(chip);
  }
}

function isComposerLocked(state: AppState): boolean {
  const record = state.conv.state.activeRecord;
  const phase = state.conv.state.runtimePhase;
  if (phase === "running" || phase === "starting" || phase === "cancelling") return false;
  if (!needsContinuation(record)) return false;
  return !state.continuationUnlocked;
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
    // Fix #7: sanitize assistant text before display to prevent legacy context
    // envelope artifacts (e.g., "[Ngữ cảnh cuộc trò chuyện trước ...]") from leaking into UI.
    const displayText = message.role === "assistant"
      ? sanitizeAssistantForDisplay(message.text)
      : message.text;
    appendMessage(
      dom,
      message.role,
      displayText,
      true,
      message.attachments,
      message.skills,
    );
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

  const draftOrdinals = new Map<string, number>();
  let draftCount = 0;
  for (const summary of summaries) {
    if (summary.status === "draft" && summary.messageCount === 0) {
      draftCount += 1;
      draftOrdinals.set(summary.id, draftCount);
    }
  }

  for (const summary of summaries) {
    const item = el("button", "history-item");
    if (summary.id === activeConversationId) item.classList.add("history-item--active");
    if (summary.status === "running") item.classList.add("history-item--running");
    if (summary.status === "interrupted") item.classList.add("history-item--interrupted");
    if (summary.status === "completed") item.classList.add("history-item--historical");
    item.type = "button";
    item.dataset["status"] = summary.status;
    const titleRow = el("span", "history-item__title-row");
    const title =
      summary.status === "draft" && summary.messageCount === 0 && (draftOrdinals.get(summary.id) ?? 0) > 1
        ? `${summary.title} (${draftOrdinals.get(summary.id)})`
        : summary.title;
    titleRow.append(el("span", "history-item__title", title));
    if (summary.status === "draft") titleRow.append(el("span", "history-item__badge", "Nháp"));
    item.append(titleRow);
    item.append(el("span", "history-item__meta", formatConversationMeta(summary)));
    item.title = summary.title;
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

function mapPermissionToOperation(kind: string): "create" | "edit" | "delete" | "move" | undefined {
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

async function capturePermissionBeforeSnapshot(
  state: AppState,
  request: import("./service-client.js").PendingPermissionView,
): Promise<void> {
  if (state.client === null) return;
  const kind = request.action.kind;
  if (
    kind !== "file_create" &&
    kind !== "file_edit" &&
    kind !== "file_delete" &&
    kind !== "file_move"
  ) {
    return;
  }
  const targetPath = request.action.targetPath;
  if (targetPath === undefined) return;
  const relativePath = toRelativePath(targetPath, state.activeWorkspace);
  try {
    const before = await state.client.captureFileReviewSnapshot(relativePath);
    const op = mapPermissionToOperation(kind);
    state.pendingBeforeSnapshots.set(request.requestId, {
      relativePath,
      before,
      ...(op !== undefined ? { operation: op } : {}),
    });
  } catch {
    // best effort
  }
}

const FILE_MUTATION_TOOL_NAMES = new Set([
  "write",
  "edit",
  "patch",
  "apply_patch",
  "multiedit",
  "delete",
]);

async function captureBeforeOnToolStart(
  state: AppState,
  event: Extract<import("@cowork-ghc/contracts").EvEvent, { kind: "tool_call" }>,
): Promise<void> {
  if (state.client === null || state.activeWorkspace === null) return;
  if (event.status !== "running" && event.status !== "pending") return;
  if (!FILE_MUTATION_TOOL_NAMES.has(event.toolName)) return;
  if (event.summary === undefined || event.summary.length === 0) return;
  const relativePath = toRelativePath(event.summary, state.activeWorkspace);
  if (relativePath.length === 0 || relativePath.startsWith("...")) return;
  for (const entry of state.pendingBeforeSnapshots.values()) {
    if (entry.relativePath === relativePath) return;
  }
  try {
    const before = await state.client.captureFileReviewSnapshot(relativePath);
    state.pendingBeforeSnapshots.set(`tool:${event.callId}`, {
      relativePath,
      before,
      operation:
        event.toolName === "write"
          ? "create"
          : event.toolName === "delete"
            ? "delete"
            : "edit",
    });
  } catch {
    // best effort
  }
}

async function finalizeFileMutationReview(
  state: AppState,
  event: Extract<EvEvent, { kind: "file_mutation" }>,
  sessionId: string,
  dom: AppDom,
  workspaceCompanion: WorkspaceCompanionPaneHandle | null,
): Promise<void> {
  if (state.client === null) return;
  const relativePath = toRelativePath(event.path, state.activeWorkspace);
  let pendingEntry:
    | { relativePath: string; before: FileSnapshotCapture; operation?: string }
    | undefined;
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
  const permissionDecision =
    permissionEntry?.decision === "allowed_once" ||
    permissionEntry?.decision === "allowed_always" ||
    permissionEntry?.decision === "denied" ||
    permissionEntry?.decision === "timeout"
      ? permissionEntry.decision
      : undefined;
  if (permissionDecision === "denied") return;

  try {
    let after: FileSnapshotCapture | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      after = await state.client.captureFileReviewSnapshot(relativePath);
      const deleteReady = event.operation === "delete" && !after.exists;
      const mutateReady =
        event.operation !== "delete" &&
        after.exists &&
        (after.kind !== "text" || after.content !== undefined || after.contentRedacted);
      if (deleteReady || mutateReady) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (after === undefined) return;
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
    const openPath = workspaceCompanion?.getOpenPath() ?? null;
    if (openPath !== null && openPath === relativePath && event.operation !== "delete") {
      workspaceCompanion?.showAgentUpdated();
    }
  } catch {
    // best effort
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
  const base =
    state.evEvents.length > 0
      ? buildActivitySnapshot(
          state.evEvents,
          state.activeWorkspace,
          state.permissionHistory,
          !state.activityLive,
          state.fileReviews,
        )
      : state.lastView.sessionId.length > 0 && state.activityLive
        ? snapshotFromSessionView(
            state.lastView,
            state.activeWorkspace,
            state.permissionHistory,
            false,
            state.fileReviews,
          )
        : buildActivitySnapshot(
            [],
            state.activeWorkspace,
            state.permissionHistory,
            !state.activityLive,
            state.fileReviews,
          );
  const attachmentPaths =
    state.activitySnapshot?.attachmentContextPaths ?? base.attachmentContextPaths;
  return { ...base, attachmentContextPaths: attachmentPaths };
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
  state.fileReviews = [];
  state.pendingBeforeSnapshots = new Map();
  const persisted = persistedToSnapshot(
    record?.activity as Record<string, unknown> | undefined,
  );
  if (persisted !== null) {
    state.activitySnapshot = persisted;
    state.permissionHistory = [...persisted.permissionHistory];
    state.fileReviews = [...persisted.fileReviews];
    return;
  }
  state.activitySnapshot = null;
}

function resetLiveActivity(state: AppState): void {
  state.evEvents = [];
  state.permissionHistory = [];
  state.activityLive = true;
  state.activitySnapshot = null;
  state.fileReviews = [];
  state.pendingBeforeSnapshots = new Map();
}

function renderState(dom: AppDom, state: AppState, handlers: {
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}): void {
  const phase = state.conv.state.runtimePhase;
  const record = state.conv.state.activeRecord;
  const activeSurface = surfaceById(state.activeSurface);
  const layoutMode = shellLayoutModeForSurface(state.activeSurface);
  const inspectorOpen = !dom.rightPanel.hidden;
  const isCoworkSurface = state.activeSurface === "cowork";
  const isKnowledgeSurface = state.activeSurface === "knowledge";
  const settingsOpen = !dom.settingsSurface.hidden;

  for (const [id, button] of dom.surfaceButtons) {
    button.setAttribute("aria-current", id === state.activeSurface ? "page" : "false");
  }

  applyShellLayoutClasses(dom.shellFrame, layoutMode, inspectorOpen);
  dom.shellFrame.classList.toggle("shell-frame--inspector-closed", !inspectorOpen);

  dom.sidebar.hidden = settingsOpen || layoutMode !== "work";
  dom.coworkView.hidden = settingsOpen || !isCoworkSurface;
  dom.workspaceView.root.hidden = settingsOpen || !isCoworkSurface || state.workMode !== "workspace";
  dom.coworkView.classList.toggle("cowork-view--companion", isCoworkSurface && state.workMode === "workspace");
  dom.knowledgeView.root.hidden = settingsOpen || !isKnowledgeSurface;
  dom.integrationSurface.hidden = settingsOpen || isCoworkSurface || isKnowledgeSurface;

  if (isKnowledgeSurface) {
    setKnowledgeGraphCapability(dom.knowledgeView, hasKnowledgeGraphCapability());
    renderKnowledgeTab(dom.knowledgeView, state.knowledgeTab);
  } else if (!isCoworkSurface) {
    renderIntegrationSurface(dom.integrationSurface, activeSurface);
  }

  if (isCoworkSurface) {
    applyWorkMode(
      dom.shellFrame,
      dom.sidebar,
      dom.coworkView,
      dom.workspaceView.root,
      dom.coworkSidebarPanel,
      dom.workspaceSidebarPanel,
      state.workMode,
    );
  }

  dom.workspaceLabel.textContent = state.activeWorkspace === null ? "Chưa chọn workspace" : shortPath(state.activeWorkspace);
  dom.workspaceLabel.title = state.activeWorkspace ?? "";

  const providerCopy = providerStatus(state.settings, state.connectionTestState);
  const displayModelLabel = providerModelLabel(state.settings);
  renderConversationProviderControl(dom.providerControl, {
    visible: isCoworkSurface && state.workMode === "cowork",
    interactive: true,
    label: displayModelLabel,
    status: providerCopy.ok ? "ok" : state.connectionTestState === "failed" ? "danger" : "warn",
    failed: state.connectionTestState === "failed",
  });

  const hasPendingPermission = state.permissionHistory.some((entry) => entry.decision === "pending");
  renderStatusBar(dom.statusBar, {
    workspacePath: state.activeWorkspace,
    serviceLabel: state.serviceLabel,
    serviceOk: state.serviceOk,
    runtimePhase: phase,
    hasPendingPermission,
    settings: state.settings,
    connectionTestState: state.connectionTestState,
  });

  dom.chatTitle.textContent = record?.title ?? DEFAULT_TITLE;
  dom.chatSub.textContent =
    record?.status === "interrupted"
      ? "Phiên trước đã gián đoạn — mở lại lịch sử hoặc tạo phiên tiếp nối."
      : "Cowork GHC sử dụng workspace và provider đã cấu hình.";

  const showContinuation = shouldShowContinuationBanner(
    state.conv.state.activeConversationId,
    record,
    phase,
  );
  if (showContinuation && isCoworkSurface && state.workMode === "cowork") {
    if (!dom.continuationBanner.isConnected) {
      dom.coworkView.insertBefore(dom.continuationBanner, dom.transcript);
    }
    dom.continuationBanner.hidden = false;
    dom.continuationButton.hidden = false;
  } else if (dom.continuationBanner.isConnected) {
    dom.continuationBanner.remove();
  }

  const locked = isComposerLocked(state);
  const readinessInput = buildReadinessInput(state.localServiceReady, state);
  const sendPreflight = assessSendPreflight(readinessInput);
  const composerText = textFromComposer(dom.composerInput);
  renderComposerPreflight(dom, sendPreflight, composerText.length > 0);
  renderCoworkEmptyState(dom, state, sendPreflight);
  dom.composer.hidden = settingsOpen || !isCoworkSurface;
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

  if (isCoworkSurface && (state.workMode === "cowork" || state.workMode === "workspace")) {
    renderSessionList(dom, state, handlers.onSelect, handlers.onRename, handlers.onDelete);
  }

  renderPendingAttachmentChips(dom, state.pendingAttachments, (id) => {
    state.pendingAttachments = state.pendingAttachments.filter((a) => a.id !== id);
    renderState(dom, state, handlers);
  });
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

function updateAssistantBubble(state: AppState, text: string): void {
  const assistant = state.activeAssistant?.querySelector<HTMLElement>(".msg__text p") ?? null;
  if (assistant !== null) assistant.textContent = text;
}

function stopStreamWatchdog(state: AppState): void {
  if (state.streamWatchdog !== null) {
    clearInterval(state.streamWatchdog);
    state.streamWatchdog = null;
  }
}

function touchStreamActivity(state: AppState): void {
  state.lastStreamActivityAt = Date.now();
}

function startStreamWatchdog(
  state: AppState,
  dom: AppDom,
  sessionId: string,
  handlers: Parameters<typeof renderState>[2],
): void {
  stopStreamWatchdog(state);
  touchStreamActivity(state);
  state.streamWatchdog = setInterval(() => {
    if (state.conv.state.runtimePhase !== "running" && state.conv.state.runtimePhase !== "cancelling") {
      stopStreamWatchdog(state);
      return;
    }
    if (state.permissionHistory.some((entry) => entry.decision === "pending")) {
      touchStreamActivity(state);
      return;
    }
    const idleFor = Date.now() - state.lastStreamActivityAt;
    if (idleFor < STREAM_STALL_AFTER_ACTIVITY_MS) return;
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
    if (state.client === null || state.finalizingTurn) return;
    void (async () => {
      try {
        const refreshed = await state.client!.getRuntimeSession(sessionId);
        if (refreshed.view.terminal !== null) {
          stopStreamWatchdog(state);
          await finalizeConversationTurn(state, dom, refreshed.view, handlers, sessionId);
        }
      } catch {
        // best effort poll
      }
    })();
  }, STREAM_POLL_INTERVAL_MS);
}

async function settleFileVerificationTasks(state: AppState): Promise<void> {
  const tasks = [...state.fileVerificationTasks];
  if (tasks.length === 0) return;
  await Promise.allSettled(tasks);
}

async function finalizeConversationTurn(
  state: AppState,
  dom: AppDom,
  view: SessionView,
  handlers: Parameters<typeof renderState>[2],
  sessionId: string,
): Promise<void> {
  if (view.terminal === null || state.finalizingTurn) return;
  const terminal = view.terminal;
  state.finalizingTurn = true;
  stopStreamWatchdog(state);

  let fetchedText: string | null = null;
  if (shouldPollSessionView(view) && state.client !== null) {
    try {
      const refreshed = await state.client.getRuntimeSession(sessionId);
      if (refreshed.view.text.trim().length > 0) fetchedText = refreshed.view.text.trim();
      if (refreshed.view.text.trim().length > view.text.trim().length) {
        view = { ...view, text: refreshed.view.text };
      }
    } catch {
      // best effort
    }
  }

  let resolved: ResolvedFinalText;
  if (view.terminal === "completed") {
    resolved = resolveFinalAssistantText(view.text, fetchedText);
  } else if (terminal === "denied") {
    const text = view.text.trim().length > 0 ? view.text.trim() : "Yêu cầu đã bị từ chối.";
    resolved = { text, outcome: "denied" };
  } else if (terminal === "cancelled") {
    const text = view.text.trim().length > 0 ? view.text.trim() : "Phiên đã bị hủy.";
    resolved = { text, outcome: "cancelled" };
  } else {
    const text =
      view.error?.message?.trim() ??
      view.text.trim() ??
      "Có lỗi xảy ra trong phiên.";
    resolved = { text, outcome: "failed" };
  }

  await settleFileVerificationTasks(state);
  if (
    terminal === "completed" &&
    state.currentFileActionIntent !== null &&
    !hasVerifiedFileAction(state.fileReviews, sessionId, state.currentFileActionIntent)
  ) {
    resolved = { ...resolved, text: markFileActionUnverified(resolved.text) };
  }

  state.lastView = view;
  state.assistantText = resolved.text;
  const displayText = sanitizeAssistantForDisplay(resolved.text);
  updateAssistantBubble(state, displayText);
  state.activityLive = false;

  const phase =
    terminal === "completed"
      ? runtimePhaseForCompleted(resolved, terminal)
      : mapTerminalToRuntimePhase(terminal);
  await state.conv.setRuntimePhase(phase);
  await state.conv.recordAssistantMessage(sanitizeAssistantForDisplay(resolved.text));
  const turnStatus =
    terminal === "completed"
      ? "completed"
      : terminal === "cancelled" || terminal === "denied"
        ? "cancelled"
        : "errored";
  await state.conv.completeRuntimeTurn(sessionId, turnStatus);
  await persistActivity(state);
  state.finalizingTurn = false;
  state.currentFileActionIntent = null;
  state.fileVerificationTasks.clear();
  state.continuationUnlocked = true;
  renderState(dom, state, handlers);
}

function stopStream(state: AppState): void {
  stopStreamWatchdog(state);
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
      touchStreamActivity(state);
      state.evEvents = [...mergeEvEvents(state.evEvents, [event])];
      refreshActivityUi(state, dom);
      if (event.kind === "tool_call") {
        void captureBeforeOnToolStart(state, event);
      }
      if (event.kind === "file_mutation") {
        const task = finalizeFileMutationReview(
          state,
          event,
          sessionId,
          dom,
          workspaceCompanionHandle,
        );
        state.fileVerificationTasks.add(task);
        void task.finally(() => state.fileVerificationTasks.delete(task));
      }
    },
    onView: (view) => {
      if (!state.conv.shouldApplyStreamView(sessionId)) return;
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
      if (!state.conv.shouldApplyStreamView(sessionId)) return;
      stopStreamWatchdog(state);
      void state.conv.setRuntimePhase("failed");
      appendMessage(dom, "assistant", message);
      renderState(dom, state, handlers);
    },
  });
  startStreamWatchdog(state, dom, sessionId, handlers);
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
): Promise<RuntimeSessionReady> {
  if (state.client === null) throw new Error("Service chưa sẵn sàng.");
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
  if (record === null) throw new Error("Chưa chọn cuộc trò chuyện.");

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
  state.pendingAttachments = [];
  stopStream(state);
  state.activeAssistant = null;
  state.assistantText = "";
  state.currentFileActionIntent = null;
  state.fileVerificationTasks.clear();
  state.lastView = initialSessionView("");
  await state.conv.select(id);
  state.continuationUnlocked = !needsContinuation(state.conv.state.activeRecord);
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
  const activeRecord = state.conv.state.activeRecord;
  if (unsent.length === 0 && activeRecord?.status === "draft" && activeRecord.messageCount === 0) {
    clearTranscript(dom);
    setComposerText(dom.composerInput, "");
    renderState(dom, state, handlers);
    dom.composerInput.focus();
    return;
  }
  const reusableDraft = state.conv.state.summaries.find(
    (summary) =>
      summary.id !== state.conv.state.activeConversationId &&
      summary.status === "draft" &&
      summary.messageCount === 0 &&
      summary.workspacePath === state.activeWorkspace,
  );
  if (unsent.length === 0 && reusableDraft !== undefined) {
    await switchConversation(state, dom, handlers, reusableDraft.id);
    return;
  }
  if (unsent.length > 0 && state.conv.state.activeConversationId !== null) {
    const ok = window.confirm("Bỏ nội dung chưa gửi và tạo cuộc trò chuyện mới?");
    if (!ok) return;
  }

  saveComposerDraft(state, dom);
  stopStream(state);
  state.activeAssistant = null;
  state.assistantText = "";
  state.currentFileActionIntent = null;
  state.fileVerificationTasks.clear();
  state.lastView = initialSessionView("");

  const model = state.settings?.defaultModel;
  const activeProfile = state.settings?.providerProfiles?.find((p) => p.isActive);
  const providerSnapshot =
    activeProfile !== undefined
      ? {
          profileId: activeProfile.id,
          displayName: activeProfile.displayName,
          providerType: activeProfile.providerType,
          modelId: activeProfile.modelId,
          baseUrl: activeProfile.baseUrl,
        }
      : undefined;
  await state.conv.createNew(
    state.activeWorkspace,
    model?.providerID,
    model?.modelID,
    providerSnapshot,
  );
  clearTranscript(dom);
  setComposerText(dom.composerInput, "");
  resetLiveActivity(state);
  renderState(dom, state, handlers);
  dom.composerInput.focus();
}

async function readAttachmentSnapshots(
  state: AppState,
  pending: readonly PendingAttachment[],
): Promise<{ snapshots: AttachmentSnapshot[]; errors: string[] }> {
  if (state.client === null || state.activeWorkspace === null) {
    return { snapshots: [], errors: ["Service chưa sẵn sàng."] };
  }
  const valid = pending.filter((p) => p.status === "valid");
  const snapshots: AttachmentSnapshot[] = [];
  const errors: string[] = [];
  let priorBytes = 0;

  for (const item of valid) {
    const winPath =
      state.activeWorkspace.endsWith("\\") || state.activeWorkspace.endsWith("/")
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

async function pickAttachment(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
): Promise<void> {
  if (state.activeWorkspace === null) {
    window.alert("Chọn workspace trước khi đính kèm tệp.");
    return;
  }
  if (state.client === null) return;
  const picked = await getShellBridge().pickWorkspaceFile(state.activeWorkspace);
  if (picked.canceled || picked.filePath === undefined) return;

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

function recordAttachmentActivity(
  state: AppState,
  included: readonly AttachmentMetadata[],
  rejected: readonly { readonly filename: string; readonly reason: string }[],
): void {
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

async function sendPrompt(
  state: AppState,
  dom: AppDom,
  readiness: ReturnType<typeof createReadinessController>,
  handlers: Parameters<typeof renderState>[2],
): Promise<void> {
  const prompt = textFromComposer(dom.composerInput);
  if (prompt.length === 0) return;

  if (isComposerLocked(state)) return;

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
  if (state.client === null) return;
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
  if (state.client === null || state.conv.state.activeConversationId === null) return;

  const { runtimeSessionId } = await ensureRuntimeSession(
    state,
    dom,
    readiness,
    handlers,
  );

  resetLiveActivity(state);
  state.currentFileActionIntent = detectFileActionIntent(prompt);
  state.fileVerificationTasks.clear();
  const includedMetadata = dispatchPlan.includedMetadata;
  appendMessage(
    dom,
    "user",
    prompt,
    false,
    includedMetadata.length > 0 ? includedMetadata : undefined,
    dispatchPlan.skillMetadata.length > 0 ? dispatchPlan.skillMetadata : undefined,
  );
  state.activeAssistant = appendMessage(dom, "assistant", "");
  const pendingCleared = state.pendingAttachments;
  setComposerText(dom.composerInput, "");
  state.pendingAttachments = [];
  state.composerDrafts.delete(state.conv.state.activeConversationId);
  await state.conv.recordUserMessage(
    prompt,
    includedMetadata.length > 0 ? includedMetadata : undefined,
    dispatchPlan.skillMetadata.length > 0 ? dispatchPlan.skillMetadata : undefined,
  );
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
      const retryPlan = planDispatchPrompt(
        retry.contextMessages,
        snapshots,
        prompt,
        undefined,
        enabledSkills,
      );
      if (!retryPlan.ok) {
        state.currentFileActionIntent = null;
        state.fileVerificationTasks.clear();
        await state.conv.setRuntimePhase("failed");
        appendMessage(dom, "assistant", retryPlan.message);
        renderState(dom, state, handlers);
        return;
      }
      const second = await state.client.sendSessionMessage(retry.runtimeSessionId, retryPlan.text);
      if (!second.accepted) {
        state.currentFileActionIntent = null;
        state.fileVerificationTasks.clear();
        await state.conv.setRuntimePhase("failed");
        appendMessage(dom, "assistant", "Không gửi được yêu cầu sau khi tạo phiên tiếp nối.");
      }
    } else {
      state.currentFileActionIntent = null;
      state.fileVerificationTasks.clear();
      await state.conv.setRuntimePhase("failed");
      appendMessage(
        dom,
        "assistant",
        result.reason === "runtime_not_attached" ? "Runtime chưa sẵn sàng." : "Không gửi được yêu cầu.",
      );
    }
    renderState(dom, state, handlers);
    return;
  }
  refreshActivityUi(state, dom);
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

function openWorkspaceFileFromCowork(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
  workspaceNavigator: WorkspaceNavigatorHandle | null,
  workspaceCompanion: WorkspaceCompanionPaneHandle | null,
  relativePath: string,
): void {
  if (state.activeSurface !== "cowork") return;
  state.workMode = "workspace";
  workspaceNavigator?.selectPath(relativePath);
  if (state.client !== null) {
    void workspaceCompanion?.open(relativePath);
  }
  renderState(dom, state, handlers);
}

function createShell(root: HTMLElement): AppDom {
  return createAppFrame(root);
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
    fileReviews: [],
    pendingBeforeSnapshots: new Map(),
    streamWatchdog: null,
    lastStreamActivityAt: 0,
    finalizingTurn: false,
    currentFileActionIntent: null,
    fileVerificationTasks: new Set(),
    pendingAttachments: [],
    continuationUnlocked: true,
    localServiceReady: false,
    connectionTestState: "unknown",
    activeSurface: "cowork",
    workMode: "cowork",
    knowledgeTab: "base",
    serviceLabel: "Service · Đang khởi động",
    serviceOk: false,
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

  for (const [id, button] of dom.surfaceButtons) {
    button.addEventListener("click", () => {
      dom.closeSettings();
      dom.closeDrawers();
      state.activeSurface = id;
      if (id === "cowork") {
        state.workMode = "cowork";
      }
      dom.skillsPanel.hidden = true;
      renderState(dom, state, handlers);
    });
  }

  dom.workModeCoworkTab.addEventListener("click", () => {
    state.workMode = "cowork";
    renderState(dom, state, handlers);
  });
  dom.workModeWorkspaceTab.addEventListener("click", () => {
    state.workMode = "workspace";
    renderState(dom, state, handlers);
  });

  for (const btn of dom.knowledgeView.root.querySelectorAll<HTMLButtonElement>("[data-knowledge-tab]")) {
    btn.addEventListener("click", () => {
      const tab = btn.dataset["knowledgeTab"];
      if (tab === "base" || tab === "graph") {
        state.knowledgeTab = tab;
        renderState(dom, state, handlers);
      }
    });
  }

  dom.skillsButton.addEventListener("click", () => {
    dom.skillsPanel.hidden = !dom.skillsPanel.hidden;
  });

  let featuresMounted = false;
  let conversationRestored = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let workspaceNavigator: WorkspaceNavigatorHandle | null = null;
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
      state.serviceLabel = copy.label;
      state.serviceOk = copy.ok;
      dom.serviceStatus.textContent = copy.label;
      dom.serviceStatus.classList.toggle("is-ok", copy.ok);
      dom.serviceDetail.textContent = copy.detail;
      state.localServiceReady = readinessState.phase === "ready";
      if (readinessState.phase === "ready" && state.client !== null) {
        void refreshSettings(state, dom, handlers);
        void state.conv.refreshList().then(async () => {
          if (!conversationRestored && state.conv.state.activeConversationId === null) {
            // PO fix #6: start with a clean new-chat slate.
            // History is loaded into the sidebar list but no conversation is auto-opened.
            // User must click a history item to load it. continuationBanner must not appear on startup.
            // We do NOT call state.conv.select() here; leave activeConversationId null so
            // the composer starts fresh. A persisted conversation is created only when the
            // first message is sent (conversation-controller handles that path).
            conversationRestored = true;
          }
          renderState(dom, state, handlers);
        });
        if (!featuresMounted) {
          featuresMounted = true;
          mountWorkspacePicker(dom.workspaceBox, {
            bridge: getShellBridge(),
            client: dynamicClient,
            onActivated: (rootPath) => {
              state.activeWorkspace = rootPath;
              void refreshSettings(state, dom, handlers);
              void workspaceNavigator?.refresh();
              renderState(dom, state, handlers);
            },
            onDeactivated: () => {
              state.activeWorkspace = null;
              void workspaceNavigator?.refresh();
              renderState(dom, state, handlers);
            },
          });
          workspaceNavigator = mountWorkspaceNavigator(dom.workspaceNavigatorSlot, {
            client: dynamicClient,
            getWorkspaceRoot: () => state.activeWorkspace,
            onFileSelected: (relativePath) => {
              state.workMode = "workspace";
              void workspaceCompanionHandle?.open(relativePath);
              renderState(dom, state, handlers);
            },
          });
          workspaceCompanionHandle = mountWorkspaceCompanionPane(
            dom.workspaceView.companionSlot,
            dynamicClient,
          );
          mountProviderProfilesPanel(dom.settingsProviderBody, {
            client: dynamicClient,
            onSettingsUpdated: (view) => {
              state.settings = view;
              state.activeWorkspace = view.activeWorkspace?.rootPath ?? state.activeWorkspace;
              void workspaceNavigator?.refresh();
              renderState(dom, state, handlers);
            },
            onConnectionTestResult: (_profileId, ok) => {
              state.connectionTestState = ok ? "ok" : "failed";
              renderState(dom, state, handlers);
            },
          });
          mountSettingsView(dom.settingsGeneralBody, { client: dynamicClient });
          mountSkillsSettingsPanel(dom.settingsSkillsBody, dynamicClient, (skills) => {
            const enabled = skills.filter((skill) => skill.status === "enabled").length;
            dom.skillsButton.textContent = `Kỹ năng: ${enabled}`;
            dom.skillsButton.setAttribute("aria-label", `Mở Kỹ năng, ${enabled} đang bật`);
          });
          mountSkillsPanel(dom.skillsPanel, dynamicClient, (skills) => {
            const enabled = skills.filter((skill) => skill.status === "enabled").length;
            dom.skillsButton.textContent = `Kỹ năng: ${enabled}`;
            dom.skillsButton.setAttribute("aria-label", `Mở Kỹ năng, ${enabled} đang bật`);
          });
          const permissions = createPermissionController({
            client: dynamicClient,
            container: dom.root,
            onPending: (request) => {
              touchStreamActivity(state);
              void capturePermissionBeforeSnapshot(state, request);
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
              touchStreamActivity(state);
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
            const reviewId = row.dataset["reviewId"];
            const review =
              reviewId !== undefined
                ? state.activitySnapshot?.fileReviews.find((r) => r.id === reviewId) ??
                  state.fileReviews.find((r) => r.id === reviewId)
                : state.fileReviews.find(
                    (r) => r.relativePath === relativePath && r.operation === operation,
                  );
            if (review !== undefined) {
              showFileReview(dom.activityPanel, review);
              return;
            }
            openWorkspaceFileFromCowork(state, dom, handlers, workspaceNavigator, workspaceCompanionHandle, relativePath);
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
    if (searchTimer !== null) clearTimeout(searchTimer);
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
