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
import { ms365ToolLabel } from "./ms365-tool-label.js";
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
  type ConversationManager,
  type RuntimePhase,
} from "./conversation-controller.js";
import { createReadinessController, type ReadinessState } from "./readiness-controller.js";
import {
  assessConfigPreflight,
  assessSendPreflight,
  buildReadinessInput,
  dispatchGateReason,
  localServiceStatus,
  providerModelLabel,
  providerStatus,
  type ConnectionTestState,
} from "./provider-readiness.js";
import { startEvStream, type EvStreamHandle } from "./ev-stream-client.js";
import { mountProviderProfilesPanel } from "./provider-profiles-panel.js";
import { createPermissionController } from "./permission-controller.js";
import { openRemotePanel } from "./remote-panel.js";
import { createDefaultRegistry } from "./commands/registry.js";
import {
  createServiceClient,
  ServiceClientError,
  type ConversationRecord,
  type ServiceClient,
  type SettingsView,
} from "./service-client.js";
import { mountSettingsView } from "./settings-view.js";
import { applyThemePreference } from "./theme-manager.js";
import { mountWorkspacePicker, type WorkspacePickerHandle } from "./workspace-picker.js";
import { mountWorkspaceNavigator } from "./workspace-navigator.js";
import { createMentionTypeahead } from "./mention-typeahead.js";
import { renderMicrosoftSurface, type MicrosoftSurfaceDeps } from "./ui-shell/microsoft/microsoft-view.js";
import type { Ms365ConnectClient } from "./ui-shell/microsoft/ms-connect-view.js";
import { createMsChatController, type MsChatController, type MsChatDeps } from "./ui-shell/microsoft/ms-chat-controller.js";
import { buildMsChatDispatch, toMsChatStreamView } from "./ui-shell/microsoft/ms-chat-adapters.js";
import { createMs365WriteModeControl, type Ms365WriteModeControl } from "./ui-shell/ms365-write-mode-control.js";
import type { Ms365ViewData, Ms365WriteMode } from "./service-client.js";
import { renderClaudeCodeSurface } from "./ui-shell/code/code-view.js";
import { mountCodeEditor, type CodeEditorController } from "./ui-shell/code/code-editor.js";
import { mountPreviewController, type PreviewController } from "./ui-shell/code/preview-controller.js";
import { mountAppController, type AppController } from "./ui-shell/code/app-controller.js";
import { setClaudePanelStreaming } from "./ui-shell/code/claude-panel.js";
import { mountSkillsSettingsPanel } from "./skills-settings-panel.js";
import { mountMcpSettingsPanel, type McpPanelCallbacks } from "./mcp-panel.js";
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
  beginTurnFinalization,
  resolveFinalAssistantText,
  runtimePhaseForCompleted,
  shouldPollSessionView,
  STREAM_POLL_INTERVAL_MS,
  STREAM_STALL_AFTER_ACTIVITY_MS,
  STREAM_WATCHDOG_MS,
  mapTerminalToRuntimePhase,
  type ResolvedFinalText,
} from "./session-finalization.js";
import { shouldShowProcessing } from "./turn-ui-state.js";
import {
  createTurnTimingTracker,
  TURN_PERF_DEMO_ENABLED,
  type TurnTimingTracker,
} from "./turn-timing.js";
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
import { renderSkillsMcpTab, type SkillsMcpTab } from "./ui-shell/skills-mcp-view.js";
import { renderConversationProviderControl } from "./ui-shell/conversation-provider-control.js";
import { renderStatusBar } from "./ui-shell/status-bar.js";
import { mountWorkspaceCompanionPane, type WorkspaceCompanionPaneHandle } from "./workspace-companion-pane.js";
import { ensureAppUnlocked } from "./app-lock.js";
import type { WorkspaceNavigatorHandle } from "./workspace-navigator.js";
import type { PermissionMode } from "./ui-shell/permission-mode-control.js";

let workspaceCompanionHandle: WorkspaceCompanionPaneHandle | null = null;
// Module-level so the verified-mutation handler (finalizeFileMutationReview) can auto-refresh the
// file trees after an agent create/modify/delete, not just the mount closure.
let workspaceNavigator: WorkspaceNavigatorHandle | null = null;
let codeNavigator: WorkspaceNavigatorHandle | null = null;
let codeEditor: CodeEditorController | null = null;
let previewController: PreviewController | null = null;
let appController: AppController | null = null;
/** The running runtime-preview loopback URL (fed into the Code Agent turn context). */
let codePreviewUrl: string | null = null;
/** Hot path: poll permissions immediately when tools start (workspace_auto still waits on discovery). */
let permissionRefreshNow: (() => void) | null = null;
/** Pause/resume the permission poller across settings→live restart (avoid dead-port spam). */
let permissionPausePoll: (() => void) | null = null;
let permissionResumePoll: (() => void) | null = null;
/** MS365-tab dedicated controller lifecycle hooks (always-ask, session-scoped to ms365Chat). */
let ms365PermissionStart: (() => void) | null = null;
let ms365PermissionStop: (() => void) | null = null;
let ms365PermissionPausePoll: (() => void) | null = null;
let ms365PermissionResumePoll: (() => void) | null = null;

const MS_DISCONNECTED_VIEW: Ms365ViewData = Object.freeze({
  connectionState: "disconnected",
  services: [],
  scopes: [],
  actionHistory: [],
});

/**
 * A client stub used only before the real service client is ready. Every method rejects so a
 * click during that brief window surfaces an honest error instead of a silently-fabricated
 * success — the disconnected sign-in button is only truly wired once `state.client` exists.
 */
const NULL_MS365_CLIENT: Ms365ConnectClient = {
  connectMs365Token: () => Promise.reject(new Error("service_not_ready")),
  fetchMs365View: () => Promise.reject(new Error("service_not_ready")),
  beginMs365Device: () => Promise.reject(new Error("service_not_ready")),
  pollMs365Device: () => Promise.reject(new Error("service_not_ready")),
  disconnectMs365: () => Promise.reject(new Error("service_not_ready")),
  listMs365Sites: () => Promise.reject(new Error("service_not_ready")),
  setMs365SiteEnabled: () => Promise.reject(new Error("service_not_ready")),
};

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
  finalizedRuntimeSessions: Set<string>;
  turnTiming: TurnTimingTracker;
  /** Wall-clock start (ms) of the current turn, for the per-turn runtime metric (issue #4). */
  turnStartedAtMs: number | null;
  /** Wave 4: at most one safe auto-open per turn, so the preview never flickers across files. */
  autoOpenedThisTurn: boolean;
  currentFileActionIntent: FileActionIntent | null;
  fileVerificationTasks: Set<Promise<void>>;
  pendingAttachments: PendingAttachment[];
  continuationUnlocked: boolean;
  localServiceReady: boolean;
  connectionTestState: ConnectionTestState;
  activeSurface: ProductSurfaceId;
  workMode: WorkMode;
  knowledgeTab: KnowledgeTab;
  skillsMcpTab: SkillsMcpTab;
  serviceLabel: string;
  serviceOk: boolean;
  permissionMode: PermissionMode;
  /** Conversation that owns the current processing indicator (`Đang xử lý`). */
  processingConversationId: string | null;
  /** Optimistic user bubble awaiting service acknowledgement. */
  pendingUserRow: HTMLElement | null;
  /**
   * True only after a successful user-gated `connectLive` (OpenCode attached).
   * Settings-only bootstrap also answers `GET /v1/health`, so health alone must NOT
   * skip connect — that path hits not-attached session create → Internal boundary.
   */
  liveAttached: boolean;
  /** MS365 tab connection view + services (rich device-code/token vertical). */
  msView: Ms365ViewData;
  /** True once the current client's MS365 view has been fetched (once per client, not per render). */
  msViewFetched: boolean;
  /**
   * MS365 tab chat controller. Lives alongside `msView` so it survives the `replaceChildren()`
   * re-render of the Microsoft surface body. Wired with the real send-flow once `readiness` exists.
   */
  msChat: MsChatController;
  /** Write-mode pill relocated into the MS365 tab composer; only rendered while MS365 is connected. */
  msWriteModePill: Ms365WriteModeControl;
  /** MS365 history-sidebar conversation list (surface "ms365"). */
  msConversations: readonly { readonly id: string; readonly title: string; readonly meta?: string }[];
  /** Current search query for the MS365 history sidebar. */
  msConversationSearch: string;
}

type AppDom = AppFrameDom;

const DEFAULT_TITLE = "Cuộc trò chuyện mới";
const PERMISSION_MODE_STORAGE_KEY = "cowork-ghc.permission-mode.v3";

function readPermissionMode(): PermissionMode {
  try {
    const value = window.localStorage.getItem(PERMISSION_MODE_STORAGE_KEY);
    return value === "workspace_auto" || value === "read_only" ? value : "ask";
  } catch {
    return "ask";
  }
}

function storePermissionMode(mode: PermissionMode): void {
  try {
    window.localStorage.setItem(PERMISSION_MODE_STORAGE_KEY, mode);
  } catch {
    // Local storage may be unavailable in hardened verification contexts; keep the in-memory mode.
  }
}

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

function renderCodeSurface(dom: AppDom, state: AppState, handlers: Parameters<typeof renderState>[2]): void {
  const record = state.conv.state.activeRecord;
  const preflight = assessSendPreflight(buildReadinessInput(state.localServiceReady, state));
  const reviews = state.fileReviews;
  const workspaceName =
    state.activeWorkspace === null ? null : (state.activeWorkspace.split(/[\\/]/).filter(Boolean).pop() ?? null);
  // The editor is a persistent controller; keep its open diff tabs in sync with the reviews.
  codeEditor?.setReviews(reviews);
  renderClaudeCodeSurface(
    dom.codeView,
    {
      workspaceName,
      reviews,
      sessionTitle: record?.title ?? null,
      messages: record?.messages ?? [],
      phase: state.conv.state.runtimePhase,
      composerDisabled: !preflight.canSend || isComposerLocked(state),
      composerDisabledReason: preflight.canSend ? null : preflight.message,
    },
    {
      onOpenReview: (review) => {
        codeEditor?.openReview(review);
        renderState(dom, state, handlers);
      },
    },
  );
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
  if (error instanceof ServiceClientError) {
    if (error.code === "internal" || /internal boundary error/i.test(error.message)) {
      return "Local service gặp lỗi nội bộ. Thử lại hoặc mở Settings kiểm tra provider / runtime.";
    }
    if (error.code === "runtime_unavailable" || error.code === "runtime_not_attached") {
      return "Runtime chưa sẵn sàng. Đợi local service / OpenCode khởi động rồi gửi lại.";
    }
    return sanitizeErrorMessage(error.message);
  }
  if (error instanceof Error) {
    if (/internal boundary error/i.test(error.message)) {
      return "Local service gặp lỗi nội bộ. Thử lại hoặc mở Settings kiểm tra provider / runtime.";
    }
    return sanitizeErrorMessage(error.message);
  }
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
    if (copy !== null) copy.textContent = "Chọn một workspace dùng chung cho mọi màn hình trước khi gửi yêu cầu đầu tiên.";
    dom.emptyStateCta.textContent = "Chọn Workspace";
    dom.emptyStateCta.dataset["action"] = "pick-workspace";
    dom.emptyStateCta.hidden = false;
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
    dom.emptyStateCta.textContent = "Mở Settings";
    dom.emptyStateCta.dataset["action"] = "open-settings";
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
  options?: { readonly pending?: boolean },
): HTMLElement {
  dom.emptyState.hidden = true;
  const pendingClass = options?.pending === true ? " msg--pending" : "";
  const row = el("div", `msg msg--${role}${historical ? " msg--historical" : ""}${pendingClass}`);
  if (role === "assistant") row.append(el("div", "msg__avatar", "AI"));
  const body = el("div", "msg__body");
  body.append(el("div", "msg__name", role === "user" ? "Bạn" : "Cowork GHC"));
  const textBox = el("div", "msg__text");
  const p = document.createElement("p");
  p.textContent = text;
  textBox.append(p);
  body.append(textBox);

  // Skills remain persisted for provenance; do not render chips/versions in the visible transcript.
  void skills;
  const meta = el("div", "msg__meta");
  if (attachments !== undefined && attachments.length > 0) {
    meta.append(renderAttachmentMetaList(attachments));
  }
  if (meta.childElementCount > 0) body.append(meta);
  row.append(body);
  dom.transcriptInner.insertBefore(row, dom.thinking);
  dom.transcriptInner.parentElement?.scrollTo({ top: dom.transcriptInner.scrollHeight });
  return row;
}

function confirmPendingUserMessage(row: HTMLElement | null): void {
  if (row === null) return;
  row.classList.remove("msg--pending");
  row.querySelector(".msg__retry")?.remove();
}

function attachSendRetry(
  row: HTMLElement,
  onRetry: () => void,
): void {
  row.classList.add("msg--pending");
  row.querySelector(".msg__retry")?.remove();
  const retry = el("button", "msg__retry", "Thử lại") as HTMLButtonElement;
  retry.type = "button";
  retry.addEventListener("click", () => onRetry());
  row.querySelector(".msg__body")?.append(retry);
}

function renderAttachmentMetaList(attachments: readonly AttachmentMetadata[]): HTMLElement {
  const wrap = el("div", "msg__attachments");
  for (const att of attachments) {
    const chip = el("span", "attachment-chip attachment-chip--historical");
    chip.dataset["tooltip"] = att.relativePath;
    chip.removeAttribute("title");
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
    chip.removeAttribute("title");
    chip.dataset["tooltip"] = item.relativePath;
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
      chip.dataset["tooltip"] = item.errorMessage;
    }
    dom.attachmentChips.append(chip);
  }
}

function isComposerLocked(_state: AppState): boolean {
  // Historical conversations continue transparently on the next send. The runtime planner
  // creates a continuation turn when needed, so a persistent banner/lock only adds friction.
  return false;
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
    const item = el("div", "history-item");
    item.dataset["conversationId"] = summary.id;
    if (summary.id === activeConversationId) item.classList.add("history-item--active");
    if (summary.status === "running") item.classList.add("history-item--running");
    if (summary.status === "interrupted") item.classList.add("history-item--interrupted");
    if (summary.status === "completed") item.classList.add("history-item--historical");
    item.dataset["status"] = summary.status;

    const select = el("button", "history-item__select") as HTMLButtonElement;
    select.type = "button";
    select.setAttribute("aria-label", `Mở cuộc trò chuyện ${summary.title}`);
    const titleRow = el("span", "history-item__title-row");
    const title =
      summary.status === "draft" && summary.messageCount === 0 && (draftOrdinals.get(summary.id) ?? 0) > 1
        ? `${summary.title} (${draftOrdinals.get(summary.id)})`
        : summary.title;
    const titleText = el("span", "history-item__title", title);
    titleRow.append(titleText);
    if (summary.status === "draft") titleRow.append(el("span", "history-item__badge", "Nháp"));
    select.append(titleRow, el("span", "history-item__meta", formatConversationMeta(summary)));
    select.addEventListener("click", () => onSelect(summary.id));

    const actions = el("span", "history-item__actions");
    const rename = el("button", "history-item__action") as HTMLButtonElement;
    rename.type = "button";
    rename.dataset["tooltip"] = "Đổi tên";
    rename.setAttribute("aria-label", `Đổi tên ${summary.title}`);
    rename.append(icon("pencil", "Đổi tên"));

    const remove = el("button", "history-item__action history-item__action--delete") as HTMLButtonElement;
    remove.type = "button";
    remove.dataset["tooltip"] = "Xóa";
    remove.setAttribute("aria-label", `Xóa ${summary.title}`);
    remove.append(icon("trash", "Xóa"));

    rename.addEventListener("click", () => {
      if (item.classList.contains("history-item--renaming")) return;
      item.classList.add("history-item--renaming");
      const input = el("input", "history-item__rename-input") as HTMLInputElement;
      input.value = summary.title;
      input.setAttribute("aria-label", "Tên cuộc trò chuyện mới");
      titleText.replaceWith(input);
      input.focus();
      input.select();
      const finish = (save: boolean): void => {
        if (!input.isConnected) return;
        const next = input.value.trim();
        input.replaceWith(titleText);
        item.classList.remove("history-item--renaming");
        if (save && next.length > 0 && next !== summary.title) onRename(summary.id, next);
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      });
      input.addEventListener("blur", () => finish(true), { once: true });
    });

    let deleteTimer: ReturnType<typeof setTimeout> | null = null;
    remove.addEventListener("click", () => {
      if (remove.dataset["confirm"] === "true") {
        if (deleteTimer !== null) clearTimeout(deleteTimer);
        onDelete(summary.id);
        return;
      }
      remove.dataset["confirm"] = "true";
      remove.classList.add("is-confirming");
      remove.replaceChildren(icon("check", "Xác nhận xóa"));
      remove.dataset["tooltip"] = "Bấm lại để xóa";
      remove.setAttribute("aria-label", `Xác nhận xóa ${summary.title}`);
      deleteTimer = setTimeout(() => {
        remove.dataset["confirm"] = "false";
        remove.classList.remove("is-confirming");
        remove.replaceChildren(icon("trash", "Xóa"));
        remove.dataset["tooltip"] = "Xóa";
        remove.setAttribute("aria-label", `Xóa ${summary.title}`);
      }, 3000);
    });

    actions.append(rename, remove);
    item.append(select, actions);
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
      // Globally unique: OpenCode `seq` restarts per session and would collide across
      // conversations on file_review_refs.id (PRIMARY KEY) → PATCH /v1/conversations 500.
      id: `review-${sessionId}-${event.seq}`,
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
    if (state.fileReviews.some((existing) => existing.id === review.id)) {
      refreshActivityUi(state, dom);
      return;
    }
    state.fileReviews = [...state.fileReviews, review];
    state.turnTiming.mark("FILE_VERIFIED", relativePath);
    refreshActivityUi(state, dom);
    void persistActivity(state);
    // Wave 4 — reflect the verified mutation in the workspace surface.
    // 1) Refresh the file trees so a create/delete/rename appears without a manual reload.
    void workspaceNavigator?.refresh();
    void codeNavigator?.refresh();
    // Code Phase 1 — update any open Code editor tab for this file (reload clean, conflict if dirty,
    // deleted-state on a verified delete). Uses the same verified evidence, no new verifier.
    codeEditor?.applyVerifiedMutation(relativePath, event.operation === "delete" ? "delete" : "modify");
    // 2) Update the open file, or auto-open the affected file when safe.
    const openPath = workspaceCompanion?.getOpenPath() ?? null;
    if (openPath !== null && openPath === relativePath) {
      if (event.operation === "delete") {
        // The open file was verifiably deleted: clear the stale preview, show a deleted empty
        // state, and block Save so it cannot recreate the file. Never auto-open another file.
        workspaceCompanion?.showDeleted();
      } else {
        // The open file changed: reload it, or raise a conflict banner if the buffer is dirty
        // (showAgentUpdated never overwrites unsaved edits).
        workspaceCompanion?.showAgentUpdated();
      }
    } else if (event.operation !== "delete" && !state.autoOpenedThisTurn) {
      // A different/unopened file changed: auto-open ONE safe file per turn (never over a dirty
      // buffer, never a secret/unsupported/oversize file). Claim the slot synchronously so a
      // multi-file turn does not flicker the preview across files; release it if this one bails.
      state.autoOpenedThisTurn = true;
      void workspaceCompanion?.openIfSafe(relativePath).then((opened) => {
        if (opened) workspaceNavigator?.selectPath(relativePath);
        else state.autoOpenedThisTurn = false;
      });
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
  const isCoworkSurface = state.activeSurface === "cowork";
  const isKnowledgeSurface = state.activeSurface === "knowledge";
  const isMicrosoftSurface = state.activeSurface === "microsoft";
  const isCodeSurface = state.activeSurface === "code";
  const isSkillsMcpSurface = state.activeSurface === "skills-mcp";
  const settingsOpen = !dom.settingsSurface.hidden;
  const inspectorAvailable = isCoworkSurface && state.workMode === "cowork" && !settingsOpen;
  const inspectorOpen = inspectorAvailable && !dom.rightPanel.hidden;

  for (const [id, button] of dom.surfaceButtons) {
    button.setAttribute("aria-current", id === state.activeSurface ? "page" : "false");
  }

  applyShellLayoutClasses(dom.shellFrame, layoutMode, inspectorOpen);
  dom.shellFrame.classList.toggle("shell-frame--inspector-closed", !inspectorOpen);
  dom.rightPanelTopbarToggle.hidden = !inspectorAvailable;
  dom.rightPanel.classList.toggle("inspector-shell--surface-hidden", !inspectorAvailable);

  dom.sidebar.hidden = settingsOpen || layoutMode !== "work";
  dom.coworkView.hidden = settingsOpen || !isCoworkSurface;
  dom.workspaceView.root.hidden = settingsOpen || !isCoworkSurface || state.workMode !== "workspace";
  dom.coworkView.classList.toggle("cowork-view--companion", isCoworkSurface && state.workMode === "workspace");
  dom.knowledgeView.root.hidden = settingsOpen || !isKnowledgeSurface;
  dom.integrationSurface.hidden =
    settingsOpen ||
    isCoworkSurface ||
    isKnowledgeSurface ||
    isMicrosoftSurface ||
    isCodeSurface ||
    isSkillsMcpSurface;
  dom.microsoftView.root.hidden = settingsOpen || !isMicrosoftSurface;
  dom.codeView.root.hidden = settingsOpen || !isCodeSurface;
  dom.skillsMcpView.root.hidden = settingsOpen || !isSkillsMcpSurface;
  // Drive the runtime panes: only in Code surface + Preview mode; Web drives the embedded preview,
  // Ứng dụng drives the desktop-app pane. Exactly one is active at a time.
  const codePreviewActive = isCodeSurface && !settingsOpen && dom.codeView.mode === "preview";
  previewController?.setActive(codePreviewActive && dom.codeView.runtimeMode === "web");
  appController?.setActive(codePreviewActive && dom.codeView.runtimeMode === "app");

  if (isKnowledgeSurface) {
    setKnowledgeGraphCapability(dom.knowledgeView, hasKnowledgeGraphCapability());
    renderKnowledgeTab(dom.knowledgeView, state.knowledgeTab);
  } else if (isMicrosoftSurface) {
    renderMicrosoftSurfaceBound(dom, state, handlers);
  } else if (isCodeSurface) {
    renderCodeSurface(dom, state, handlers);
  } else if (isSkillsMcpSurface) {
    renderSkillsMcpTab(dom.skillsMcpView, state.skillsMcpTab);
  } else if (!isCoworkSurface) {
    // Gate dispatch runs on the same prerequisites as a Cowork send (service + workspace +
    // provider) so the "Chạy" button never invites a run that will fail (ui-ux-audit F3).
    const dispatchCfg = assessConfigPreflight(buildReadinessInput(state.localServiceReady, state));
    renderIntegrationSurface(dom.integrationSurface, activeSurface, state.client, {
      canRun: dispatchCfg.canSend,
      reason: dispatchCfg.canSend ? "" : dispatchGateReason(dispatchCfg.blockKind),
    });
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

  // Historical conversations continue transparently on the next send. A persistent banner
  // consumes transcript space and duplicates the runtime planner's continuation behavior.
  if (dom.continuationBanner.isConnected) dom.continuationBanner.remove();

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
  syncProcessingIndicator(dom, state);
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
    applyThemePreference(state.settings.general.theme);
    void getShellBridge()
      .setDevToolsEnabled(state.settings.general.devtoolsEnabled)
      .catch(() => undefined);
    const active = state.settings.providerProfiles?.find((p) => p.isActive);
    if (active?.verificationCurrent === true && active.lastVerifiedOk === true) {
      state.connectionTestState = "ok";
    } else if (active?.verificationCurrent === true && active.lastVerifiedOk === false) {
      state.connectionTestState = "failed";
    }
  } catch {
    state.settings = null;
  }
  renderState(dom, state, handlers);
}

function updateAssistantBubble(state: AppState, text: string): void {
  const assistant = state.activeAssistant?.querySelector<HTMLElement>(".msg__text p") ?? null;
  if (assistant !== null) assistant.textContent = text;
  if (text.trim().length > 0 && state.activeAssistant !== null) {
    state.activeAssistant.classList.remove("msg--awaiting");
    const thinking = state.activeAssistant.querySelector<HTMLElement>(".thinking");
    if (thinking !== null) {
      thinking.hidden = true;
      const host = state.activeAssistant.closest(".transcript__inner");
      if (host !== null) host.append(thinking);
    }
    state.turnTiming.mark("FIRST_PAINT");
  }
}

/** Human-readable turn duration ("820ms" / "2.3s"). */
function formatTurnDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Render the per-turn runtime + token metrics footer under the assistant answer (issue #4).
 * Non-secret counts only. No-op when neither a runtime nor any token count is available.
 */
function renderTurnMetrics(state: AppState, view: SessionView): void {
  const row = state.activeAssistant;
  if (row === null) return;
  const parts: string[] = [];
  if (state.turnStartedAtMs !== null) {
    parts.push(`⏱ ${formatTurnDuration(Date.now() - state.turnStartedAtMs)}`);
  }
  const m = view.metrics;
  if (m !== undefined) {
    if (typeof m.tokensTotal === "number") {
      const io = [
        typeof m.tokensInput === "number" ? `${m.tokensInput.toLocaleString("vi-VN")}↑` : null,
        typeof m.tokensOutput === "number" ? `${m.tokensOutput.toLocaleString("vi-VN")}↓` : null,
        // Most of `total` is usually cached runtime context (system prompt + tool schemas);
        // surface it so the number stops looking like fresh spend on the very first turn.
        typeof m.tokensCache === "number" && m.tokensCache > 0
          ? `${m.tokensCache.toLocaleString("vi-VN")} cache`
          : null,
      ]
        .filter((x): x is string => x !== null)
        .join(" · ");
      parts.push(`${m.tokensTotal.toLocaleString("vi-VN")} tokens${io.length > 0 ? ` (${io})` : ""}`);
    }
    if (typeof m.costUsd === "number" && m.costUsd > 0) {
      parts.push(`$${m.costUsd.toFixed(4)}`);
    }
  }
  if (parts.length === 0) return;
  const host = row.querySelector<HTMLElement>(".msg__body") ?? row;
  let footer = host.querySelector<HTMLElement>(".turn-metrics");
  if (footer === null) {
    footer = document.createElement("p");
    footer.className = "turn-metrics";
    host.append(footer);
  }
  footer.textContent = parts.join(" · ");
}

/** Keep the processing indicator under the live assistant label when the bubble is still empty. */
function syncProcessingIndicator(dom: AppDom, state: AppState): void {
  const show = shouldShowProcessing({
    activeConversationId: state.conv.state.activeConversationId,
    processingConversationId: state.processingConversationId,
    runtimePhase: state.conv.state.runtimePhase,
  });
  const awaiting =
    show &&
    state.activeAssistant !== null &&
    (state.assistantText.trim().length === 0);

  for (const row of dom.transcriptInner.querySelectorAll(".msg--awaiting")) {
    if (row !== state.activeAssistant) row.classList.remove("msg--awaiting");
  }

  if (!show) {
    dom.thinking.hidden = true;
    state.activeAssistant?.classList.remove("msg--awaiting");
    if (dom.thinking.parentElement !== dom.transcriptInner) {
      dom.transcriptInner.append(dom.thinking);
    }
    return;
  }

  dom.thinking.hidden = false;
  if (awaiting && state.activeAssistant !== null) {
    state.activeAssistant.classList.add("msg--awaiting");
    const body = state.activeAssistant.querySelector(".msg__body");
    if (body !== null && dom.thinking.parentElement !== body) {
      body.append(dom.thinking);
    }
    return;
  }

  state.activeAssistant?.classList.remove("msg--awaiting");
  if (dom.thinking.parentElement !== dom.transcriptInner) {
    dom.transcriptInner.append(dom.thinking);
  }
}

/**
 * Composer keystrokes must not rebuild the session list / status chrome.
 * That full renderState path was the main input lag on the packaged app.
 */
function syncComposerChrome(dom: AppDom, state: AppState): void {
  saveComposerDraft(state, dom);
  const locked = isComposerLocked(state);
  const phase = state.conv.state.runtimePhase;
  const readinessInput = buildReadinessInput(state.localServiceReady, state);
  const sendPreflight = assessSendPreflight(readinessInput);
  const composerText = textFromComposer(dom.composerInput);
  renderComposerPreflight(dom, sendPreflight, composerText.length > 0);
  dom.sendButton.disabled =
    locked ||
    phase === "starting" ||
    phase === "running" ||
    phase === "cancelling" ||
    composerText.length === 0;
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
  if (view.terminal === null) return;
  if (!beginTurnFinalization(state.finalizedRuntimeSessions, sessionId, state.finalizingTurn)) {
    return;
  }
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
  renderTurnMetrics(state, view);
  setClaudePanelStreaming(dom.codeView.panel, state.assistantText, true);
  state.activityLive = false;
  state.turnTiming.mark("FINAL_RESPONSE");

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
  setClaudePanelStreaming(dom.codeView.panel, "", false);
  state.finalizingTurn = false;
  state.currentFileActionIntent = null;
  state.fileVerificationTasks.clear();
  state.continuationUnlocked = true;
  if (state.processingConversationId === state.conv.state.activeConversationId) {
    state.processingConversationId = null;
  }
  state.pendingUserRow = null;
  renderState(dom, state, handlers);
  state.turnTiming.mark("FINAL_UI");
  const timingReport = state.turnTiming.report();
  (window as unknown as { __CGHC_LAST_TURN_TIMING__?: unknown }).__CGHC_LAST_TURN_TIMING__ =
    timingReport;
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
  let activityRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleActivityRefresh = (immediate = false): void => {
    if (immediate) {
      if (activityRefreshTimer !== null) {
        clearTimeout(activityRefreshTimer);
        activityRefreshTimer = null;
      }
      refreshActivityUi(state, dom);
      return;
    }
    if (activityRefreshTimer !== null) return;
    activityRefreshTimer = setTimeout(() => {
      activityRefreshTimer = null;
      refreshActivityUi(state, dom);
    }, 32);
  };
  state.stream = startEvStream({
    baseUrl: bootstrap.serviceBaseUrl,
    clientToken: bootstrap.clientToken,
    sessionId,
    onEvent: (event) => {
      if (!state.conv.shouldApplyStreamView(sessionId)) return;
      touchStreamActivity(state);
      state.evEvents = [...mergeEvEvents(state.evEvents, [event])];
      // Tokens are frequent — debounce Inspector rebuild. Tool/file/plan events paint ASAP.
      scheduleActivityRefresh(event.kind !== "token");
      if (event.kind === "token" && event.delta.length > 0) {
        state.turnTiming.mark("FIRST_TOKEN");
      }
      if (event.kind === "tool_call") {
        if (event.status === "running") {
          state.turnTiming.mark("TOOL_REQUEST", event.toolName);
          permissionRefreshNow?.();
          void captureBeforeOnToolStart(state, event);
        } else if (event.status === "completed" || event.status === "errored" || event.status === "cancelled") {
          state.turnTiming.mark("TOOL_FINISHED", event.toolName);
        }
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
      const displayText = sanitizeAssistantForDisplay(view.text);
      if (view.text.trim().length > 0) {
        state.turnTiming.mark("FIRST_TOKEN");
      }
      state.lastView = view;
      state.assistantText = view.text;
      // Paint only when there is user-visible text. Internal/Skill-only deltas must not
      // count as FIRST_PAINT — otherwise a long tool/permission wait is mislabeled as UI.
      if (displayText.trim().length > 0) {
        updateAssistantBubble(state, displayText);
      }
      setClaudePanelStreaming(dom.codeView.panel, state.assistantText, true);
      if (view.terminal !== null) {
        scheduleActivityRefresh(true);
        void finalizeConversationTurn(state, dom, view, handlers, sessionId);
        return;
      }
      // Streaming tokens: update the bubble only. Full shell re-render thrashing is the main
      // jank source; composer/cancel were already set when the turn started.
      scheduleActivityRefresh(false);
    },
    onError: (message) => {
      if (!state.conv.shouldApplyStreamView(sessionId)) return;
      if (activityRefreshTimer !== null) {
        clearTimeout(activityRefreshTimer);
        activityRefreshTimer = null;
      }
      stopStreamWatchdog(state);
      void state.conv.setRuntimePhase("failed");
      appendMessage(dom, "assistant", message);
      renderState(dom, state, handlers);
    },
  });
  startStreamWatchdog(state, dom, sessionId, handlers);
  state.turnTiming.mark("STREAM_BOUND", sessionId);
}

async function ensureLive(
  state: AppState,
  readiness: ReturnType<typeof createReadinessController>,
): Promise<ServiceClient> {
  // Fast path only after a prior connectLive succeeded. Settings-only also passes health().
  if (
    state.liveAttached &&
    state.client !== null &&
    state.bootstrap?.serviceBaseUrl &&
    state.bootstrap.clientToken
  ) {
    try {
      await state.client.health();
      return state.client;
    } catch {
      state.liveAttached = false;
      // Fall through to a real reconnect.
    }
  }

  // Pause permission polls BEFORE stopping settings-only: otherwise the 100ms poller keeps
  // hitting the dying base URL and DevTools fills with net::ERR_CONNECTION_REFUSED.
  permissionPausePoll?.();
  ms365PermissionPausePoll?.();
  state.liveAttached = false;
  state.client = null;
  state.bootstrap = null;

  try {
    await getShellBridge().connectLive();
    readiness.retry();
    // Adopt the post-restart bootstrap immediately. Health-checking the pre-restart base URL
    // (connection refused) was burning ~2–3s before first token and spamming permission polls.
    for (let i = 0; i < 120; i += 1) {
      try {
        const bootstrap = await getShellBridge().getBootstrap();
        if (!bootstrap.serviceBaseUrl || !bootstrap.clientToken) {
          throw new Error("bootstrap incomplete");
        }
        const changed =
          state.client === null ||
          state.bootstrap?.serviceBaseUrl !== bootstrap.serviceBaseUrl ||
          state.bootstrap?.clientToken !== bootstrap.clientToken;
        if (changed) {
          state.bootstrap = bootstrap;
          state.client = createServiceClient(bootstrap.serviceBaseUrl, bootstrap.clientToken);
        }
        const client = state.client;
        if (client === null) throw new Error("client missing");
        await client.health();
        state.liveAttached = true;
        return client;
      } catch {
        // Service may still be restarting into live mode.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    state.liveAttached = false;
    throw new Error("Không kết nối lại được local service.");
  } finally {
    permissionResumePoll?.();
    ms365PermissionResumePoll?.();
  }
}

async function ensureRuntimeSession(
  state: AppState,
  dom: AppDom,
  readiness: ReturnType<typeof createReadinessController>,
  handlers: Parameters<typeof renderState>[2],
): Promise<RuntimeSessionReady> {
  if (state.client === null) throw new Error("Service chưa sẵn sàng.");
  await refreshSettings(state, dom, handlers);

  // Turn already claimed (`runtimePhase = "starting"`); only re-check config readiness.
  const preflight = assessConfigPreflight(buildReadinessInput(state.localServiceReady, state));
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
    // Never reuse a session that this UI already saw go terminal — OpenCode single-turn finality.
    if (state.lastView.sessionId === plan.runtimeSessionId && state.lastView.terminal !== null) {
      await state.conv.startContinuation();
    } else {
      state.lastView = (await state.client.getRuntimeSession(plan.runtimeSessionId)).view;
      if (state.lastView.terminal !== null) {
        await state.conv.startContinuation();
      } else {
        bindEvStream(state, dom, handlers, plan.runtimeSessionId);
        state.conv.state.runtimePhase =
          state.processingConversationId !== null ? "starting" : "ready";
        return { runtimeSessionId: plan.runtimeSessionId, contextMessages: [] };
      }
    }
  }

  state.conv.state.runtimePhase = "starting";
  renderState(dom, state, handlers);
  const client = await ensureLive(state, readiness);

  const activeRecord = state.conv.state.activeRecord;
  if (activeRecord?.runtimeSessionId !== null && activeRecord !== null) {
    await state.conv.startContinuation();
  }

  const meta = await client.createSession({
    workspaceId: state.activeWorkspace,
    title: (state.conv.state.activeRecord ?? record).title,
    model,
  });
  await state.conv.linkRuntimeSession(meta.id);
  state.lastView = initialSessionView(meta.id);
  // Keep "starting" while sendPrompt owns the turn; it advances to "running" after Prompt is accepted.
  state.conv.state.runtimePhase =
    state.processingConversationId !== null ? "starting" : "ready";
  bindEvStream(state, dom, handlers, meta.id);
  renderState(dom, state, handlers);
  const contextMessages =
    plan.action === "new_turn" ? plan.priorMessages : (state.conv.state.activeRecord?.messages ?? record.messages);
  return { runtimeSessionId: meta.id, contextMessages };
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
  state.processingConversationId = null;
  state.pendingUserRow = null;
  state.currentFileActionIntent = null;
  state.fileVerificationTasks.clear();
  state.lastView = initialSessionView("");
  await state.conv.select(id);
  state.continuationUnlocked = true;
  state.finalizedRuntimeSessions.clear();
  state.finalizingTurn = false;
  loadActivityFromRecord(state, state.conv.state.activeRecord);
  renderTranscriptFromRecord(dom, state.conv.state.activeRecord);
  restoreComposerDraft(state, dom, id);
  renderState(dom, state, handlers);
  dom.composerInput.focus();
}

async function ensureDraftConversation(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
): Promise<void> {
  if (state.client === null) throw new Error("Service chưa sẵn sàng.");
  await refreshSettings(state, dom, handlers);
  if (state.activeWorkspace === null) throw new Error("Chọn workspace trước.");
  if (state.conv.state.activeConversationId !== null) return;

  const reusableDraft = state.conv.state.summaries.find(
    (summary) =>
      summary.status === "draft" &&
      summary.messageCount === 0 &&
      summary.workspacePath === state.activeWorkspace,
  );
  if (reusableDraft !== undefined) {
    await state.conv.select(reusableDraft.id);
    if (state.conv.state.activeConversationId === reusableDraft.id) return;
  }

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
  state.processingConversationId = null;
  state.pendingUserRow = null;
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

interface SendPromptOptions {
  readonly promptOverride?: string;
  readonly skipAttachments?: boolean;
}

async function sendPrompt(
  state: AppState,
  dom: AppDom,
  readiness: ReturnType<typeof createReadinessController>,
  handlers: Parameters<typeof renderState>[2],
  options?: SendPromptOptions,
): Promise<void> {
  const promptOverride = options?.promptOverride;
  const skipAttachments = options?.skipAttachments ?? false;
  const prompt = promptOverride !== undefined ? promptOverride : textFromComposer(dom.composerInput);
  if (prompt.length === 0) return;

  if (isComposerLocked(state)) return;

  state.turnTiming.reset();
  state.turnTiming.mark("SEND_START", `${prompt.length}c`);

  const preflight = assessSendPreflight(buildReadinessInput(state.localServiceReady, state));
  if (!preflight.canSend) {
    renderComposerPreflight(dom, preflight, true);
    renderState(dom, state, handlers);
    return;
  }

  const pendingSnapshot = skipAttachments ? [] : [...state.pendingAttachments];
  const { snapshots, errors } = await readAttachmentSnapshots(state, pendingSnapshot);
  if (errors.length > 0) {
    window.alert(errors.join("\n"));
    return;
  }
  if (state.client === null) return;

  const priorMessages = state.conv.state.activeRecord?.messages ?? [];
  // Wave 4: when the Workspace companion has a file open, tell the agent which file it is
  // (path only) so "tệp này / file đang mở" resolves without the user pasting a path.
  const openFilePath =
    state.activeSurface === "code"
      ? (codeEditor?.getActivePath() ?? null)
      : state.workMode === "workspace"
        ? (workspaceCompanionHandle?.getOpenPath() ?? null)
        : null;
  // Code surface: also tell the agent when a runtime web preview is live (loopback URL only).
  const previewUrl = state.activeSurface === "code" ? (previewController?.getPreviewUrl() ?? null) : null;
  const workspaceContext =
    openFilePath !== null || previewUrl !== null
      ? {
          ...(openFilePath !== null ? { openFilePath } : {}),
          ...(previewUrl !== null ? { previewUrl } : {}),
        }
      : undefined;
  // Wave 2: OpenCode native on-demand — Skill content loads on-demand via the runtime;
  // do not assemble full Skill markdown into the outbound prompt (metadata-only provenance).
  const dispatchPlan = planDispatchPrompt(
    priorMessages,
    snapshots,
    prompt,
    undefined,
    [],
    workspaceContext,
    state.msView.connectionState === "connected",
  );
  if (!dispatchPlan.ok) {
    window.alert(dispatchPlan.message);
    return;
  }
  state.turnTiming.mark("PREPARE_DONE", `dispatch=${dispatchPlan.text.length}c`);

  try {
    // Ensure a conversation before clearing the composer so a failed draft create keeps the prompt.
    if (state.conv.state.activeConversationId === null) {
      await ensureDraftConversation(state, dom, handlers);
    }
    if (state.client === null || state.conv.state.activeConversationId === null) {
      throw new Error("Không tạo được cuộc trò chuyện.");
    }

    if (promptOverride === undefined) {
      setComposerText(dom.composerInput, "");
    }
    if (!skipAttachments) {
      state.pendingAttachments = [];
    }

    state.processingConversationId = state.conv.state.activeConversationId;
    if (promptOverride === undefined) {
      state.composerDrafts.delete(state.conv.state.activeConversationId);
    }

    const includedMetadata = dispatchPlan.includedMetadata;
    state.pendingUserRow = appendMessage(
      dom,
      "user",
      prompt,
      false,
      includedMetadata.length > 0 ? includedMetadata : undefined,
      dispatchPlan.skillMetadata.length > 0 ? dispatchPlan.skillMetadata : undefined,
      { pending: true },
    );
    state.activeAssistant = appendMessage(dom, "assistant", "");
    state.assistantText = "";
    state.conv.state.runtimePhase = "starting";
    renderState(dom, state, handlers);
    state.turnTiming.mark("OPTIMISTIC_UI");

    const { runtimeSessionId } = await ensureRuntimeSession(
      state,
      dom,
      readiness,
      handlers,
    );
    state.turnTiming.mark("RUNTIME_READY", runtimeSessionId);

    resetLiveActivity(state);
    state.turnStartedAtMs = Date.now();
    state.autoOpenedThisTurn = false;
    state.currentFileActionIntent = detectFileActionIntent(prompt);
    state.fileVerificationTasks.clear();
    await state.conv.recordUserMessage(
      prompt,
      includedMetadata.length > 0 ? includedMetadata : undefined,
      dispatchPlan.skillMetadata.length > 0 ? dispatchPlan.skillMetadata : undefined,
    );
    confirmPendingUserMessage(state.pendingUserRow);
    state.pendingUserRow = null;
    await state.conv.markLastActive();
    state.conv.state.runtimePhase = "running";
    state.continuationUnlocked = true;
    recordAttachmentActivity(state, includedMetadata, []);
    renderState(dom, state, handlers);

    const dispatchText = dispatchPlan.text;
    const result = await state.client.sendSessionMessage(runtimeSessionId, dispatchText);
    if (result.accepted) {
      state.turnTiming.mark("PROMPT_ACCEPTED", "ok");
    }
    permissionRefreshNow?.();
    const needsContinuation =
      !result.accepted &&
      (result.reason === "session_completed" ||
        ((result.reason === "runtime_unavailable" || result.reason === "runtime_not_attached") &&
          state.lastView.terminal !== null));
    if (!result.accepted) {
      if (needsContinuation) {
        await state.conv.startContinuation();
        const retry = await ensureRuntimeSession(state, dom, readiness, handlers);
        // Wave 2: OpenCode native on-demand — same empty-content dispatch as the first attempt.
        const retryPlan = planDispatchPrompt(
          retry.contextMessages,
          snapshots,
          prompt,
          undefined,
          [],
          workspaceContext,
          state.msView.connectionState === "connected",
        );
        if (!retryPlan.ok) {
          state.currentFileActionIntent = null;
          state.fileVerificationTasks.clear();
          state.processingConversationId = null;
          await state.conv.setRuntimePhase("failed");
          updateAssistantBubble(state, retryPlan.message);
          renderState(dom, state, handlers);
          return;
        }
        const second = await state.client.sendSessionMessage(retry.runtimeSessionId, retryPlan.text);
        if (second.accepted) {
          state.turnTiming.mark("PROMPT_ACCEPTED", "retry-ok");
        }
        permissionRefreshNow?.();
        if (!second.accepted) {
          state.currentFileActionIntent = null;
          state.fileVerificationTasks.clear();
          state.processingConversationId = null;
          await state.conv.setRuntimePhase("failed");
          updateAssistantBubble(
            state,
            second.reason === "runtime_not_attached" || second.reason === "runtime_unavailable"
              ? "Runtime chưa sẵn sàng. Thử gửi lại sau vài giây."
              : `Không gửi được yêu cầu (${second.reason}).`,
          );
        }
      } else {
        state.currentFileActionIntent = null;
        state.fileVerificationTasks.clear();
        state.processingConversationId = null;
        await state.conv.setRuntimePhase("failed");
        updateAssistantBubble(
          state,
          result.reason === "runtime_not_attached" || result.reason === "runtime_unavailable"
            ? "Runtime chưa sẵn sàng. Thử gửi lại sau vài giây."
            : `Không gửi được yêu cầu (${result.reason}).`,
        );
        if (state.pendingUserRow === null) {
          const lastUser = [...dom.transcriptInner.querySelectorAll(".msg--user")].at(-1) as
            | HTMLElement
            | undefined;
          if (lastUser !== undefined) {
            attachSendRetry(lastUser, () => {
              void sendPrompt(state, dom, readiness, handlers, { promptOverride: prompt, skipAttachments: true });
            });
          }
        }
      }
      renderState(dom, state, handlers);
      return;
    }
    refreshActivityUi(state, dom);
  } catch (error) {
    state.processingConversationId = null;
    await state.conv.setRuntimePhase("failed").catch(() => undefined);
    const message = error instanceof Error ? error.message : "Không gửi được yêu cầu.";
    if (state.activeAssistant !== null) {
      updateAssistantBubble(state, message);
    } else {
      appendMessage(dom, "assistant", message);
    }
    const pendingRow = state.pendingUserRow;
    if (pendingRow !== null) {
      attachSendRetry(pendingRow, () => {
        void sendPrompt(state, dom, readiness, handlers, { promptOverride: prompt, skipAttachments: true });
      });
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

/**
 * Cross-surface "Hỏi Cowork về tệp này": switch to Cowork and seed the composer with a question
 * scoped to `relativePath`. The shared active workspace is unchanged; the agent reads the file via
 * its normal workspace tools, so nothing here fabricates content or an attachment. If the composer
 * already holds a draft it is preserved (the reference is prepended once, not duplicated).
 */
function askCoworkAboutFile(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
  relativePath: string,
): void {
  state.activeSurface = "cowork";
  state.workMode = "cowork";
  const lead = `Về tệp \`${relativePath}\`: `;
  const existing = textFromComposer(dom.composerInput);
  if (!existing.startsWith(`Về tệp \`${relativePath}\``)) {
    setComposerText(dom.composerInput, existing.length > 0 ? `${lead}${existing}` : lead);
  }
  renderState(dom, state, handlers);
  // Focus + caret to end so the user just types the question.
  dom.composerInput.focus();
  const sel = window.getSelection();
  if (sel !== null) {
    const range = document.createRange();
    range.selectNodeContents(dom.composerInput);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function createShell(root: HTMLElement): AppDom {
  return createAppFrame(root);
}

function ensureMs365ViewFetched(dom: AppDom, state: AppState, handlers: Parameters<typeof renderState>[2]): void {
  if (state.client === null || state.msViewFetched) return;
  state.msViewFetched = true;
  void state.client
    .fetchMs365View()
    .then((view) => {
      state.msView = view;
      void refreshMsTabWriteModePill(state);
      if (view.connectionState === "connected") {
        void refreshMs365Conversations(state, dom, handlers);
      }
      renderState(dom, state, handlers);
    })
    .catch(() => {
      // Keep the last known (disconnected) view; the connect card still lets the user retry.
    });
}

/** Shows the MS365 tab composer's write-mode pill only while MS365 is connected, seeded from
 * the service (one source of truth). Errors hide the pill — never show a mode we could not
 * read. Relocated here from the cowork composer (P5.6 Task 3) — the main chat's session is
 * never registered in the MS365 session scope, so it has nothing meaningful to show. */
async function refreshMsTabWriteModePill(state: AppState): Promise<void> {
  const control = state.msWriteModePill;
  if (state.client === null || state.msView.connectionState !== "connected") {
    control.setVisible(false);
    return;
  }
  try {
    const { mode } = await state.client.fetchMs365WriteMode();
    control.setMode(mode);
    control.setVisible(true);
  } catch {
    control.setVisible(false);
  }
}

/**
 * Renders the Microsoft 365 surface bound to the real service client. Fetches the current
 * connection view once per client (not on every re-render) so the connect view never starts
 * from a fabricated "disconnected" default when a real connection already exists.
 */
// Rebound on every renderMicrosoftSurfaceBound call so the chat controller's onStateChange
// (bound once, at state-init time, before `dom`/`handlers` exist) can trigger a re-render on
// each state mutation without capturing a stale dom/handlers pair.
let msChatRerender: (() => void) | null = null;

function renderMicrosoftSurfaceBound(dom: AppDom, state: AppState, handlers: Parameters<typeof renderState>[2]): void {
  ensureMs365ViewFetched(dom, state, handlers);
  msChatRerender = () => renderState(dom, state, handlers);
  const connected = state.msView.connectionState === "connected";
  const deps: MicrosoftSurfaceDeps = {
    client: state.client ?? NULL_MS365_CLIENT,
    onViewChange: (view) => {
      state.msView = view;
      void refreshMsTabWriteModePill(state);
      if (view.connectionState !== "connected") {
        void state.msChat.onDisconnected();
        state.msConversations = [];
      } else {
        void refreshMs365Conversations(state, dom, handlers);
      }
      renderState(dom, state, handlers);
    },
    chat: state.msChat,
    onSend: (prompt) => {
      void (async () => {
        await state.msChat.send(prompt);
        // A first turn creates a conversation and persists messages — refresh so the sidebar
        // shows the new/updated entry with fresh meta.
        void refreshMs365Conversations(state, dom, handlers);
      })();
    },
    onCancel: () => void state.msChat.cancel(),
    conversations: state.msConversations,
    activeConversationId: state.msChat.state().conversationId,
    onSelectConversation: (id) => {
      const client = state.client;
      if (client === null) return;
      void (async () => {
        try {
          const record = await client.getConversation(id);
          const messages = record.messages.map((m) => ({ role: m.role, content: m.text }));
          state.msChat.adoptConversation(id, messages);
        } catch {
          // Leave the current transcript in place; surface nothing beyond a no-op.
        }
        void refreshMs365Conversations(state, dom, handlers);
      })();
    },
    onNewConversation: () => {
      void state.msChat.reset();
      void refreshMs365Conversations(state, dom, handlers);
    },
    onSearchConversations: (query) => {
      state.msConversationSearch = query;
      void refreshMs365Conversations(state, dom, handlers);
    },
    ...(connected ? { writeModePill: state.msWriteModePill.root } : {}),
  };
  renderMicrosoftSurface(dom.microsoftView, state.msView, deps);
}

/** Refreshes the MS365 history-sidebar conversation list from the service (surface "ms365"). */
async function refreshMs365Conversations(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
): Promise<void> {
  const client = state.client;
  if (client === null || state.msView.connectionState !== "connected") {
    state.msConversations = [];
    return;
  }
  const query = state.msConversationSearch.trim();
  try {
    const list = await client.listConversations(query.length > 0 ? query : undefined, "ms365");
    state.msConversations = list.map((summary) => ({
      id: summary.id,
      title: summary.title,
      meta: formatConversationMeta(summary),
    }));
  } catch {
    state.msConversations = [];
  }
  renderState(dom, state, handlers);
}

/**
 * Real MS365 tab chat deps (P5.6 Task 3) — wires the send-flow to the live service client:
 * `createSession` -> `setMs365SessionScope(id, true)` -> `startEvStream` -> `sendSessionMessage`.
 * `startStream` keeps its own tab-local `EvStreamHandle`; it never touches `state.stream` (the
 * main chat's stream) so the two surfaces stay fully independent (per design doc §2).
 */
function createMsChatDeps(
  state: AppState,
  dom: AppDom,
  handlers: Parameters<typeof renderState>[2],
  readiness: ReturnType<typeof createReadinessController>,
): MsChatDeps {
  return {
    preflight: () => {
      const result = assessSendPreflight(buildReadinessInput(state.localServiceReady, state));
      return { canSend: result.canSend, message: result.message };
    },
    workspaceId: () => state.activeWorkspace,
    createSession: async (input) => {
      const client = await ensureLive(state, readiness);
      return client.createSession({ workspaceId: input.workspaceId, title: input.title });
    },
    setSessionScope: async (sessionId, enabled) => {
      if (state.client === null) throw new Error("Service chưa sẵn sàng.");
      await state.client.setMs365SessionScope(sessionId, enabled);
    },
    sendMessage: async (sessionId, text) => {
      if (state.client === null) throw new Error("Service chưa sẵn sàng.");
      return state.client.sendSessionMessage(sessionId, text);
    },
    cancelSession: async (sessionId) => {
      if (state.client === null) return;
      await state.client.cancelSession(sessionId);
    },
    startStream: (sessionId, onView) => {
      const bootstrap = state.bootstrap;
      if (bootstrap?.serviceBaseUrl === undefined || bootstrap.clientToken === undefined) {
        return { stop: () => {} };
      }
      const handle = startEvStream({
        baseUrl: bootstrap.serviceBaseUrl,
        clientToken: bootstrap.clientToken,
        sessionId,
        onView: (view) => onView(toMsChatStreamView(view)),
      });
      return { stop: () => handle.stop() };
    },
    createConversation: async (input) => {
      const client = await ensureLive(state, readiness);
      const workspacePath = state.activeWorkspace ?? input.workspaceId;
      const record = await client.createConversation({
        workspacePath,
        surface: "ms365",
        title: input.title,
      });
      return { id: record.id };
    },
    persistMessage: async (conversationId, role, text) => {
      if (state.client === null) throw new Error("Service chưa sẵn sàng.");
      await state.client.appendConversationMessage(conversationId, role, text);
    },
    buildDispatch: buildMsChatDispatch,
    now: () => Date.now(),
    onStateChange: () => msChatRerender?.(),
  };
}


export function mountCoworkApp(root: HTMLElement): void {
  const dom = createShell(root);
  const registry = createDefaultRegistry();
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
    finalizedRuntimeSessions: new Set(),
    turnTiming: createTurnTimingTracker({
      enabled: () =>
        TURN_PERF_DEMO_ENABLED || state.settings?.general.verboseLogging === true,
      log: (line) => console.info(line),
    }),
    turnStartedAtMs: null,
    autoOpenedThisTurn: false,
    currentFileActionIntent: null,
    fileVerificationTasks: new Set(),
    pendingAttachments: [],
    continuationUnlocked: true,
    localServiceReady: false,
    connectionTestState: "unknown",
    activeSurface: "cowork",
    workMode: "cowork",
    knowledgeTab: "base",
    skillsMcpTab: "skills",
    serviceLabel: "Service · Đang khởi động",
    serviceOk: false,
    permissionMode: readPermissionMode(),
    processingConversationId: null,
    pendingUserRow: null,
    liveAttached: false,
    msView: MS_DISCONNECTED_VIEW,
    msViewFetched: false,
    // Real send-flow deps are wired just below, once `readiness` exists (createMsChatDeps
    // needs it for ensureLive). Until then this fails closed with an honest message rather
    // than silently doing nothing — no send is possible before mountCoworkApp finishes wiring.
    msChat: createMsChatController({
      preflight: () => ({
        canSend: false,
        message: "Ứng dụng đang khởi động — vui lòng thử lại sau giây lát.",
      }),
      workspaceId: () => null,
      createSession: () => Promise.reject(new Error("ms365 chat not wired yet")),
      setSessionScope: () => Promise.resolve(),
      sendMessage: () => Promise.resolve({ accepted: false, reason: "not_wired" }),
      cancelSession: () => Promise.resolve(),
      startStream: () => ({ stop: () => {} }),
      buildDispatch: (_prior, prompt) => ({ ok: true, text: prompt }),
      onStateChange: () => msChatRerender?.(),
    }),
    msWriteModePill: createMs365WriteModeControl(),
    msConversations: [],
    msConversationSearch: "",
  };

  dom.permissionModeControl.setMode(state.permissionMode);
  dom.permissionModeControl.root.addEventListener("permission-mode-change", (event) => {
    const next = (event as CustomEvent<PermissionMode>).detail;
    state.permissionMode = next;
    storePermissionMode(next);
  });

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

  const baseCloseSettings = dom.closeSettings;
  const baseOpenSettings = dom.openSettings;
  dom.closeSettings = () => {
    baseCloseSettings();
    renderState(dom, state, handlers);
  };
  dom.openSettings = () => {
    baseOpenSettings();
    renderState(dom, state, handlers);
  };

  for (const [id, button] of dom.surfaceButtons) {
    button.addEventListener("click", () => {
      dom.closeSettings();
      dom.closeDrawers();
      state.activeSurface = id;
      if (id === "cowork") {
        state.workMode = "cowork";
      }
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

  dom.skillsMcpView.skillsTab.addEventListener("click", () => {
    state.skillsMcpTab = "skills";
    renderState(dom, state, handlers);
  });
  dom.skillsMcpView.mcpTab.addEventListener("click", () => {
    state.skillsMcpTab = "mcp";
    renderState(dom, state, handlers);
  });

  // Read-only chip: no drawer toggle. Click navigates to the full Kỹ năng & MCP surface.
  dom.skillsButton.addEventListener("click", () => {
    dom.closeSettings();
    dom.closeDrawers();
    state.activeSurface = "skills-mcp";
    renderState(dom, state, handlers);
  });

  let featuresMounted = false;
  let conversationRestored = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let workspacePicker: WorkspacePickerHandle | null = null;
  let skillsEnabledCount = 0;
  let mcpEnabledCount = 0;
  const updateSkillsMcpChip = (): void => {
    dom.skillsButton.textContent = `${skillsEnabledCount} Skill · ${mcpEnabledCount} MCP`;
    dom.skillsButton.setAttribute(
      "aria-label",
      `Mở Skill & MCP — ${skillsEnabledCount} Skill, ${mcpEnabledCount} MCP đang bật`,
    );
  };
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
        const client = state.client;
        void (async () => {
          await ensureAppUnlocked(dom.root, client);
          // Mount Settings/workspace features immediately after unlock so a refresh failure
          // cannot leave Settings → Nhà cung cấp permanently empty.
          if (!featuresMounted) {
            featuresMounted = true;
            workspacePicker = mountWorkspacePicker(dom.workspaceBox, {
              bridge: getShellBridge(),
              client: dynamicClient,
              onActivated: (rootPath) => {
                // A different active workspace resets the Code editor (its tabs pointed at the old
                // project). "reset đúng" per ADR 0013; unsaved Code edits are discarded on switch.
                if (state.activeWorkspace !== rootPath) {
                  codeEditor?.reset();
                  previewController?.reset();
                  appController?.reset();
                }
                state.activeWorkspace = rootPath;
                void refreshSettings(state, dom, handlers);
                void workspaceNavigator?.refresh();
                void codeNavigator?.refresh();
                renderState(dom, state, handlers);
              },
              onDeactivated: () => {
                state.activeWorkspace = null;
                codeEditor?.reset();
                previewController?.reset();
                appController?.reset();
                void workspaceNavigator?.refresh();
                void codeNavigator?.refresh();
                renderState(dom, state, handlers);
              },
            });
            // The Cowork empty-state primary action opens this same picker (no-workspace state).
            dom.pickWorkspace = () => void workspacePicker?.choose();
            workspaceNavigator = mountWorkspaceNavigator(dom.workspaceNavigatorSlot, {
            client: dynamicClient,
            getWorkspaceRoot: () => state.activeWorkspace,
            onChooseWorkspace: () => void workspacePicker?.choose(),
            onFileSelected: (relativePath) => {
              state.workMode = "workspace";
              void workspaceCompanionHandle?.open(relativePath);
              renderState(dom, state, handlers);
            },
          });
          codeNavigator = mountWorkspaceNavigator(dom.codeView.explorer.treeSlot, {
            client: dynamicClient,
            getWorkspaceRoot: () => state.activeWorkspace,
            onFileSelected: (relativePath) => {
              codeEditor?.openFile(relativePath);
            },
          });
          codeEditor = mountCodeEditor(dom.codeView.editorHost, dynamicClient, {
            // Code → Workspace handoff via a shared, bounded contract (no URL hack / global string).
            onOpenInWorkspace: (relativePath) => {
              state.activeSurface = "cowork";
              state.workMode = "workspace";
              workspaceNavigator?.selectPath(relativePath);
              void workspaceCompanionHandle?.open(relativePath);
              renderState(dom, state, handlers);
            },
            // Code → Cowork handoff: ask the agent about the active file.
            onAskCowork: (relativePath) => askCoworkAboutFile(state, dom, handlers, relativePath),
          });
          previewController = mountPreviewController(
            dom.codeView.previewPaneHost,
            dynamicClient,
            getShellBridge(),
            {
              onPreviewUrlChange: (url) => {
                codePreviewUrl = url;
              },
              // Hide the floating view under Settings or a permission dialog.
              isObstructed: () =>
                !dom.settingsSurface.hidden || document.querySelector(".permission-dialog") !== null,
            },
          );
          appController = mountAppController(dom.codeView.appPaneHost, dynamicClient, {
            isObstructed: () =>
              !dom.settingsSurface.hidden || document.querySelector(".permission-dialog") !== null,
          });
          // Code → Preview mode / Web↔App switch drives the runtime panes' lifecycle.
          dom.onCodeModeChange = (mode) => {
            const inPreview = mode === "preview" && state.activeSurface === "code";
            previewController?.setActive(inPreview && dom.codeView.runtimeMode === "web");
            appController?.setActive(inPreview && dom.codeView.runtimeMode === "app");
          };
          dom.onCodeRuntimeModeChange = (mode) => {
            const inPreview = dom.codeView.mode === "preview" && state.activeSurface === "code";
            previewController?.setActive(inPreview && mode === "web");
            appController?.setActive(inPreview && mode === "app");
          };
          workspaceCompanionHandle = mountWorkspaceCompanionPane(
            dom.workspaceView.companionSlot,
            dynamicClient,
            {
              // Workspace → Code handoff for text/code files (shared active workspace unchanged).
              onOpenInCode: (relativePath) => {
                state.activeSurface = "code";
                codeEditor?.openFile(relativePath);
                renderState(dom, state, handlers);
              },
              // Workspace → Cowork handoff: ask the agent about the open file.
              onAskCowork: (relativePath) => askCoworkAboutFile(state, dom, handlers, relativePath),
            },
          );
          mountProviderProfilesPanel(dom.settingsProviderBody, {
            client: dynamicClient,
            onSettingsUpdated: (view) => {
              state.settings = view;
              const nextWorkspace = view.activeWorkspace?.rootPath ?? state.activeWorkspace;
              if (nextWorkspace !== state.activeWorkspace) {
                codeEditor?.reset();
                previewController?.reset();
                appController?.reset();
              }
              state.activeWorkspace = nextWorkspace;
              void workspaceNavigator?.refresh();
              void codeNavigator?.refresh();
              renderState(dom, state, handlers);
            },
            onConnectionTestResult: (_profileId, ok) => {
              state.connectionTestState = ok ? "ok" : "failed";
              renderState(dom, state, handlers);
            },
          });

          // Composer model switcher (item 9): the provider control opens a menu of configured
          // profiles and switches the active one. With none configured it opens Settings to add one.
          let providerMenu: HTMLElement | null = null;
          const closeProviderMenu = (): void => {
            providerMenu?.remove();
            providerMenu = null;
            document.removeEventListener("click", onProviderMenuDocClick, true);
          };
          function onProviderMenuDocClick(event: MouseEvent): void {
            const target = event.target as Node | null;
            if (
              providerMenu !== null &&
              target !== null &&
              !providerMenu.contains(target) &&
              !dom.providerControl.root.contains(target)
            ) {
              closeProviderMenu();
            }
          }
          const openProviderMenu = (): void => {
            if (providerMenu !== null) {
              closeProviderMenu();
              return;
            }
            const profiles = state.settings?.providerProfiles ?? [];
            if (profiles.length === 0) {
              dom.openSettings();
              return;
            }
            const menu = document.createElement("div");
            menu.className = "provider-menu";
            menu.setAttribute("role", "menu");
            for (const profile of profiles) {
              const item = document.createElement("button");
              item.type = "button";
              item.className = "provider-menu__item" + (profile.isActive ? " provider-menu__item--active" : "");
              item.setAttribute("role", "menuitemradio");
              item.setAttribute("aria-checked", profile.isActive ? "true" : "false");
              const mark = document.createElement("span");
              mark.className = "provider-menu__check";
              mark.textContent = profile.isActive ? "✓" : "";
              const name = document.createElement("span");
              name.className = "provider-menu__name";
              name.textContent = profile.displayName;
              const model = document.createElement("span");
              model.className = "provider-menu__model";
              model.textContent = profile.modelId;
              const text = document.createElement("span");
              text.className = "provider-menu__text";
              text.append(name, model);
              item.append(mark, text);
              item.addEventListener("click", () => {
                closeProviderMenu();
                if (profile.isActive) return;
                void (async () => {
                  try {
                    const view = await dynamicClient.setActiveProviderProfile(profile.id);
                    state.settings = view;
                    renderState(dom, state, handlers);
                  } catch {
                    /* keep the current selection; a failed switch is non-fatal */
                  }
                })();
              });
              menu.append(item);
            }
            const manage = document.createElement("button");
            manage.type = "button";
            manage.className = "provider-menu__manage";
            manage.textContent = "Quản lý nhà cung cấp…";
            manage.addEventListener("click", () => {
              closeProviderMenu();
              dom.openSettings();
            });
            menu.append(manage);
            document.body.append(menu);
            const rect = dom.providerControl.root.getBoundingClientRect();
            menu.style.left = `${Math.round(rect.left)}px`;
            menu.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
            providerMenu = menu;
            // Defer so this same click does not immediately close the just-opened menu.
            setTimeout(() => document.addEventListener("click", onProviderMenuDocClick, true), 0);
          };
          dom.providerControl.root.addEventListener("click", (event) => {
            event.stopPropagation();
            openProviderMenu();
          });

          mountSettingsView(dom.settingsGeneralBody, { client: dynamicClient });
          mountSkillsSettingsPanel(dom.skillsMcpView.skillsBody, dynamicClient, (skills) => {
            skillsEnabledCount = skills.filter((skill) => skill.status === "enabled").length;
            updateSkillsMcpChip();
          });
          const toMcpView = (server: import("./service-client.js").McpServerListItem): import("./mcp-panel.js").McpServerView => ({
            id: server.id,
            name: server.name,
            transport: server.url !== undefined ? "url" : "stdio",
            ...(server.command !== undefined ? { command: server.command } : {}),
            ...(server.url !== undefined ? { url: server.url } : {}),
            hasHeaderSecret: server.hasHeaderSecret,
            enabled: server.enabled,
            health:
              server.connection === "connected"
                ? "ok"
                : server.connection === "unavailable"
                  ? "error"
                  : "unknown",
            toolCount: server.toolCount,
          });
          const mcpCallbacks: McpPanelCallbacks = {
            listMcpServers: async () => (await dynamicClient.listMcpServers()).map(toMcpView),
            createMcpServer: async (input) =>
              toMcpView(
                await dynamicClient.createMcpServer({
                  ...(input.id !== undefined ? { id: input.id } : {}),
                  name: input.name,
                  ...(input.transport === "stdio" && input.command !== undefined
                    ? { command: input.command }
                    : {}),
                  ...(input.transport === "url" && input.url !== undefined ? { url: input.url } : {}),
                  ...(input.headerSecret !== undefined && input.headerSecret.length > 0
                    ? { headerSecret: input.headerSecret }
                    : {}),
                }),
              ),
            updateMcpServer: async (id, input) => {
              const patch: {
                readonly name?: string;
                readonly command?: string;
                readonly url?: string;
                readonly headerSecret?: string | null;
              } = {
                name: input.name,
                ...(input.headerSecret !== undefined
                  ? { headerSecret: input.headerSecret.length > 0 ? input.headerSecret : null }
                  : {}),
              };
              const withTransport =
                input.transport === "stdio" && input.command !== undefined
                  ? { ...patch, command: input.command }
                  : input.transport === "url" && input.url !== undefined
                    ? { ...patch, url: input.url }
                    : patch;
              return toMcpView(await dynamicClient.updateMcpServer(id, withTransport));
            },
            deleteMcpServer: (id) => dynamicClient.deleteMcpServer(id),
            setMcpServerEnabled: async (id, enabled) =>
              toMcpView(await dynamicClient.setMcpServerEnabled(id, enabled)),
          };
          mountMcpSettingsPanel(dom.skillsMcpView.mcpBody, mcpCallbacks, (servers) => {
            mcpEnabledCount = servers.filter((server) => server.enabled).length;
            updateSkillsMcpChip();
          });
          const permissions = createPermissionController({
            client: dynamicClient,
            container: dom.root,
            // Discover permission ASAP — workspace_auto still needs the poll to see pending.
            pollIntervalMs: 100,
            getMode: () => state.permissionMode,
            // Chỉ xử lý request của session Cowork đang chạy. Request MS365 (session khác) do
            // controller MS365 riêng đảm nhiệm — tránh pop nhầm surface (P2-B bug fix).
            sessionFilter: (sid) => sid === state.streamSessionId,
            onPending: (request) => {
              touchStreamActivity(state);
              state.turnTiming.mark("PERMISSION_SHOWN", request.requestId);
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
              if (
                outcome.status === "resolved" &&
                requestedDecision !== "deny"
              ) {
                state.turnTiming.mark("PERMISSION_APPROVED", request.requestId);
              }
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
          permissionRefreshNow = () => {
            void permissions.refresh();
          };
          permissionPausePoll = () => {
            permissions.pause();
          };
          permissionResumePoll = () => {
            permissions.resume();
          };
          permissions.start();
          const ms365Permissions = createPermissionController({
            client: dynamicClient,
            container: dom.root,
            pollIntervalMs: 100,
            // Luôn hỏi: write MS365 qua Graph luôn cần phê duyệt (đúng hint composer).
            getMode: () => "ask",
            // Chỉ request của session MS365 sống hiện tại. Đọc getter tại thời điểm poll nên
            // tự bám session mới sau reset/adopt; request session cũ không pop lại. The approval
            // modal (container: dom.root) is the surface; the rich MS365 transcript renders its
            // own permission/turn state from `msChat.state()`, so no separate history strip here.
            sessionFilter: (sid) => sid === state.msChat.state().sessionId,
            onDecision: () => {
              renderState(dom, state, handlers);
            },
          });
          ms365PermissionStart = () => ms365Permissions.start();
          ms365PermissionStop = () => ms365Permissions.stop();
          ms365PermissionPausePoll = () => ms365Permissions.pause();
          ms365PermissionResumePoll = () => ms365Permissions.resume();
          // The MS365 controller polls continuously; its `sessionFilter` returns nothing until the
          // MS365 tab has a live session, so it never pops a prompt for another surface.
          ms365Permissions.start();
          // Wire the MS365 tab chat controller with the real send-flow now that `readiness` exists.
          state.msChat = createMsChatController(createMsChatDeps(state, dom, handlers, readiness));
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
          await refreshSettings(state, dom, handlers);
          await state.conv.refreshList().then(async () => {
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
        })();
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

  dom.onCodePanelSend = (text: string): void => {
    void sendPrompt(state, dom, readiness, handlers, { promptOverride: text, skipAttachments: true }).catch(
      (error) => {
        const preflight = assessSendPreflight(buildReadinessInput(state.localServiceReady, state));
        if (!preflight.canSend) {
          renderComposerPreflight(dom, preflight, true);
          renderState(dom, state, handlers);
          return;
        }
        void state.conv.setRuntimePhase("failed");
        appendMessage(dom, "assistant", safeError(error));
        renderState(dom, state, handlers);
      },
    );
  };

  dom.sendButton.addEventListener("click", () => {
    const composerText = textFromComposer(dom.composerInput).trim();
    if (composerText.startsWith("/")) {
      if (state.client !== null) {
        const ctx = {
          client: state.client,
          conv: state.conv,
          activeSessionId: state.conv.state.runtimeSessionId,
          arguments: [],
          dom,
          state,
          handlers,
          appendAssistantMessage: (text: string) => {
            appendMessage(dom, "assistant", text);
          },
          clearChatUI: () => {
            clearTranscript(dom);
          },
          refreshUI: () => {
            renderState(dom, state, handlers);
          },
        };
        setComposerText(dom.composerInput, "");
        saveComposerDraft(state, dom);
        void registry.dispatch(composerText, ctx).then(async (dispatchRes) => {
          if (dispatchRes.handled && typeof dispatchRes.result === "string") {
            setComposerText(dom.composerInput, dispatchRes.result);
            await sendPrompt(state, dom, readiness, handlers);
          } else {
            renderState(dom, state, handlers);
          }
        }).catch((error) => {
          appendMessage(dom, "assistant", safeError(error));
          renderState(dom, state, handlers);
        });
      }
      return;
    }
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
  // @-mention typeahead: typing `@` in the composer suggests active-workspace files; picking one
  // inserts `@<relativePath> ` as plain text (the agent resolves it with its normal read tools — no
  // new capability boundary). The file list comes from the guarded /v1/workspace/list walk.
  const mentionTypeahead = createMentionTypeahead({
    input: dom.composerInput,
    anchor: dom.composer,
    getClient: () => state.client,
    getWorkspace: () => state.activeWorkspace,
    onApplied: () => syncComposerChrome(dom, state),
  });
  dom.composerInput.addEventListener("input", () => {
    syncComposerChrome(dom, state);
    mentionTypeahead.refresh();
  });
  dom.composerInput.addEventListener("click", () => mentionTypeahead.refresh());
  dom.composerInput.addEventListener("blur", () => mentionTypeahead.hide());
  dom.composerInput.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (mentionTypeahead.handleKeydown(event)) return;
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
