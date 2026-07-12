/**
 * HuyTT12-inspired Cowork GHC application shell.
 *
 * This is presentation + view-model only. It talks exclusively to the existing shell bridge and
 * loopback service client; it does not import the HuyTT12 main/preload backend or duplicate
 * provider, credential, filesystem, OpenCode, or DeepSeek logic.
 */

import { initialSessionView, sanitizeErrorMessage, type SessionView } from "@cowork-ghc/service/execution";
import type { RendererBootstrap } from "@cowork-ghc/contracts";
import { getShellBridge } from "./bridge.js";
import { createReadinessController, type ReadinessState } from "./readiness-controller.js";
import { startEvStream, type EvStreamHandle } from "./ev-stream-client.js";
import { mountLlmSettingsPanel } from "./llm-settings-panel.js";
import { createPermissionController } from "./permission-controller.js";
import { createServiceClient, ServiceClientError, type ServiceClient, type SettingsView } from "./service-client.js";
import { mountSettingsView } from "./settings-view.js";
import { mountWorkspacePicker } from "./workspace-picker.js";

type SessionPhase = "idle" | "starting" | "ready" | "running" | "cancelling" | "completed" | "failed" | "cancelled";

interface AppState {
  client: ServiceClient | null;
  bootstrap: RendererBootstrap | null;
  settings: SettingsView | null;
  activeWorkspace: string | null;
  sessionId: string | null;
  sessionPhase: SessionPhase;
  stream: EvStreamHandle | null;
  lastView: SessionView;
  assistantText: string;
  activeAssistant: HTMLElement | null;
}

interface AppDom {
  root: HTMLElement;
  serviceStatus: HTMLElement;
  serviceDetail: HTMLElement;
  workspaceLabel: HTMLElement;
  modelLabel: HTMLElement;
  sessionList: HTMLElement;
  transcriptInner: HTMLElement;
  emptyState: HTMLElement;
  thinking: HTMLElement;
  composer: HTMLElement;
  composerInput: HTMLElement;
  composerHint: HTMLElement;
  sendButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  startButtons: HTMLButtonElement[];
  settingsModal: HTMLElement;
  settingsBody: HTMLElement;
  planSteps: HTMLElement;
  outputFiles: HTMLElement;
  inputFiles: HTMLElement;
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

function icon(name: string): HTMLElement {
  const node = el("span", "cg-icon", name);
  node.setAttribute("aria-hidden", "true");
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

function phaseLabel(phase: SessionPhase): string {
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

function appendMessage(dom: AppDom, role: "user" | "assistant", text = ""): HTMLElement {
  dom.emptyState.hidden = true;
  const row = el("div", `msg msg--${role}`);
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

function renderSessionList(dom: AppDom, state: AppState): void {
  dom.sessionList.replaceChildren();
  const item = el("button", "history-item history-item--active");
  item.type = "button";
  item.append(el("span", "history-item__title", state.sessionId === null ? DEFAULT_TITLE : "Phiên hiện tại"));
  item.append(el("span", "history-item__meta", phaseLabel(state.sessionPhase)));
  dom.sessionList.append(item);
}

function renderRightPanel(dom: AppDom, view: SessionView): void {
  dom.planSteps.replaceChildren();
  if (view.todos.length === 0 && view.steps.length === 0 && view.toolCalls.length === 0) {
    dom.planSteps.append(el("p", "panel-empty", "Chưa có hoạt động."));
  }
  for (const todo of view.todos) {
    const row = el("div", `plan-step plan-step--${todo.status}`);
    row.append(el("span", "plan-step__dot"));
    row.append(el("span", "plan-step__label", todo.title));
    dom.planSteps.append(row);
  }
  for (const step of view.steps) {
    const row = el("div", `plan-step plan-step--${step.status}`);
    row.append(el("span", "plan-step__dot"));
    row.append(el("span", "plan-step__label", step.label || "Đang phân tích"));
    dom.planSteps.append(row);
  }
  for (const tool of view.toolCalls) {
    const row = el("div", `plan-step plan-step--${tool.status}`);
    row.append(el("span", "plan-step__dot"));
    row.append(el("span", "plan-step__label", tool.summary ?? `Đang sử dụng công cụ: ${tool.toolName}`));
    dom.planSteps.append(row);
  }

  dom.outputFiles.replaceChildren();
  const mutations = view.fileMutations;
  if (mutations.length === 0) dom.outputFiles.append(el("p", "panel-empty", "Chưa có thay đổi tệp."));
  for (const mutation of mutations) {
    const row = el("div", "file-row");
    row.append(icon("file"));
    row.append(el("span", "file-row__name", `${mutation.operation}: ${shortPath(mutation.path)}`));
    dom.outputFiles.append(row);
  }

  dom.inputFiles.replaceChildren(el("p", "panel-empty", "Chưa khả dụng"));
}

function renderState(dom: AppDom, state: AppState): void {
  dom.workspaceLabel.textContent = state.activeWorkspace === null ? "Chưa chọn workspace" : shortPath(state.activeWorkspace);
  dom.modelLabel.textContent = modelSummary(state.settings);
  dom.executionStatus.textContent = phaseLabel(state.sessionPhase);
  dom.composer.classList.toggle("is-running", state.sessionPhase === "running" || state.sessionPhase === "cancelling");
  dom.thinking.hidden = state.sessionPhase !== "running" && state.sessionPhase !== "starting" && state.sessionPhase !== "cancelling";
  dom.sendButton.disabled =
    state.sessionPhase === "starting" ||
    state.sessionPhase === "running" ||
    state.sessionPhase === "cancelling" ||
    textFromComposer(dom.composerInput).length === 0;
  dom.cancelButton.hidden = state.sessionPhase !== "running" && state.sessionPhase !== "cancelling";
  dom.cancelButton.disabled = state.sessionPhase !== "running";
  for (const button of dom.startButtons) {
    button.disabled = state.sessionPhase === "starting" || state.sessionPhase === "running" || state.activeWorkspace === null;
  }
  renderSessionList(dom, state);
  renderRightPanel(dom, state.lastView);
}

async function refreshSettings(state: AppState, dom: AppDom): Promise<void> {
  if (state.client === null) return;
  try {
    state.settings = await state.client.getSettings();
    state.activeWorkspace = state.settings.activeWorkspace?.rootPath ?? null;
  } catch {
    state.settings = null;
  }
  renderState(dom, state);
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

async function startSession(
  state: AppState,
  dom: AppDom,
  readiness: ReturnType<typeof createReadinessController>,
): Promise<void> {
  if (state.client === null) throw new Error("Service chưa sẵn sàng.");
  await refreshSettings(state, dom);
  if (state.activeWorkspace === null || state.settings?.defaultModel === null || state.settings?.defaultModel === undefined) {
    throw new Error("Chọn workspace và cấu hình model trước khi bắt đầu phiên.");
  }

  state.sessionPhase = "starting";
  state.lastView = initialSessionView("");
  state.assistantText = "";
  state.stream?.stop();
  state.stream = null;
  renderState(dom, state);

  await getShellBridge().connectLive();
  const client = await awaitLiveClient(state, readiness);
  const bootstrap = await getShellBridge().getBootstrap();
  if (!bootstrap.serviceBaseUrl || !bootstrap.clientToken) throw new Error("Shell chưa cung cấp kết nối live.");
  state.bootstrap = bootstrap;

  const meta = await client.createSession({
    workspaceId: state.activeWorkspace,
    title: DEFAULT_TITLE,
    model: state.settings.defaultModel,
  });
  state.sessionId = meta.id;
  state.sessionPhase = "ready";
  state.lastView = initialSessionView(meta.id);
  state.assistantText = "";

  state.stream = startEvStream({
    baseUrl: bootstrap.serviceBaseUrl,
    clientToken: bootstrap.clientToken,
    sessionId: meta.id,
    onView: (view) => {
      state.lastView = view;
      state.assistantText = view.text;
      const assistant = state.activeAssistant?.querySelector<HTMLElement>(".msg__text p") ?? null;
      if (assistant !== null) assistant.textContent = view.text;
      if (view.terminal === "completed") state.sessionPhase = "completed";
      if (view.terminal === "cancelled") state.sessionPhase = "cancelled";
      if (view.terminal === "errored" || view.terminal === "denied") {
        state.sessionPhase = "failed";
        if (view.error?.message) appendMessage(dom, "assistant", view.error.message);
      }
      renderState(dom, state);
    },
    onError: (message) => {
      state.sessionPhase = "failed";
      appendMessage(dom, "assistant", message);
      renderState(dom, state);
    },
  });
  renderState(dom, state);
}

async function sendPrompt(
  state: AppState,
  dom: AppDom,
  readiness: ReturnType<typeof createReadinessController>,
): Promise<void> {
  const prompt = textFromComposer(dom.composerInput);
  if (prompt.length === 0) return;
  if (state.sessionId === null || state.sessionPhase === "completed" || state.sessionPhase === "cancelled" || state.sessionPhase === "failed") {
    await startSession(state, dom, readiness);
  }
  if (state.client === null || state.sessionId === null) return;

  appendMessage(dom, "user", prompt);
  state.activeAssistant = appendMessage(dom, "assistant", "");
  setComposerText(dom.composerInput, "");
  state.sessionPhase = "running";
  renderState(dom, state);

  const result = await state.client.sendSessionMessage(state.sessionId, prompt);
  if (!result.accepted) {
    state.sessionPhase = "failed";
    appendMessage(dom, "assistant", result.reason === "runtime_not_attached" ? "Runtime chưa sẵn sàng." : "Không gửi được yêu cầu.");
    renderState(dom, state);
  }
}

async function cancelRun(state: AppState, dom: AppDom): Promise<void> {
  if (state.client === null || state.sessionId === null || state.sessionPhase !== "running") return;
  state.sessionPhase = "cancelling";
  renderState(dom, state);
  await Promise.race([
    state.client.cancelSession(state.sessionId).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ]);
  state.stream?.stop();
  state.sessionPhase = "cancelled";
  state.lastView = { ...state.lastView, status: "cancelled", terminal: "cancelled" };
  renderState(dom, state);
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
  const newButton = el("button", "sidebar__new-btn", "Bắt đầu phiên");
  newButton.type = "button";
  const workspaceBox = el("section", "workspace-slot");
  const workspaceLabel = el("p", "workspace-context", "Chưa chọn workspace");
  const sessionList = el("div", "sidebar__history");
  sidebar.append(nav, newButton, workspaceLabel, workspaceBox, el("h2", "sidebar__heading", "Phiên"), sessionList);

  const chat = el("section", "chat-area");
  const header = el("div", "chat-header");
  const headerInfo = el("div", "chat-header__info");
  headerInfo.append(el("div", "chat-header__title", DEFAULT_TITLE), el("div", "chat-header__sub", "Cowork GHC sử dụng workspace và provider đã cấu hình."));
  const headerActions = el("div", "chat-header__actions");
  const startButton = el("button", "label-btn", "Bắt đầu phiên");
  startButton.type = "button";
  const skillsButton = el("button", "label-btn label-btn--disabled", "Skills: Chưa khả dụng");
  skillsButton.type = "button";
  skillsButton.disabled = true;
  headerActions.append(startButton, skillsButton);
  header.append(el("div", "chat-header__icon", "AI"), headerInfo, headerActions);

  const transcript = el("div", "transcript");
  const transcriptInner = el("div", "transcript__inner");
  const emptyState = el("div", "empty-state");
  emptyState.append(el("h2", "empty-state__title", "Bắt đầu làm việc với Cowork GHC"));
  emptyState.append(el("p", "empty-state__copy", "Chọn workspace, cấu hình provider/model, rồi bắt đầu phiên OpenCode khi bạn sẵn sàng."));
  const emptyStart = el("button", "primary-btn", "Bắt đầu phiên");
  emptyStart.type = "button";
  emptyState.append(emptyStart);
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
  composerBar.append(disabledAttach, el("span", "model-picker", "Đính kèm: Chưa khả dụng"), el("div", "composer__spacer"), cancelButton, sendButton);
  const composerHint = el("div", "composer__hint", "Enter để gửi, Shift+Enter xuống dòng");
  composerBox.append(composerInput, composerBar);
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
  inputSection.append(el("div", "file-section__label", "Tệp đầu vào"));
  const inputFiles = el("div", "input-files");
  inputSection.append(inputFiles);
  const permissionSummary = el("p", "permission-summary", "Quyền: chưa có yêu cầu.");
  rightPanel.append(rpHeader, executionStatus, planCard, outputSection, inputSection, permissionSummary);

  workspace.append(sidebar, chat, rightPanel);

  const statusbar = el("footer", "statusbar");
  const serviceDetail = el("span", "statusbar__left", "Đang khởi động");
  statusbar.append(serviceDetail, el("span", "statusbar__right", "OpenCode chỉ chạy khi bạn bắt đầu phiên."));

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
    sessionList,
    transcriptInner,
    emptyState,
    thinking,
    composer,
    composerInput,
    composerHint,
    sendButton,
    cancelButton,
    startButtons: [newButton, startButton, emptyStart],
    settingsModal,
    settingsBody,
    planSteps,
    outputFiles,
    inputFiles,
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
    sessionId: null,
    sessionPhase: "idle",
    stream: null,
    lastView: initialSessionView(""),
    assistantText: "",
    activeAssistant: null,
  };

  let featuresMounted = false;
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
        void refreshSettings(state, dom);
        if (!featuresMounted) {
          featuresMounted = true;
          mountWorkspacePicker(dom.sidebar.querySelector(".workspace-slot") as HTMLElement, {
            bridge: getShellBridge(),
            client: dynamicClient,
            onActivated: (rootPath) => {
              state.activeWorkspace = rootPath;
              void refreshSettings(state, dom);
              renderState(dom, state);
            },
            onDeactivated: () => {
              state.activeWorkspace = null;
              renderState(dom, state);
            },
          });
          mountLlmSettingsPanel(dom.settingsBody, {
            client: dynamicClient,
            getBootstrap: () => getShellBridge().getBootstrap(),
          });
          mountSettingsView(dom.settingsBody, { client: dynamicClient });
          const permissions = createPermissionController({ client: dynamicClient, container: dom.root });
          permissions.start();
        }
      }
    },
  });

  const runStart = (): void => {
    void (async () => {
      try {
        await startSession(state, dom, readiness);
      } catch (error) {
        state.sessionPhase = "failed";
        appendMessage(dom, "assistant", safeError(error));
        renderState(dom, state);
      }
    })();
  };

  for (const button of dom.startButtons) button.addEventListener("click", runStart);
  dom.sendButton.addEventListener("click", () => {
    void sendPrompt(state, dom, readiness).catch((error) => {
      state.sessionPhase = "failed";
      appendMessage(dom, "assistant", safeError(error));
      renderState(dom, state);
    });
  });
  dom.cancelButton.addEventListener("click", () => {
    void cancelRun(state, dom).catch((error) => {
      state.sessionPhase = "failed";
      appendMessage(dom, "assistant", safeError(error));
      renderState(dom, state);
    });
  });
  dom.composerInput.addEventListener("input", () => renderState(dom, state));
  dom.composerInput.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      dom.sendButton.click();
    }
  });

  renderState(dom, state);
  readiness.start();
}
