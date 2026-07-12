/**
 * Centralized provider + send readiness (renderer).
 *
 * Distinguishes local service health from provider configuration readiness.
 */
import { needsContinuation } from "./conversation-controller.js";
export function localServiceStatus(state) {
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
function providerRow(settings, providerId) {
    return settings.providers.find((p) => p.providerId === providerId);
}
export function isBaseUrlLocallyValid(baseUrl) {
    if (baseUrl === undefined || baseUrl.trim().length === 0)
        return true;
    try {
        const url = new URL(baseUrl.trim());
        return url.protocol === "https:" || url.protocol === "http:";
    }
    catch {
        return false;
    }
}
export function providerStatus(settings, connectionTestState = "unknown") {
    if (settings === null) {
        return {
            label: "Provider: Chưa cấu hình",
            detail: "Chưa tải cài đặt provider.",
            ok: false,
        };
    }
    const model = settings.defaultModel;
    if (model === null) {
        return {
            label: "Provider: Chưa cấu hình",
            detail: "Chọn nhà cung cấp và mô hình.",
            ok: false,
        };
    }
    const row = providerRow(settings, model.providerID);
    if (row === undefined) {
        return {
            label: "Provider: Chưa cấu hình",
            detail: "Nhà cung cấp chưa được đăng ký.",
            ok: false,
        };
    }
    if (!isBaseUrlLocallyValid(row.baseUrl)) {
        return {
            label: "Provider: Cấu hình chưa hợp lệ",
            detail: "Base URL không hợp lệ.",
            ok: false,
        };
    }
    if (!row.hasCredential) {
        return {
            label: "Provider: Chưa cấu hình",
            detail: "Cần khoá API trước khi bắt đầu.",
            ok: false,
        };
    }
    if (model.modelID.trim().length === 0) {
        return {
            label: "Provider: Cấu hình chưa hợp lệ",
            detail: "Mô hình không được để trống.",
            ok: false,
        };
    }
    if (connectionTestState === "failed") {
        return {
            label: "Provider: Kết nối thất bại",
            detail: "Kiểm tra kết nối không thành công — mở cài đặt để sửa.",
            ok: false,
        };
    }
    if (connectionTestState === "ok") {
        return {
            label: "Provider: Đã kiểm tra kết nối",
            detail: `${model.modelID} · khoá API đã cấu hình.`,
            ok: true,
        };
    }
    return {
        label: "Provider: Sẵn sàng để kiểm tra",
        detail: `${model.modelID} · khoá API đã cấu hình.`,
        ok: true,
    };
}
export function runtimeReadinessKind(phase) {
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
export function assessSendPreflight(input) {
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
    if (input.runtimePhase === "running" ||
        input.runtimePhase === "starting" ||
        input.runtimePhase === "cancelling") {
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
export function shouldShowContinuationBanner(activeConversationId, record, runtimePhase) {
    if (activeConversationId === null)
        return false;
    if (record === null || record.messages.length === 0)
        return false;
    if (!needsContinuation(record))
        return false;
    if (runtimePhase === "running" || runtimePhase === "starting" || runtimePhase === "cancelling") {
        return false;
    }
    return true;
}
export function buildReadinessInput(localServiceReady, state) {
    const record = state.conv.state.activeRecord;
    const phase = state.conv.state.runtimePhase;
    const composerLocked = phase !== "running" &&
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
//# sourceMappingURL=provider-readiness.js.map