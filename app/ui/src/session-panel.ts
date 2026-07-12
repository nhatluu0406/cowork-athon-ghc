/**
 * Minimal live-session surface (Slice 4): explicit start, prompt, streaming, cancel.
 *
 * OpenCode starts only after the user clicks "Bắt đầu phiên" (shell `connectLive`). The panel
 * re-handshakes with the service, creates a session, opens the EV stream, and renders honest
 * status — never fabricated completion or internal debug ids.
 */

import type { CoworkShellBridge, TerminalState } from "@cowork-ghc/contracts";
import { sanitizeErrorMessage } from "@cowork-ghc/service/execution";
import { startEvStream, type EvStreamHandle } from "./ev-stream-client.js";
import type { ServiceClient } from "./service-client.js";
import { ServiceClientError } from "./service-client.js";
import type { TimelineHandle } from "./timeline-view.js";

export type SessionPanelPhase =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SessionPanelDeps {
  readonly bridge: CoworkShellBridge;
  readonly getClient: () => ServiceClient | null;
  readonly reconnect: () => void;
  readonly timeline: TimelineHandle;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface SessionPanelHandle {
  readonly root: HTMLElement;
}

const STATUS_LABEL: Record<SessionPanelPhase, string> = {
  idle: "Sẵn sàng",
  starting: "Đang khởi động…",
  running: "Đang chạy",
  completed: "Hoàn tất",
  failed: "Thất bại",
  cancelled: "Đã hủy",
};

const DEFAULT_PROMPT =
  "Reply with only the word PING.";

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function userMessage(error: unknown): string {
  if (error instanceof ServiceClientError) return sanitizeErrorMessage(error.message);
  if (error instanceof Error) return sanitizeErrorMessage(error.message);
  return "Không thể bắt đầu phiên.";
}

async function awaitLiveClient(
  deps: SessionPanelDeps,
  sleep: (ms: number) => Promise<void>,
): Promise<ServiceClient> {
  deps.reconnect();
  for (let i = 0; i < 120; i += 1) {
    const client = deps.getClient();
    if (client !== null) {
      try {
        await client.health();
        return client;
      } catch {
        // service still restarting
      }
    }
    await sleep(250);
  }
  throw new Error("Không kết nối lại được local service sau khi khởi động phiên.");
}

export function mountSessionPanel(container: HTMLElement, deps: SessionPanelDeps): SessionPanelHandle {
  const sleep = deps.sleep ?? sleepDefault;

  const root = document.createElement("section");
  root.className = "session-panel";

  const heading = document.createElement("h2");
  heading.className = "session-panel-title";
  heading.textContent = "Phiên làm việc";

  const status = document.createElement("p");
  status.className = "session-panel-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const errorEl = document.createElement("p");
  errorEl.className = "session-panel-error";
  errorEl.hidden = true;

  const promptInput = document.createElement("textarea");
  promptInput.className = "session-prompt-input";
  promptInput.rows = 3;
  promptInput.value = DEFAULT_PROMPT;
  promptInput.setAttribute("aria-label", "Nội dung yêu cầu");

  const streamOut = document.createElement("pre");
  streamOut.className = "session-stream-output";
  streamOut.setAttribute("aria-label", "Kết quả trực tiếp");
  streamOut.textContent = "";

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "session-start-btn";
  startBtn.textContent = "Bắt đầu phiên";

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "session-send-btn";
  sendBtn.textContent = "Gửi";
  sendBtn.disabled = true;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "session-cancel-btn";
  cancelBtn.textContent = "Hủy";
  cancelBtn.disabled = true;

  const actions = document.createElement("div");
  actions.className = "session-panel-actions";
  actions.append(startBtn, sendBtn, cancelBtn);

  root.append(heading, status, errorEl, promptInput, actions, streamOut);
  container.append(root);

  let phase: SessionPanelPhase = "idle";
  let sessionId: string | null = null;
  let stream: EvStreamHandle | null = null;
  let busy = false;
  let lastTerminal: TerminalState | null = null;

  const setPhase = (next: SessionPanelPhase): void => {
    phase = next;
    status.textContent = `Trạng thái: ${STATUS_LABEL[next]}`;
    const canSend = sessionId !== null && (next === "idle" || next === "running");
    sendBtn.disabled = !canSend || busy;
    cancelBtn.disabled = next !== "running" || sessionId === null || busy;
    startBtn.disabled = busy || next === "starting" || next === "running";
  };

  const showError = (message: string): void => {
    errorEl.textContent = message;
    errorEl.hidden = message.length === 0;
  };

  const teardownStream = (): void => {
    stream?.stop();
    stream = null;
  };

  const waitForTerminal = async (): Promise<"completed" | "cancelled" | "failed"> => {
    if (stream === null) return "failed";
    await stream.done;
    if (lastTerminal === "cancelled") return "cancelled";
    if (lastTerminal === "completed") return "completed";
    return "failed";
  };

  startBtn.addEventListener("click", () => {
    void (async () => {
      if (busy) return;
      busy = true;
      showError("");
      streamOut.textContent = "";
      teardownStream();
      sessionId = null;
      setPhase("starting");
      try {
        const settingsClient = deps.getClient();
        if (settingsClient === null) throw new Error("Service chưa sẵn sàng.");
        const settings = await settingsClient.getSettings();
        const workspace = settings.activeWorkspace?.rootPath;
        const model = settings.defaultModel;
        if (workspace === undefined || model === null) {
          throw new Error("Chọn workspace và cấu hình model trước khi bắt đầu phiên.");
        }

        await deps.bridge.connectLive();
        const client = await awaitLiveClient(deps, sleep);
        const bootstrap = await deps.bridge.getBootstrap();
        if (!bootstrap.serviceBaseUrl || !bootstrap.clientToken) {
          throw new Error("Shell chưa cung cấp kết nối live.");
        }

        const meta = await client.createSession({
          workspaceId: workspace,
          title: "Cowork phiên",
          model,
        });
        sessionId = meta.id;
        lastTerminal = null;
        setPhase("idle");
        status.textContent = "Trạng thái: Phiên đã sẵn sàng — nhập yêu cầu và bấm Gửi.";
        sendBtn.disabled = false;
        cancelBtn.disabled = true;

        stream = startEvStream({
          baseUrl: bootstrap.serviceBaseUrl,
          clientToken: bootstrap.clientToken,
          sessionId: meta.id,
          onView: (view) => {
            deps.timeline.update(view);
            if (view.text.length > 0) streamOut.textContent = view.text;
            if (view.terminal !== null) lastTerminal = view.terminal;
            if (view.terminal === "completed") setPhase("completed");
            if (view.terminal === "cancelled") setPhase("cancelled");
            if (view.terminal === "errored" || view.terminal === "denied") {
              setPhase("failed");
              showError(view.error?.message ?? "Phiên kết thúc với lỗi.");
            }
          },
          onError: (message) => {
            setPhase("failed");
            showError(message);
          },
        });
      } catch (error) {
        setPhase("failed");
        showError(userMessage(error));
        teardownStream();
      } finally {
        busy = false;
        if (phase !== "running") startBtn.disabled = false;
      }
    })();
  });

  sendBtn.addEventListener("click", () => {
    void (async () => {
      if (busy || sessionId === null) return;
      const client = deps.getClient();
      if (client === null) return;
      busy = true;
      showError("");
      setPhase("running");
      cancelBtn.disabled = false;
      try {
        const text = promptInput.value.trim();
        if (text.length === 0) throw new Error("Nhập nội dung yêu cầu.");
        const result = await client.sendSessionMessage(sessionId, text);
        if (!result.accepted) {
          throw new Error(
            result.reason === "runtime_not_attached"
              ? "Runtime chưa sẵn sàng. Hãy bắt đầu phiên lại."
              : "Không gửi được yêu cầu.",
          );
        }
        const outcome = await waitForTerminal();
        setPhase(outcome === "cancelled" ? "cancelled" : outcome === "completed" ? "completed" : "failed");
      } catch (error) {
        setPhase("failed");
        showError(userMessage(error));
      } finally {
        busy = false;
      }
    })();
  });

  cancelBtn.addEventListener("click", () => {
    void (async () => {
      if (busy || sessionId === null) return;
      const client = deps.getClient();
      if (client === null) return;
      busy = true;
      try {
        await client.cancelSession(sessionId);
        const outcome = await waitForTerminal();
        setPhase(outcome === "cancelled" ? "cancelled" : "failed");
      } catch (error) {
        setPhase("failed");
        showError(userMessage(error));
      } finally {
        busy = false;
      }
    })();
  });

  setPhase("idle");
  return { root };
}
