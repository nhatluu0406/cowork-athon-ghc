/**
 * Centralized provider + send readiness (renderer).
 *
 * Distinguishes local service health from provider configuration readiness.
 */

import type { ConversationRecord } from "./service-client.js";
import type { SettingsView } from "./service-client.js";
import type { ReadinessState } from "./readiness-controller.js";
import type { RuntimePhase } from "./conversation-controller.js";
import { PROVIDER_PRESETS } from "./provider-presets.js";

const DEEPSEEK_MODELS = [
  { id: "deepseek-chat", label: "DeepSeek Chat" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
] as const;

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

function activeProfile(settings: SettingsView | null) {
  return settings?.providerProfiles?.find((p) => p.isActive);
}

export function providerDisplayName(settings: SettingsView | null): string {
  const profile = activeProfile(settings);
  if (profile !== undefined) return profile.displayName;
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
  const profile = activeProfile(settings);
  if (profile !== undefined) {
    const friendly =
      profile.providerType === "deepseek"
        ? DEEPSEEK_MODELS.find((m) => m.id === profile.modelId)?.label ?? profile.modelId
        : profile.modelId;
    return `${profile.displayName} / ${friendly}`;
  }
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
  const profile = activeProfile(settings);
  if (profile !== undefined) {
    const subject = profile.displayName;
    if (!isBaseUrlLocallyValid(profile.baseUrl)) {
      return {
        label: `${subject} · Cấu hình chưa hợp lệ`,
        detail: "Base URL không hợp lệ.",
        ok: false,
      };
    }
    if (!profile.credentialConfigured) {
      return {
        label: `${subject} · Chưa cấu hình`,
        detail: "Cần khoá API trước khi bắt đầu.",
        ok: false,
      };
    }
    if (profile.modelId.trim().length === 0) {
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
        label: `${subject} · Đã kiểm tra`,
        detail: `${profile.modelId} · khoá API đã cấu hình.`,
        ok: true,
      };
    }
    if (profile.verificationCurrent && profile.lastVerifiedOk === true) {
      return {
        label: `${subject} · Đã kiểm tra`,
        detail: `${profile.modelId} · đã xác minh${profile.lastVerifiedAt !== undefined ? ` · ${profile.lastVerifiedAt}` : ""}.`,
        ok: true,
      };
    }
    if (profile.verificationCurrent && profile.lastVerifiedOk === false) {
      return {
        label: `${subject} · Kết nối thất bại`,
        detail: "Lần kiểm tra gần nhất thất bại — mở cài đặt để sửa rồi thử lại.",
        ok: false,
      };
    }
    return {
      label: `${subject} · Chưa kiểm tra`,
      detail: `${profile.modelId} · khoá API đã cấu hình.`,
      ok: false,
    };
  }

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
      label: `${subject} · Đã kiểm tra`,
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

export type ReadinessTone = "ok" | "warn" | "danger";

export interface OverallReadiness {
  readonly label: string;
  readonly detail: string;
  readonly tone: ReadinessTone;
}

/**
 * Single honest top-level readiness signal for the shared status bar.
 *
 * Aggregates the three blocking dependencies a newcomer cares about — local service up,
 * a workspace chosen, a provider configured — so the chip NEVER reads "Sẵn sàng" while any
 * required dependency is missing (ui-ux-audit F4). The per-axis Workspace/Provider chips still
 * spell out the specific gap; this chip is the roll-up.
 */
export function overallReadiness(input: {
  readonly serviceOk: boolean;
  readonly serviceLabel: string;
  readonly activeWorkspace: string | null;
  readonly settings: SettingsView | null;
  readonly connectionTestState: ConnectionTestState;
}): OverallReadiness {
  const serviceText = input.serviceLabel
    .replace(/^Local service:\s*/i, "")
    .replace(/^Service\s*·\s*/i, "");
  if (!input.serviceOk) {
    // Local service down / starting — keep the existing (danger) treatment; provider/workspace
    // are moot until the core is up.
    return { label: serviceText, detail: "Local service chưa sẵn sàng.", tone: "danger" };
  }
  if (input.activeWorkspace === null) {
    return {
      label: "Cần chọn workspace",
      detail: "Chọn một workspace để bắt đầu làm việc.",
      tone: "warn",
    };
  }
  const provider = providerStatus(input.settings, input.connectionTestState);
  if (!provider.ok) {
    return { label: "Cần cấu hình provider", detail: provider.detail, tone: "warn" };
  }
  return {
    label: "Sẵn sàng",
    detail: "Local service, workspace và provider đã sẵn sàng.",
    tone: "ok",
  };
}

/**
 * Human reason a dispatch fan-out cannot start yet, mapped from a config-preflight block kind to
 * dispatch-flavoured copy (the preflight messages say "gửi"/send). Empty string means "no block".
 */
export function dispatchGateReason(blockKind: ReadinessKind | null): string {
  switch (blockKind) {
    case null:
      return "";
    case "local_service_unavailable":
      return "Local service chưa sẵn sàng — đợi kết nối rồi chạy task.";
    case "workspace_missing":
      return "Chọn workspace trước khi chạy task dispatch.";
    case "provider_missing":
    case "model_missing":
    case "credential_missing":
    case "base_url_invalid":
      return "Cấu hình provider trong Cài đặt trước khi chạy task dispatch.";
    default:
      return "Chưa đủ điều kiện để chạy task dispatch.";
  }
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

/**
 * Provider / workspace configuration readiness only.
 * Used mid-send after the turn already claimed `runtimePhase = "starting"`.
 */
export function assessConfigPreflight(input: ProviderReadinessInput): SendPreflight {
  if (!input.localServiceReady) {
    return {
      canSend: false,
      blockKind: "local_service_unavailable",
      message: "Local service chưa sẵn sàng. Đợi kết nối hoặc thử lại.",
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
  const profile = activeProfile(input.settings);
  if (profile !== undefined) {
    if (!isBaseUrlLocallyValid(profile.baseUrl)) {
      return {
        canSend: false,
        blockKind: "base_url_invalid",
        message: "Base URL không hợp lệ. Sửa trong cài đặt provider.",
        showSettingsCta: true,
      };
    }
    if (profile.modelId.trim().length === 0) {
      return {
        canSend: false,
        blockKind: "model_missing",
        message: "Mô hình không được để trống.",
        showSettingsCta: true,
      };
    }
    if (!profile.credentialConfigured) {
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

export function assessSendPreflight(input: ProviderReadinessInput): SendPreflight {
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
  return assessConfigPreflight(input);
}

export function shouldShowContinuationBanner(
  _activeConversationId: string | null,
  _record: ConversationRecord | null,
  _runtimePhase: RuntimePhase,
): boolean {
  // Historical conversations continue on the next send — no banner gate.
  return false;
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
  // Continuation is transparent: the runtime planner opens a new turn under the same
  // conversation id. Never lock the composer for historical/completed sessions.
  void state.continuationUnlocked;

  return {
    localServiceReady,
    activeWorkspace: state.activeWorkspace,
    settings: state.settings,
    runtimePhase: phase,
    activeConversationId: state.conv.state.activeConversationId,
    activeRecord: record,
    composerLocked: false,
    connectionTestState: state.connectionTestState,
  };
}
