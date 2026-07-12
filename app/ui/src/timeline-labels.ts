/**
 * EV timeline label vocabulary (CGHC-015 / CGHC-025) — the Vietnamese, user-facing strings
 * the {@link ./timeline-view} renders for each EV slice. Kept out of the renderer so that file
 * stays a cohesive DOM-building module under the size budget. These are pure display maps: no
 * logic, no secrets, no fabricated status text.
 */

import type { FileMutationOp, SessionStatus, StepStatus, TerminalState } from "@cowork-ghc/contracts";

export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Chưa bắt đầu",
  running: "Đang chạy…",
  waiting_approval: "Đang chờ phê duyệt",
  cancelled: "Đã huỷ",
  completed: "Hoàn thành",
  errored: "Lỗi",
  denied: "Bị từ chối",
  runtime_down: "Runtime đã dừng",
};

export const TERMINAL_LABEL: Record<TerminalState, string> = {
  completed: "Hoàn thành",
  errored: "Kết thúc do lỗi",
  cancelled: "Đã huỷ",
  denied: "Bị từ chối",
};

export const STEP_LABEL: Record<StepStatus, string> = {
  pending: "chờ",
  running: "đang chạy",
  completed: "xong",
  errored: "lỗi",
  cancelled: "huỷ",
};

export const FILE_OP_LABEL: Record<FileMutationOp, string> = {
  create: "tạo",
  edit: "sửa",
  delete: "xoá",
  move: "di chuyển",
};

/** Non-secret recovery-action labels; the reducer flattens recovery to its `kind` string. */
export const RECOVERY_LABEL: Record<string, string> = {
  retry: "Thử lại",
  cancel: "Huỷ",
  reconfigure_credential: "Cấu hình lại khoá",
  switch_model: "Đổi mô hình",
  switch_provider: "Đổi nhà cung cấp",
  restart_runtime: "Khởi động lại runtime",
  none: "Đã hiểu",
};
