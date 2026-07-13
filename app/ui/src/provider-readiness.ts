/**
 * Centralized provider + send readiness (renderer).
 *
 * Distinguishes local service health from provider configuration readiness.
 */

import type { ConversationRecord } from "./service-client.js";
import type { SettingsView } from "./service-client.js";
import type { ReadinessState } from "./readiness-controller.js";
import type { RuntimePhase } from "./conversation-controller.js";
import { needsContinuation } from "./conversation-controller.js";
import { PROVIDER_PRESETS } from "./provider-presets.js";

export type ReadinessKind =
  | "local_service_unavailable"
  | "workspace_missing"
  | "provider_missing"
  | "model_missing"
  | "credential_missing"
  | "base_url_invalid"
  | "locally_ready"
  | "connectivity_failed"
  | "runtime_starting"
  | "runtime_running"
  | "runtime_terminal"
  | "composer_locked"
  | "runtime_busy";

export type ConnectionTestState = "unknown" | "ok" | "failed";

export interface ProviderReadinessInput {
  readonly localServiceReady: boolean;
  readonly activeWorkspace: string | null;
  readonly settings: SettingsView | null;
  readonly runtimePhase: RuntimePhase;
  readonly activeConversationId: string | null;
  readonly activeRecord: ConversationRecord | null;
  readonly composerLocked: boolean;
  readonly connectionTestState: ConnectionTestState;
}

export interface SendPreflight {
  readonly canSend: boolean;
  readonly blockKind: ReadinessKind | null;
  readonly message: string;
  readonly showSettingsCta: boolean;
}

export interface StatusCopy {
  readonly label: string;
  readonly detail: string;
  readonly ok: boolean;
}

export function localServiceStatus(state: ReadinessState): StatusCopy {
  switch (state.phase) {
    case "starting":
      return {
        label: "Local service: Đang khởi động",
        detail: "Đang nhận cấu hình kết nối.",
        ok: false,
      };
    case "connecting":
      return {
        label: "Local service: Đang kết nối",
        detail: `Lần thử ${state.attempt}.`,
        ok: false,
      };
    case "ready":
      return {
        label: "Local service: Sẵn sàng",
        detail: "Cowork GHC core sẵn sàng.",
        ok: true,
      };
    case "not_connected":
      return {
        label: "Local service: Không khả dụng",
        detail: state.detail,
        ok: false,
      };
    case "unreachable":
      return {
        label: "Local service: Không khả dụng",
        detail: state.detail,
        ok: false,
      };
  }
}

function providerRow(settings: SettingsView, providerId: string) {
  return settings.providers.find((p) => p.providerId === providerId);
}

export function providerDisplayName(settings: SettingsView | null): string {
  const model = settings?.defaultModel;
  if (model === null || model === undefined) return "Provider";
  const preset = PROVIDER_PRESETS.find(
    (p) =>
      p.providerId === model.providerID &&
      p.models.some((presetModel) => presetModel.ref.modelID === model.modelID),
  );
  if (preset !== undefined) return preset.label;
  if (model.providerID === "custom-openai-compat" && model.modelID.toLowerCase().includes("deepseek")) {
    return "DeepSeek";
  }
  return model.providerID;
}

export function providerModelLabel(settings: SettingsView | null): string {
  const model = settings?.defaultModel;
  if (model === null || model === undefined) return "Provider chưa cấu hình";
  return `${providerDisplayName(settings)} / ${model.modelID}`;
}

export function isBaseUrlLocallyValid(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.trim().length === 0) return true;
  try {
    const url = new URL(baseUrl.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function providerStatus(
  settings: SettingsView | null,
  connectionTestState: ConnectionTestState = "unknown",
): StatusCopy {
  const subject = providerDisplayName(settings);
  if (settings === null) {
    return {
      label: "Provider · Chưa cấu hình",
      detail: "Chưa tải cài đặt provider.",
      ok: false,
    };
  }
  const model = settings.defaultModel;
  if (model === null) {
    return {
      label: "Provider · Chưa cấu hình",
      detail: "Chọn nhà cung cấp và mô hình.",
      ok: false,
    };
  }
  const row = providerRow(settings, model.providerID);
  if (row === undefined) {
    return {
      label: `${subject} · Chưa cấu hình`,
      detail: "Nhà cung cấp chưa được đăng ký.",
      ok: false,
    };
  }
  if (!isBaseUrlLocallyValid(row.baseUrl)) {
    return {
      label: `${subject} · Cấu hình chưa hợp lệ`,
      detail: "Base URL không hợp lệ.",
      ok: false,
    };
  }
  if (!row.hasCredential) {
    return {
      label: `${subject} · Chưa cấu hình`,
      detail: "Cần khoá API trước khi bắt đầu.",
      ok: false,
    };
  }
  if (model.modelID.trim().length === 0) {
    return {
      label: `${subject} · Cấu hình chưa hợp lệ`,
      detail: "Mô hình không được để trống.",
      ok: false,
    };
  }
  if (connectionTestState === "failed") {
    return {
      label: `${subject} · Kết nối thất bại`,
      detail: "Kiểm tra kết nối không thành công — mở cài đặt để sửa.",
      ok: false,
    };
  }
  if (connectionTestState === "ok") {
    return {
      label: `${subject} · Sẵn sàng`,
      detail: `${model.modelID} · khoá API đã cấu hình.`,
      ok: true,
    };
  }
  return {
    label: `${subject} · Chưa kiểm tra`,
    detail: `${model.modelID} · khoá API đã cấu hình.`,
    ok: false,
  };
}

export function runtimeReadinessKind(phase: RuntimePhase): ReadinessKind {
  switch (phase) {
    case "starting":
      return "runtime_starting";
    case "running":
    case "cancelling":
      return "runtime_running";
    case "completed":
    case "completed_without_final_message":
    case "denied":
    case "cancelled":
    case "failed":
      return "runtime_terminal";
    default:
      return "locally_ready";
  }
}

export function assessSendPreflight(input: ProviderReadinessInput): SendPreflight {
  if (!input.localServiceReady) {
    return {
      canSend: false,
      blockKind: "local_service_unavailable",
      message: "Local service chưa sẵn sàng. Đợi kết nối hoặc thử lại.",
      showSettingsCta: false,
    };
  }
  if (input.composerLocked) {
    return {
      canSend: false,
      blockKind: "composer_locked",
      message: "Tiếp tục cuộc trò chuyện lịch sử trước khi gửi tin mới.",
      showSettingsCta: false,
    };
  }
  if (
    input.runtimePhase === "running" ||
    input.runtimePhase === "starting" ||
    input.runtimePhase === "cancelling"
  ) {
    return {
      canSend: false,
      blockKind: "runtime_busy",
      message: "Đang xử lý yêu cầu trước.",
      showSettingsCta: false,
    };
  }
  if (input.activeWorkspace === null) {
    return {
      canSend: false,
      blockKind: "workspace_missing",
      message: "Chọn workspace trước khi gửi.",
      showSettingsCta: false,
    };
  }
  if (input.settings === null) {
    return {
      canSend: false,
      blockKind: "provider_missing",
      message: "Chưa tải cấu hình provider.",
      showSettingsCta: true,
    };
  }
  const model = input.settings.defaultModel;
  if (model === null) {
    return {
      canSend: false,
      blockKind: "model_missing",
      message: "Chọn nhà cung cấp và mô hình trước khi gửi.",
      showSettingsCta: true,
    };
  }
  const row = providerRow(input.settings, model.providerID);
  if (row === undefined) {
    return {
      canSend: false,
      blockKind: "provider_missing",
      message: "Nhà cung cấp chưa được cấu hình.",
      showSettingsCta: true,
    };
  }
  if (!isBaseUrlLocallyValid(row.baseUrl)) {
    return {
      canSend: false,
      blockKind: "base_url_invalid",
      message: "Base URL không hợp lệ. Sửa trong cài đặt provider.",
      showSettingsCta: true,
    };
  }
  if (model.modelID.trim().length === 0) {
    return {
      canSend: false,
      blockKind: "model_missing",
      message: "Mô hình không được để trống.",
      showSettingsCta: true,
    };
  }
  if (!row.hasCredential) {
    return {
      canSend: false,
      blockKind: "credential_missing",
      message: "Cần cấu hình khoá API trước khi bắt đầu",
      showSettingsCta: true,
    };
  }
  return {
    canSend: true,
    blockKind: null,
    message: "",
    showSettingsCta: false,
  };
}

export function shouldShowContinuationBanner(
  activeConversationId: string | null,
  record: ConversationRecord | null,
  runtimePhase: RuntimePhase,
): boolean {
  if (activeConversationId === null) return false;
  if (record === null || record.messages.length === 0) return false;
  if (!needsContinuation(record)) return false;
  if (runtimePhase === "running" || runtimePhase === "starting" || runtimePhase === "cancelling") {
    return false;
  }
  return true;
}

export function buildReadinessInput(
  localServiceReady: boolean,
  state: {
    activeWorkspace: string | null;
    settings: SettingsView | null;
    conv: {
      state: {
        runtimePhase: RuntimePhase;
        activeConversationId: string | null;
        activeRecord: ConversationRecord | null;
      };
    };
    continuationUnlocked: boolean;
    connectionTestState: ConnectionTestState;
  },
): ProviderReadinessInput {
  const record = state.conv.state.activeRecord;
  const phase = state.conv.state.runtimePhase;
  const composerLocked =
    phase !== "running" &&
    phase !== "starting" &&
    phase !== "cancelling" &&
    needsContinuation(record) &&
    !state.continuationUnlocked;

  return {
    localServiceReady,
    activeWorkspace: state.activeWorkspace,
    settings: state.settings,
    runtimePhase: phase,
    activeConversationId: state.conv.state.activeConversationId,
    activeRecord: record,
    composerLocked,
    connectionTestState: state.connectionTestState,
  };
}
